export const runtime = 'nodejs';

import { db } from '@/lib/db';
import { users, chatSessions } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { requireUser } from '@/lib/user-helper';

// DELETE /auth/account — permanently delete user account and all data
export async function DELETE(req: Request) {
  try {
    const user = await requireUser(req);

    // Delete sessions (cascades to messages via FK)
    await db.delete(chatSessions).where(eq(chatSessions.user_id, user.id));

    // Delete user
    await db.delete(users).where(eq(users.id, user.id));

    return Response.json({ status: 'deleted' });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return Response.json({ detail: 'Error' }, { status: 500 });
  }
}
