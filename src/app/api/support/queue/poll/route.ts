export const runtime = 'nodejs';

import { pollSupportQueue } from '@/lib/support-queue';

/**
 * POST /api/support/queue/poll
 * Body: { ticket_id, session_id }
 * Acts as both heartbeat (keeps the slot alive for connected chats) and the
 * promotion check for waiting tickets — the first waiter takes the next free
 * agent. Returns { status: 'connected' | 'waiting' | 'dropped', agent?, position? }.
 */
export async function POST(req: Request) {
  try {
    const { ticket_id, session_id } = await req.json();
    if (!session_id || typeof session_id !== 'string') {
      return Response.json({ detail: 'session_id required' }, { status: 400 });
    }

    const result = await pollSupportQueue(typeof ticket_id === 'string' ? ticket_id : '', session_id);
    return Response.json({
      status: result.status,
      agent: result.agent,
      position: result.position,
      eta_seconds: result.etaSeconds,
    });
  } catch {
    return Response.json({ detail: 'Error' }, { status: 500 });
  }
}
