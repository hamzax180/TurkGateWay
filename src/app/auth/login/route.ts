export const runtime = 'nodejs';

import { db } from '@/lib/db';
import { users } from '@/lib/schema';
import { verifyPassword, signToken } from '@/lib/auth';
import { tokenPayload, shouldResetTokens, defaultTokens } from '@/lib/user-helper';
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

    // Case-insensitive lookup so login matches regardless of how the email was typed/stored
    const [user] = await db.select().from(users).where(sql`lower(${users.email}) = ${email}`);
    if (!user) return Response.json({ detail: 'Invalid credentials' }, { status: 401 });

    const ok = await verifyPassword(password, user.hashed_password);
    if (!ok) return Response.json({ detail: 'Invalid credentials' }, { status: 401 });

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
    return Response.json({ detail: 'Login failed' }, { status: 500 });
  }
}
