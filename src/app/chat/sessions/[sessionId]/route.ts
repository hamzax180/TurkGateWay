export const runtime = 'nodejs';

import { db } from '@/lib/db';
import { chatSessions, chatMessages } from '@/lib/schema';
import { eq, and } from 'drizzle-orm';
import { requireUser } from '@/lib/user-helper';

export async function DELETE(req: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    const user = await requireUser(req);
    const { sessionId } = await params;

    await db.delete(chatSessions)
      .where(and(eq(chatSessions.id, sessionId), eq(chatSessions.user_id, user.id)));

    return Response.json({ status: 'deleted' });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return Response.json({ detail: 'Error' }, { status: 500 });
  }
}
