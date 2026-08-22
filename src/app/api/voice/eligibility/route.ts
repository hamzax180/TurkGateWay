export const runtime = 'nodejs';

import { getOptionalUser } from '@/lib/user-helper';
import { getCreditBalance } from '@/lib/credits';

/**
 * GET /api/voice/eligibility — may this person start a voice call?
 *
 * The call is for customers: holding at least one unspent service credit is
 * what opens it. It does NOT spend one. A call is how somebody tells us what
 * they need, and charging for that would mean charging before we have done
 * anything — the credit is spent later, when the service they asked for
 * actually starts.
 *
 * So this endpoint only ever READS the balance. There is deliberately no code
 * path here that consumes, reserves or decrements anything, which is the
 * property worth being able to point at.
 */
export async function GET(req: Request) {
  try {
    const user = await getOptionalUser(req);
    if (!user) {
      return Response.json({ allowed: false, reason: 'sign_in_required', credits: 0 });
    }

    const balance = await getCreditBalance(user.id);
    const credits = balance.available;

    // Admins are not customers. Requiring them to buy a credit to open the
    // feature they are testing makes the product untestable by the people who
    // own it — and since the call spends nothing, exempting them costs nothing.
    if (user.is_admin) {
      return Response.json({
        allowed: true,
        reason: 'admin',
        credits,
        consumesCredit: false,
      });
    }

    return Response.json({
      allowed: credits > 0,
      reason: credits > 0 ? 'ok' : 'credit_required',
      credits,
      // Stated in the payload so the client cannot imply otherwise in its copy.
      consumesCredit: false,
    });
  } catch (e) {
    if (e instanceof Response) return e;
    console.error('[voice/eligibility]', e);
    return Response.json({ allowed: false, reason: 'error', credits: 0 }, { status: 500 });
  }
}
