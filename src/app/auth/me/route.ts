export const runtime = 'nodejs';

import { requireUser } from '@/lib/user-helper';
import { db } from '@/lib/db';
import { users } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { tokenPayload, shouldResetTokens, defaultTokens } from '@/lib/user-helper';
import { signToken } from '@/lib/auth';

export async function GET(req: Request) {
  try {
    let user = await requireUser(req);

    // Reset token balance if window has passed
    if (shouldResetTokens(user)) {
      const balance = defaultTokens(user);
      await db.update(users).set({ token_balance: balance, last_token_reset: new Date() }).where(eq(users.id, user.id));
      user = { ...user, token_balance: balance, last_token_reset: new Date() };
    }

    const access_token = await signToken({ sub: String(user.id), email: user.email });

    return Response.json({
      access_token,
      token_type: 'bearer',
      ...tokenPayload(user),
    });
  } catch (e: any) {
    if (e instanceof Response) return e;
    // DB outage must not read as "you are signed out" — the token is fine,
    // the account store is temporarily unreachable.
    console.error('[auth/me]', e);
    return Response.json(
      { detail: 'Account service unavailable right now. Please try again in a moment.' },
      { status: 503 },
    );
  }
}
