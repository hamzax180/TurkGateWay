export const runtime = 'nodejs';

import { db } from '@/lib/db';
import { users } from '@/lib/schema';
import { signToken } from '@/lib/auth';
import { tokenPayload } from '@/lib/user-helper';
import { sql } from 'drizzle-orm';

export async function POST(req: Request) {
  try {
    const { access_token, id_token, is_access_token } = await req.json();

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
      [user] = await db.insert(users).values({
        email,
        hashed_password: 'google-oauth',
        full_name: googleUser.name ?? null,
        subscription_status: 'free',
        token_balance: 25,
        last_token_reset: new Date(),
      }).returning();
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
