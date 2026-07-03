export const runtime = 'nodejs';

import { db } from '@/lib/db';
import { chatSessions } from '@/lib/schema';
import { eq, and, isNotNull, desc } from 'drizzle-orm';
import { requireUser } from '@/lib/user-helper';

export async function POST(req: Request, { params }: { params: Promise<{ stepId: string }> }) {
  try {
    const user = await requireUser(req);
    const { stepId } = await params;
    const url = new URL(req.url);
    const sessionId = url.searchParams.get('session_id');

    let session;
    if (sessionId) {
      [session] = await db.select().from(chatSessions)
        .where(and(eq(chatSessions.id, sessionId), eq(chatSessions.user_id, user.id)));
    } else {
      [session] = await db.select().from(chatSessions)
        .where(and(eq(chatSessions.user_id, user.id), isNotNull(chatSessions.dashboard_state)))
        .orderBy(desc(chatSessions.updated_at))
        .limit(1);
    }

    if (!session?.dashboard_state) {
      return Response.json({ detail: 'No workflow found' }, { status: 404 });
    }

    const state = JSON.parse(session.dashboard_state);
    const stepIdNum = parseInt(stepId);

    // Mark the step as completed
    if (state.execution_plan?.steps) {
      state.execution_plan.steps = state.execution_plan.steps.map((s: any) =>
        s.id === stepIdNum ? { ...s, status: 'completed' } : s,
      );
    }

    state.last_updated = new Date().toISOString();
    await db.update(chatSessions)
      .set({ dashboard_state: JSON.stringify(state), updated_at: new Date() })
      .where(eq(chatSessions.id, session.id));

    return Response.json({ status: 'completed', step_id: stepIdNum });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return Response.json({ detail: 'Error' }, { status: 500 });
  }
}
