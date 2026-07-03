export const runtime = 'nodejs';
export const maxDuration = 60;

import { db } from '@/lib/db';
import { chatSessions } from '@/lib/schema';
import { eq, and, isNotNull, desc } from 'drizzle-orm';
import { requireUser } from '@/lib/user-helper';
import { orchestrate } from '@/lib/orchestrator';

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
    const step = state.execution_plan?.steps?.find((s: any) => s.id === stepIdNum);

    if (!step) {
      return Response.json({ detail: 'Step not found' }, { status: 404 });
    }

    // Use AI to generate detailed automation instructions for this step
    const prompt = `A user needs help completing this step in their Turkish permit/service process:

Step: "${step.title}"
Details: "${step.notes ?? ''}"
Required Documents: ${JSON.stringify(step.docs ?? [])}
Business/Service type: ${state.combined_result?.business_type ?? 'unknown'}
Location: ${state.combined_result?.location ?? 'Istanbul'}

Provide clear, actionable instructions on exactly how to complete this step in Turkey. Include:
- Which government portal or office to visit (with URL if applicable)
- Exact documents to bring
- Estimated time and cost
- Any tips to avoid common mistakes

Be concise and practical.`;

    const result = await orchestrate(prompt, session.assistant_type ?? 'permit', 'en');

    // Mark step as in-progress
    if (state.execution_plan?.steps) {
      state.execution_plan.steps = state.execution_plan.steps.map((s: any) =>
        s.id === stepIdNum ? { ...s, status: 'in_progress', notes: s.notes } : s,
      );
    }
    state.last_updated = new Date().toISOString();

    await db.update(chatSessions)
      .set({ dashboard_state: JSON.stringify(state), updated_at: new Date() })
      .where(eq(chatSessions.id, session.id));

    return Response.json({
      status: 'automation_ready',
      step_id: stepIdNum,
      instructions: result.content,
    });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return Response.json({ detail: 'Error' }, { status: 500 });
  }
}
