export const runtime = 'nodejs';

import { leaveSupportQueue } from '@/lib/support-queue';

/**
 * POST /api/support/queue/leave
 * Body: { ticket_id?, session_id }
 * Frees the slot or removes the waiting ticket so no agent stays occupied by
 * a closed chat.
 */
export async function POST(req: Request) {
  try {
    const { ticket_id, session_id } = await req.json();
    if (!session_id || typeof session_id !== 'string') {
      return Response.json({ detail: 'session_id required' }, { status: 400 });
    }

    await leaveSupportQueue(typeof ticket_id === 'string' ? ticket_id : null, session_id);
    return Response.json({ status: 'left' });
  } catch {
    return Response.json({ detail: 'Error' }, { status: 500 });
  }
}
