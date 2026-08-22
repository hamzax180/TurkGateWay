export const runtime = 'nodejs';

import { db } from '@/lib/db';
import { users } from '@/lib/schema';
import { hashPassword, signToken } from '@/lib/auth';
import { tokenPayload } from '@/lib/user-helper';
import { rateLimit, clientKey } from '@/lib/rate-limit';
import { randomBytes } from 'crypto';
import { sql } from 'drizzle-orm';

export async function POST(req: Request) {
  try {
    const { access_token, id_token, is_access_token } = await req.json();

    const { success } = await rateLimit(clientKey(req, 'google'), 10, 60);
    if (!success) {
      return Response.json(
        { detail: 'Too many attempts. Please try again in a minute.' },
        { status: 429 },
      );
    }

    // The frontend sends the OAuth ACCESS token under `id_token` with is_access_token=true.
    // Resolve which kind of token we actually received.
    const accessTok = access_token || (is_access_token ? id_token : undefined);
    const idTok = is_access_token ? undefined : id_token;

    // Verify with Google
    let googleUser: { email: string; name?: string; sub?: string } | null = null;

    if (accessTok) {
      const resp = await fetch(
        `https://www.googleapis.com/oauth2/v2/userinfo?access_token=${accessTok}`,
      );
      if (resp.ok) {
        const data = await resp.json();
        googleUser = { email: data.email, name: data.name, sub: data.id };
      }
    } else if (idTok) {
      const resp = await fetch(
        `https://oauth2.googleapis.com/tokeninfo?id_token=${idTok}`,
      );
      if (resp.ok) {
        const data = await resp.json();
        // An ID token from ANY Google app would pass without this check — the
        // audience must be our own client id. Configured? Enforce it.
        const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
        if (clientId && data.aud !== clientId) {
          return Response.json({ detail: 'Invalid Google token' }, { status: 401 });
        }
        if (data.email_verified === false) {
          return Response.json({ detail: 'Google account email is not verified' }, { status: 401 });
        }
        googleUser = { email: data.email, name: data.name, sub: data.sub };
      }
    }

    if (!googleUser?.email) {
      return Response.json({ detail: 'Invalid Google token' }, { status: 401 });
    }

    const email = googleUser.email.toLowerCase().trim();

    // Upsert user (case-insensitive match so we don't duplicate an existing account)
    let [user] = await db.select().from(users).where(sql`lower(${users.email}) = ${email}`);
    if (!user) {
      // A real bcrypt hash of random bytes, not a literal — password login
      // must fail cleanly for Google-only accounts.
      const placeholder = await hashPassword(randomBytes(24).toString('hex'));
      [user] = await db.insert(users).values({
        email,
        hashed_password: placeholder,
        full_name: googleUser.name ?? null,
        subscription_status: 'free',
        token_balance: 25,
        last_token_reset: new Date(),
      }).returning();
    }

    if (user.is_active === false) {
      return Response.json({ detail: 'This account has been disabled' }, { status: 403 });
    }

    const jwt = await signToken({ sub: String(user.id), email: user.email });

    return Response.json({
      access_token: jwt,
      token_type: 'bearer',
      ...tokenPayload(user),
    });
  } catch {
    return Response.json({ detail: 'Google auth failed' }, { status: 500 });
  }
}
