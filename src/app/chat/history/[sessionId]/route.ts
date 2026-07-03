export const runtime = 'nodejs';

import { db } from '@/lib/db';
import { chatMessages, chatSessions } from '@/lib/schema';
import { eq, and, asc } from 'drizzle-orm';
import { requireUser } from '@/lib/user-helper';

// GET /chat/history/[sessionId] — fetch all messages
export async function GET(req: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    const user = await requireUser(req);
    const { sessionId } = await params;

    const messages = await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.session_id, sessionId))
      .orderBy(asc(chatMessages.timestamp));

    return Response.json(messages);
  } catch (e: any) {
    if (e instanceof Response) return e;
    return Response.json({ detail: 'Error' }, { status: 500 });
  }
}

// DELETE /chat/history/[sessionId] — clear all messages
export async function DELETE(req: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    const user = await requireUser(req);
    const { sessionId } = await params;

    await db.delete(chatMessages).where(eq(chatMessages.session_id, sessionId));
    return Response.json({ status: 'cleared' });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return Response.json({ detail: 'Error' }, { status: 500 });
  }
}
