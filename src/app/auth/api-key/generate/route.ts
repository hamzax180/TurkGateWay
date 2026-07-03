export const runtime = 'nodejs';

import { db } from '@/lib/db';
import { users } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { requireUser } from '@/lib/user-helper';
import { randomBytes } from 'crypto';

export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
    const newKey = `tg-${randomBytes(24).toString('hex')}`;
    await db.update(users).set({ api_key: newKey }).where(eq(users.id, user.id));
    return Response.json({ api_key: newKey });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return Response.json({ detail: 'Error' }, { status: 500 });
  }
}
