export const runtime = 'nodejs';

import { db } from '@/lib/db';
import { chatSessions } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { getOptionalUser } from '@/lib/user-helper';
import { generateIkametRunbook } from '@/lib/ikamet-automation';

/**
 * e-İkamet (residence permit) automation runbook.
 *
 * Qwen turns the applicant's own answers into a runbook for
 * e-ikamet.goc.gov.tr: which fields get filled, and — separately — which
 * buttons the USER presses. Nothing here clicks İleri, Kaydet or Başvuru Yap;
 * those are returned as `user_actions` for the dashboard to prompt.
 *
 * This endpoint used to be `/api/submit-edevlet` and also carried MERSİS,
 * insurance and a generic e-Devlet branch. Those were removed: they only ever
 * returned hardcoded prose, and the shared shape meant the caller collected
 * portal credentials it had no business holding. The İkamet runbook — the one
 * part that actually did something — is all that remains.
 *
 * It deliberately accepts NO credentials. A previous version of the caller
 * posted the applicant's government-portal password and TCKN here; both were
 * discarded unread, but they still crossed the network and could land in
 * request logs. Nothing in this flow needs them, so nothing sends them.
 */
export async function POST(req: Request) {
  try {
    await getOptionalUser(req);
    const url = new URL(req.url);
    const sessionId = url.searchParams.get('session_id');

    const body = await req.json().catch(() => ({}));
    const {
      step_id, full_name, passport_no, passport_type,
      ikamet_type, dob, is_extension, father_name, mother_name,
      nationality_id, nationality, gender, email, phone,
    } = body;

    const { runbook, mode } = await generateIkametRunbook({
      isExtension: Boolean(is_extension),
      fields: {
        full_name: full_name ?? '',
        passport_no: passport_no ?? '',
        passport_type: passport_type ?? '',
        ikamet_type: ikamet_type ?? '',
        dob: dob ?? '',
        father_name: father_name ?? '',
        mother_name: mother_name ?? '',
        nationality_id: nationality_id ?? '',
        nationality: nationality ?? '',
        gender: gender ?? '',
        email: email ?? '',
        phone: phone ?? '',
      },
    });

    const instructions = [
      `**${runbook.portal_name} — the bot fills every field, YOU press the buttons:**`,
      ...runbook.user_actions.map((a, i) => `${i + 1}. ${a.button} — ${a.instruction}`),
      '',
      ...runbook.notes.map((n) => `• ${n}`),
    ].join('\n');

    // Mark the step as in-progress in dashboard state if session exists
    if (sessionId && step_id) {
      const [session] = await db.select().from(chatSessions).where(eq(chatSessions.id, sessionId));
      if (session?.dashboard_state) {
        const state = JSON.parse(session.dashboard_state);
        if (state.execution_plan?.steps) {
          state.execution_plan.steps = state.execution_plan.steps.map((s: any) =>
            s.id === parseInt(step_id) ? { ...s, status: 'in_progress' } : s,
          );
          state.last_updated = new Date().toISOString();
          await db.update(chatSessions)
            .set({ dashboard_state: JSON.stringify(state), updated_at: new Date() })
            .where(eq(chatSessions.id, sessionId));
        }
      }
    }

    return Response.json({
      status: 'success',
      portal_name: runbook.portal_name,
      portal_url: runbook.target_url,
      automation_mode: mode,
      bot_actions: runbook.bot_actions,
      user_actions: runbook.user_actions,
      message: `Opening ${runbook.portal_name}. The bot fills every field — YOU press the buttons.`,
      instructions,
    });
  } catch {
    return Response.json({ detail: 'Error' }, { status: 500 });
  }
}
