export const runtime = 'nodejs';

import { db } from '@/lib/db';
import { users } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { requireUser } from '@/lib/user-helper';
import { verifyTotp } from '@/lib/auth';
import { z } from 'zod';

const schema = z.object({ code: z.string() });

/**
 * POST /auth/mfa/verify — confirm a setup code and switch MFA on.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser(req);

    if (user.mfa_enabled) {
      return Response.json({ detail: 'MFA is already enabled' }, { status: 400 });
    }
    if (!user.mfa_secret) {
      return Response.json({ detail: 'MFA setup not initiated' }, { status: 400 });
    }

    const { code } = schema.parse(await req.json());
    if (!verifyTotp(user.mfa_secret, code)) {
      return Response.json({ detail: 'Invalid code' }, { status: 400 });
    }

    await db.update(users).set({ mfa_enabled: true }).where(eq(users.id, user.id));
    return Response.json({ status: 'success', message: 'MFA enabled' });
  } catch (e: any) {
    if (e instanceof Response) return e;
    if (e?.name === 'ZodError') return Response.json({ detail: 'Invalid input' }, { status: 422 });
    return Response.json({ detail: 'Error' }, { status: 500 });
  }
}
