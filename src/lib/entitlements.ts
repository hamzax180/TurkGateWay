import { universityServicePaid } from './university-intake';

/**
 * entitlements.ts
 * One place that decides whether a session may have a paid thing.
 *
 * This exists because the same bug happened four times in one day. The rule
 * "the university checklist costs a credit" was implemented in the agent's
 * tool, and then had to be implemented again — separately, from memory — in
 * the checklist endpoint, the upload endpoint, the automation endpoint and the
 * session-rebuild endpoint. Each of those was a real leak found by a user, and
 * each was fixed in isolation. A fifth route serving the same data would have
 * missed it too, because nothing connected them.
 *
 * The fix is not another check. It is having exactly one function that knows
 * the answer, so a new data path has something obvious to call, and so the
 * rule can change in one edit rather than five.
 *
 *   const gate = await checkEntitlement({ feature: 'university_checklist', sessionId });
 *   if (!gate.allowed) return entitlementResponse(gate);
 */

/** Everything that is sold. Adding a paid capability means adding it here. */
export type Feature =
  | 'university_checklist'
  | 'university_uploads'
  | 'university_automation';

export type Entitlement =
  | { allowed: true }
  | { allowed: false; reason: 'payment_required'; feature: Feature; detail: string }
  | { allowed: false; reason: 'sign_in_required'; feature: Feature; detail: string };

/**
 * Which features a given paid service unlocks.
 *
 * All three university features are bought by the same credit — the checklist,
 * the uploads and the automation are one product, not three. Keeping the
 * mapping explicit means the next paid capability declares what pays for it
 * rather than inheriting an implicit rule.
 */
const UNIVERSITY_FEATURES: Feature[] = [
  'university_checklist',
  'university_uploads',
  'university_automation',
];

const DETAIL: Record<Feature, string> = {
  university_checklist: 'This checklist unlocks when the placement service is started.',
  university_uploads: 'Start the placement service before uploading documents.',
  university_automation: 'Start the placement service first.',
};

export async function checkEntitlement(opts: {
  feature: Feature;
  sessionId: string | null | undefined;
  /** Whether the caller has verified this session belongs to the signed-in user. */
  ownsSession?: boolean;
}): Promise<Entitlement> {
  const { feature, sessionId, ownsSession = true } = opts;

  if (!UNIVERSITY_FEATURES.includes(feature)) return { allowed: true };

  // A guest has no application row and no way to hold a credit, so there is
  // nothing that could have been paid for.
  if (!sessionId || sessionId.startsWith('guest-') || !ownsSession) {
    return {
      allowed: false,
      reason: 'sign_in_required',
      feature,
      detail: DETAIL[feature],
    };
  }

  if (await universityServicePaid(sessionId)) return { allowed: true };

  return { allowed: false, reason: 'payment_required', feature, detail: DETAIL[feature] };
}

/**
 * The refusal, as an HTTP response.
 *
 * 402 for both cases on purpose: from the client's point of view the thing is
 * simply not available yet, and the remedy — start the service — is the same
 * whether they are signed out or merely unpaid. `payment_required` in the body
 * is what the checklist card keys off to hide itself.
 */
export function entitlementResponse(gate: Extract<Entitlement, { allowed: false }>): Response {
  return Response.json(
    { detail: gate.detail, payment_required: true, feature: gate.feature, reason: gate.reason },
    { status: 402 },
  );
}
