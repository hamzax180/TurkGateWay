export const runtime = 'nodejs';

import { db } from '@/lib/db';
import { chatSessions } from '@/lib/schema';
import { eq, desc, and, isNotNull } from 'drizzle-orm';
import { requireUser } from '@/lib/user-helper';

export async function GET(req: Request) {
  try {
    const user = await requireUser(req);
    const url = new URL(req.url);
    const sessionId = url.searchParams.get('session_id');

    let session;
    if (sessionId) {
      [session] = await db
        .select()
        .from(chatSessions)
        .where(and(eq(chatSessions.id, sessionId), eq(chatSessions.user_id, user.id)));
    } else {
      [session] = await db
        .select()
        .from(chatSessions)
        .where(and(eq(chatSessions.user_id, user.id), isNotNull(chatSessions.dashboard_state)))
        .orderBy(desc(chatSessions.updated_at))
        .limit(1);
    }

    if (!session?.dashboard_state) {
      return Response.json({ detail: 'No workflow found' }, { status: 404 });
    }

    const state = JSON.parse(session.dashboard_state);
    return Response.json({ ...state, session_id: session.id, assistant_type: session.assistant_type });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return Response.json({ detail: 'Error' }, { status: 500 });
  }
}
