export const runtime = 'nodejs';

import { db } from '@/lib/db';
import { and, asc, eq } from 'drizzle-orm';
import { requireUser } from '@/lib/user-helper';
import { chatMessages, supportTickets } from '@/lib/schema';

/**
 * GET /api/support/tickets/[ticketId]
 * One of the caller's own tickets, with its transcript.
 *
 * Ownership is part of the WHERE clause rather than a check afterwards, so a
 * guessed id simply returns 404 instead of leaking that the ticket exists.
 */
export async function GET(req: Request, ctx: { params: Promise<{ ticketId: string }> }) {
  try {
    const user = await requireUser(req);
    const { ticketId } = await ctx.params;
    const id = Number(ticketId);
    if (!Number.isFinite(id)) return Response.json({ detail: 'Bad id' }, { status: 400 });

    const [ticket] = await db
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
      })
      .from(supportTickets)
      .where(and(eq(supportTickets.id, id), eq(supportTickets.user_id, user.id)));

    if (!ticket) return Response.json({ detail: 'Not found' }, { status: 404 });

    const messages = await db
      .select({
        id: chatMessages.id,
        role: chatMessages.role,
        content: chatMessages.content,
        timestamp: chatMessages.timestamp,
      })
      .from(chatMessages)
      .where(eq(chatMessages.session_id, ticket.session_id))
      .orderBy(asc(chatMessages.timestamp));

    return Response.json({ ticket, messages });
  } catch (e) {
    if (e instanceof Response) return e;
    return Response.json({ detail: 'Error' }, { status: 500 });
  }
}
