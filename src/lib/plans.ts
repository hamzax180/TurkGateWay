/**
 * plans.ts
 * The price list. Server-authoritative — the client may say which plan it
 * wants, never what it costs.
 *
 * Prices are integer minor units (kuruş / cents) so money never touches a
 * float. TRY is what iyzico actually charges; the USD figure is display only.
 *
 * Two separate ladders, kept deliberately apart rather than merged into one
 * scale: 'individual' plans are solo credit packs; 'family' plans additionally
 * reserve seats for invites (see invitableSeats) so the buyer can hand credits
 * to other people. grantCreditsForPurchase() in credits.ts reads
 * invitableSeats generically, so adding another tier here is enough — no
 * plan-id string checks to update elsewhere.
 */

export type PlanTier = 'individual' | 'family';

export type PlanId = 'single' | 'triple' | 'six' | 'family' | 'family_plus' | 'business';

export interface Plan {
  id: PlanId;
  tier: PlanTier;
  /** Credits minted on successful payment. */
  credits: number;
  /** Charged amount, in kuruş. */
  priceTryMinor: number;
  /** Display-only, in cents. */
  priceUsdMinor: number;
  /**
   * Seats the buyer may invite. The buyer always keeps (credits - invitableSeats)
   * for themselves — for individual plans that's all of them (invitableSeats: 0).
   */
  invitableSeats: number;
  name: string;
  tagline: string;
  /** Basket-item label sent to iyzico. */
  label: string;
}

export const PLANS: Record<PlanId, Plan> = {
  // ── Individual — solo credit packs, minimum $10 / ₺350 ──────────────────
  single: {
    id: 'single', tier: 'individual',
    credits: 1,
    priceTryMinor: 35000,    // ₺350
    priceUsdMinor: 1000,     // $10
    invitableSeats: 0,
    name: 'Single',
    tagline: 'One service, whenever you need it',
    label: 'TurkGateway — 1 Service',
  },
  triple: {
    id: 'triple', tier: 'individual',
    credits: 3,
    priceTryMinor: 94500,    // ₺945  (~₺315/service)
    priceUsdMinor: 2700,     // $27   (~$9/service)
    invitableSeats: 0,
    name: 'Triple',
    tagline: 'For a few applications in a row',
    label: 'TurkGateway — 3 Services',
  },
  six: {
    id: 'six', tier: 'individual',
    credits: 6,
    priceTryMinor: 175000,   // ₺1750  (~₺292/service)
    priceUsdMinor: 5000,     // $50    (~$8.30/service)
    invitableSeats: 0,
    name: 'Six Pack',
    tagline: 'Best value for frequent use',
    label: 'TurkGateway — 6 Services',
  },

  // ── Family — shared credits, buyer + invites, minimum $45 / ₺1500 ───────
  family: {
    id: 'family', tier: 'family',
    credits: 5,
    priceTryMinor: 150000,   // ₺1500
    priceUsdMinor: 4500,     // $45
    invitableSeats: 4,       // buyer keeps 1, invites 4 — 5 people, 5 services
    name: 'Family',
    tagline: 'You + 4 people, one service each',
    label: 'TurkGateway Family — 5 Services',
  },
  family_plus: {
    id: 'family_plus', tier: 'family',
    credits: 10,
    priceTryMinor: 297500,   // ₺2975
    priceUsdMinor: 8500,     // $85
    invitableSeats: 9,       // buyer keeps 1, invites 9 — 10 people, 10 services
    name: 'Family Plus',
    tagline: 'You + 9 people, one service each',
    label: 'TurkGateway Family Plus — 10 Services',
  },
  business: {
    id: 'business', tier: 'family',
    credits: 25,
    priceTryMinor: 700000,   // ₺7000
    priceUsdMinor: 19900,    // $199
    invitableSeats: 24,      // buyer keeps 1, invites 24 — for teams/agencies
    name: 'Business',
    tagline: 'For teams and agencies',
    label: 'TurkGateway Business — 25 Services',
  },
};

export const PLAN_IDS = Object.keys(PLANS) as PlanId[];

export function isPlanId(value: unknown): value is PlanId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PLANS, value);
}

export function plansByTier(tier: PlanTier): Plan[] {
  return PLAN_IDS.map(id => PLANS[id]).filter(p => p.tier === tier);
}

/** 35000 → "350.00", the decimal string iyzico expects. */
export function minorToDecimalString(minor: number): string {
  return (minor / 100).toFixed(2);
}
