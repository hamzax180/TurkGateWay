export const runtime = 'nodejs';

import { db } from '@/lib/db';
import { users } from '@/lib/schema';
import { verifyPassword, verifyTotp, signToken } from '@/lib/auth';
import { tokenPayload, shouldResetTokens, defaultTokens } from '@/lib/user-helper';
import { rateLimit, clientKey } from '@/lib/rate-limit';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';

const schema = z.object({
  email: z.string().email(),
  password: z.string(),
  mfa_code: z.string().optional(),
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = schema.parse(body);
    const email = parsed.email.toLowerCase().trim();
    const password = parsed.password;

    // Brute-force guard, keyed by client + email so one attacker cannot lock
    // out a victim's account. Same 10/minute as the legacy backend.
    const { success } = await rateLimit(clientKey(req, email), 10, 60);
    if (!success) {
      return Response.json(
        { detail: 'Too many attempts. Please try again in a minute.' },
        { status: 429 },
      );
    }

    // Case-insensitive lookup so login matches regardless of how the email was typed/stored
    const [user] = await db.select().from(users).where(sql`lower(${users.email}) = ${email}`);
    if (!user) return Response.json({ detail: 'Invalid credentials' }, { status: 401 });

    if (user.is_active === false) {
      return Response.json({ detail: 'This account has been disabled' }, { status: 403 });
    }

    // Google accounts have no password — their hash is a placeholder, and
    // bcrypt is skipped so the check cannot accidentally pass or throw.
    const ok = user.hashed_password.startsWith('google-oauth')
      ? false
      : await verifyPassword(password, user.hashed_password);
    if (!ok) return Response.json({ detail: 'Invalid credentials' }, { status: 401 });

    // Second factor, when enabled. The legacy backend enforced this; the
    // Next.js port parsed mfa_code and silently ignored it.
    if (user.mfa_enabled) {
      if (!parsed.mfa_code) {
        return Response.json({ detail: 'MFA_REQUIRED' }, { status: 403 });
      }
      if (!user.mfa_secret || !verifyTotp(user.mfa_secret, parsed.mfa_code)) {
        return Response.json({ detail: 'Invalid MFA code' }, { status: 401 });
      }
    }

    // Reset token balance if window has passed
    let balance = user.token_balance ?? 25;
    let updates: Record<string, unknown> = {};
    if (shouldResetTokens(user)) {
      balance = defaultTokens(user);
      updates = { token_balance: balance, last_token_reset: new Date() };
      await db.update(users).set(updates).where(eq(users.id, user.id));
    }

    const refreshed = { ...user, token_balance: balance };
    const access_token = await signToken({ sub: String(user.id), email: user.email });

    return Response.json({
      access_token,
      token_type: 'bearer',
      ...tokenPayload(refreshed),
    });
  } catch (e: any) {
    if (e?.name === 'ZodError') return Response.json({ detail: 'Invalid input' }, { status: 422 });
    // Almost always the database being unreachable — say so, instead of the
    // generic "Login failed" that made every outage look like wrong creds.
    console.error('[auth/login]', e);
    return Response.json(
      { detail: 'Sign-in unavailable right now. Please try again in a moment.' },
      { status: 503 },
    );
  }
}
