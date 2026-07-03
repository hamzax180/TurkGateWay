export const runtime = 'nodejs';

import { db } from '@/lib/db';
import { chatSessions } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { requireUser } from '@/lib/user-helper';

export async function DELETE(req: Request) {
  try {
    const user = await requireUser(req);
    await db.delete(chatSessions).where(eq(chatSessions.user_id, user.id));
    return Response.json({ status: 'cleared' });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return Response.json({ detail: 'Error' }, { status: 500 });
  }
}
