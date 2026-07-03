export const runtime = 'nodejs';

import { db } from '@/lib/db';
import { chatSessions } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { getOptionalUser } from '@/lib/user-helper';

/**
 * e-Devlet / government portal automation.
 * Full Selenium-based automation is not possible in serverless.
 * This endpoint returns the correct portal URL and pre-filled instructions
 * so the user can complete the step manually in the opened window.
 */
export async function POST(req: Request) {
  try {
    const user = await getOptionalUser(req);
    const url = new URL(req.url);
    const sessionId = url.searchParams.get('session_id');

    const body = await req.json().catch(() => ({}));
    const { portal_url, step_id, tckn, full_name } = body;

    // Detect which portal this is
    const isMersis = portal_url?.includes('mersis') || portal_url?.includes('ticaret.gov');
    const isIkamet = portal_url?.includes('e-ikamet') || portal_url?.includes('goc.gov');
    const isInsurance = portal_url?.includes('sigorta');

    let instructions = '';
    let portalName = 'e-Devlet';

    if (isIkamet) {
      portalName = 'e-İkamet';
      instructions = `**e-İkamet Appointment Steps:**\n1. Go to ${portal_url}\n2. Click "Appointment" (Randevu Al)\n3. Select your province: Istanbul\n4. Choose "Residence Permit" type\n5. Pick an available date and time\n6. Enter your passport details when prompted\n7. Confirm and save your appointment slip`;
    } else if (isMersis) {
      portalName = 'MERSİS';
      instructions = `**MERSİS Company Registration Steps:**\n1. Go to ${portal_url}\n2. Click "New Application" (Yeni Başvuru)\n3. Select company type (Ltd. Şti. recommended)\n4. Fill in the Articles of Association template\n5. Add all founding partners' TC/passport numbers\n6. Upload required documents\n7. Submit and note your application number`;
    } else if (isInsurance) {
      portalName = 'e-İkamet Sigorta';
      instructions = `**Health Insurance Purchase Steps:**\n1. Go to ${portal_url}\n2. Select "İkamet Sigortası" (Residence Insurance)\n3. Enter your passport number and date of birth\n4. Choose 1-year coverage\n5. Complete payment (approx. 650-900 TL)\n6. Download your policy PDF — you'll need it for your İkamet appointment`;
    } else {
      instructions = `**Portal Steps:**\n1. Log in with your e-Devlet credentials at ${portal_url ?? 'https://giris.turkiye.gov.tr'}\n2. Find the relevant service\n3. Follow the on-screen instructions\n4. Save any confirmation numbers or receipts`;
    }

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
      portal_name: portalName,
      portal_url: portal_url,
      message: `Opening ${portalName}. Follow the steps below:`,
      instructions,
    });
  } catch (e: any) {
    return Response.json({ detail: 'Error' }, { status: 500 });
  }
}
