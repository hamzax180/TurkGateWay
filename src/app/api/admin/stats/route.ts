export const runtime = 'nodejs';

import { db } from '@/lib/db';
import { users, chatSessions, chatMessages } from '@/lib/schema';
import { requireAdmin } from '@/lib/user-helper';
import { eq, count } from 'drizzle-orm';

export async function GET(req: Request) {
  try {
    await requireAdmin(req);

    const [{ total_users }] = await db.select({ total_users: count() }).from(users);
    const [{ premium_users }] = await db.select({ premium_users: count() }).from(users).where(eq(users.subscription_status, 'active'));
    const [{ free_users }] = await db.select({ free_users: count() }).from(users).where(eq(users.subscription_status, 'free'));
    const [{ total_sessions }] = await db.select({ total_sessions: count() }).from(chatSessions);
    const [{ total_messages }] = await db.select({ total_messages: count() }).from(chatMessages);
    const [{ permit_sessions }] = await db.select({ permit_sessions: count() }).from(chatSessions).where(eq(chatSessions.assistant_type, 'permit'));
    const [{ student_sessions }] = await db.select({ student_sessions: count() }).from(chatSessions).where(eq(chatSessions.assistant_type, 'student'));
    const [{ lawyer_sessions }] = await db.select({ lawyer_sessions: count() }).from(chatSessions).where(eq(chatSessions.assistant_type, 'lawyer'));
    const [{ support_sessions }] = await db.select({ support_sessions: count() }).from(chatSessions).where(eq(chatSessions.assistant_type, 'support'));

    return Response.json({
      total_users,
      premium_users,
      free_users,
      mrr: premium_users * 299,
      total_sessions,
      total_messages,
      sessions_by_type: { permit: permit_sessions, student: student_sessions, lawyer: lawyer_sessions, support: support_sessions },
    });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return Response.json({ detail: 'Error' }, { status: 500 });
  }
}
