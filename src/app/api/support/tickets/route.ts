export const runtime = 'nodejs';

import { db } from '@/lib/db';
import { desc, eq } from 'drizzle-orm';
import { requireUser } from '@/lib/user-helper';
import { chatMessages, supportTickets } from '@/lib/schema';
import { sql } from 'drizzle-orm';

/**
 * GET /api/support/tickets
 * The signed-in customer's own tickets — their history with support, the
 * reference to quote, and where each one stands.
 *
 * Deliberately narrower than the admin view: no internal note, no other
 * customer's rows, and scoped by user_id rather than anything client-supplied.
 */
export async function GET(req: Request) {
  try {
    const user = await requireUser(req);

    const tickets = await db
      .select({
        id: supportTickets.id,
        ref: supportTickets.ref,
        session_id: supportTickets.session_id,
        subject: supportTickets.subject,
        status: supportTickets.status,
        priority: supportTickets.priority,
        category: supportTickets.category,
        agent: supportTickets.agent,
        created_at: supportTickets.created_at,
        last_message_at: supportTickets.last_message_at,
        resolved_at: supportTickets.resolved_at,
        message_count: sql<number>`(
          select count(*)::int from ${chatMessages} where ${chatMessages.session_id} = ${supportTickets.session_id}
        )`,
      })
      .from(supportTickets)
      .where(eq(supportTickets.user_id, user.id))
      .orderBy(desc(supportTickets.last_message_at))
      .limit(50);

    return Response.json({ tickets });
  } catch (e) {
    if (e instanceof Response) return e;
    return Response.json({ detail: 'Error' }, { status: 500 });
  }
}
