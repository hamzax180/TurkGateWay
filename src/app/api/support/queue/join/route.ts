export const runtime = 'nodejs';

import { db } from '@/lib/db';
import { chatSessions } from '@/lib/schema';
import { joinSupportQueue } from '@/lib/support-queue';
import { openTicket } from '@/lib/support-tickets';
import { getOptionalUser } from '@/lib/user-helper';

/**
 * POST /api/support/queue/join
 * Body: { session_id, subject?, language? }
 * Creates the chat_sessions row (assistant_type 'support') so the transcript
 * is saved like any other conversation and appears in the admin dashboard,
 * then enters the queue: a free agent connects immediately, otherwise the
 * caller gets a ticket and a position.
 *
 * Also opens the durable support ticket, and returns its reference so the
 * customer can quote it back to us.
 */
export async function POST(req: Request) {
  try {
    const { session_id, subject, language } = await req.json();
    if (!session_id || typeof session_id !== 'string') {
      return Response.json({ detail: 'session_id required' }, { status: 400 });
    }

    try {
      await db
        .insert(chatSessions)
        .values({ id: session_id, title: 'Customer Service', assistant_type: 'support' })
        .onConflictDoNothing();
    } catch {
      // DB unavailable — the chat still works, it just won't be archived.
    }

    const { ticketId, result } = await joinSupportQueue(session_id);

    // Support is available to guests, so a missing or invalid token is normal
    // here — it just means the ticket has no account attached.
    let userId: number | null = null;
    try {
      const user = await getOptionalUser(req);
      userId = user?.id ?? null;
    } catch {
      userId = null;
    }

    const ticket = await openTicket({
      sessionId: session_id,
      subject: typeof subject === 'string' ? subject : null,
      agent: result.agent,
      userId,
      language: typeof language === 'string' ? language : null,
    });

    return Response.json({
      ticket_id: ticketId,
      status: result.status,
      agent: result.agent,
      position: result.position,
      eta_seconds: result.etaSeconds,
      ticket_ref: ticket?.ref ?? null,
    });
  } catch {
    return Response.json({ detail: 'Error' }, { status: 500 });
  }
}
