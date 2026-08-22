export const runtime = 'nodejs';

import { db } from '@/lib/db';
import { asc, eq } from 'drizzle-orm';
import { requireAdmin } from '@/lib/user-helper';
import { chatMessages, supportTickets, users } from '@/lib/schema';
import { updateTicket } from '@/lib/support-tickets';

/**
 * GET /api/admin/tickets/[ticketId]
 * One ticket plus its transcript. The transcript is not stored on the ticket —
 * it is the chat_messages rows for the same session, read in order.
 */
export async function GET(req: Request, ctx: { params: Promise<{ ticketId: string }> }) {
  try {
    await requireAdmin(req);
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
        language: supportTickets.language,
        created_at: supportTickets.created_at,
        first_response_at: supportTickets.first_response_at,
        last_message_at: supportTickets.last_message_at,
        resolved_at: supportTickets.resolved_at,
        rating: supportTickets.rating,
        internal_note: supportTickets.internal_note,
        user_email: users.email,
        user_name: users.full_name,
      })
      .from(supportTickets)
      .leftJoin(users, eq(users.id, supportTickets.user_id))
      .where(eq(supportTickets.id, id));

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

/**
 * PATCH /api/admin/tickets/[ticketId]
 * Body: { status?, priority?, internal_note?, agent? }
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ ticketId: string }> }) {
  try {
    await requireAdmin(req);
    const { ticketId } = await ctx.params;
    const id = Number(ticketId);
    if (!Number.isFinite(id)) return Response.json({ detail: 'Bad id' }, { status: 400 });

    const body = await req.json();
    await updateTicket(id, body ?? {});
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof Response) return e;
    return Response.json({ detail: 'Error' }, { status: 500 });
  }
}
