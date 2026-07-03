export const runtime = 'nodejs';

import { db } from '@/lib/db';
import { chatSessions, chatMessages, users } from '@/lib/schema';
import { requireAdmin } from '@/lib/user-helper';
import { eq, asc } from 'drizzle-orm';

export async function GET(req: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    await requireAdmin(req);
    const { sessionId } = await params;

    const [session] = await db.select().from(chatSessions).where(eq(chatSessions.id, sessionId));
    if (!session) return Response.json({ detail: 'Not found' }, { status: 404 });

    const messages = await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.session_id, sessionId))
      .orderBy(asc(chatMessages.timestamp));

    let user = null;
    if (session.user_id) {
      const [u] = await db.select().from(users).where(eq(users.id, session.user_id));
      if (u) user = { id: u.id, email: u.email, full_name: u.full_name, subscription_status: u.subscription_status, token_balance: u.token_balance };
    }

    return Response.json({
      ...session,
      service_slots: session.service_slots ? JSON.parse(session.service_slots) : null,
      dashboard_state: session.dashboard_state ? JSON.parse(session.dashboard_state) : null,
      messages,
      user,
    });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return Response.json({ detail: 'Error' }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    await requireAdmin(req);
    const { sessionId } = await params;

    await db.delete(chatSessions).where(eq(chatSessions.id, sessionId));
    return Response.json({ status: 'deleted' });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return Response.json({ detail: 'Error' }, { status: 500 });
  }
}
