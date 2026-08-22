export const runtime = 'nodejs';

import { db } from '@/lib/db';
import { users } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { requireUser } from '@/lib/user-helper';
import { verifyTotp } from '@/lib/auth';
import { z } from 'zod';

const schema = z.object({ code: z.string() });

/**
 * POST /auth/mfa/disable — turn MFA off.
 *
 * Requires a valid current code so a stolen session token cannot strip the
 * second factor by itself. Not present in the legacy backend; added because
 * an account with a lost authenticator must have a recovery path.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser(req);

    if (!user.mfa_enabled) {
      return Response.json({ detail: 'MFA is not enabled' }, { status: 400 });
    }

    const { code } = schema.parse(await req.json());
    if (!user.mfa_secret || !verifyTotp(user.mfa_secret, code)) {
      return Response.json({ detail: 'Invalid code' }, { status: 400 });
    }

    await db
      .update(users)
      .set({ mfa_enabled: false, mfa_secret: null })
      .where(eq(users.id, user.id));

    return Response.json({ status: 'success', message: 'MFA disabled' });
  } catch (e: any) {
    if (e instanceof Response) return e;
    if (e?.name === 'ZodError') return Response.json({ detail: 'Invalid input' }, { status: 422 });
    return Response.json({ detail: 'Error' }, { status: 500 });
  }
}
