/**
 * credits.ts
 * Service credits — one credit buys one finalised roadmap.
 *
 * Replaces the old subscription binary (`users.subscription_status`) as the
 * thing that gates paid work. Chat is unaffected and stays on the free token
 * quota in user-helper.ts.
 *
 * The critical property here is that a credit can never be spent twice. Every
 * mutation that spends or reserves goes through a single conditional UPDATE
 * whose WHERE clause includes the current state, so two concurrent requests
 * cannot both win — the second one matches zero rows.
 */

import { randomBytes } from 'crypto';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { db } from './db';
import { creditLedger, familyInvites, purchases, serviceCredits } from './schema';
import { PLANS, isPlanId } from './plans';

/** Credits are valid for 12 months from purchase. */
export const CREDIT_LIFETIME_MS = 365 * 24 * 60 * 60 * 1000;

export interface CreditBalance {
  available: number;
  /** Soonest expiry among available credits, for "2 expire on 3 March" copy. */
  nextExpiry: Date | null;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getCreditBalance(userId: number): Promise<CreditBalance> {
  const rows = await db
    .select({ expires_at: serviceCredits.expires_at })
    .from(serviceCredits)
    .where(
      and(
        eq(serviceCredits.owner_user_id, userId),
        isNull(serviceCredits.consumed_at),
        gt(serviceCredits.expires_at, new Date()),
      ),
    );

  let nextExpiry: Date | null = null;
  for (const r of rows) {
    if (r.expires_at && (!nextExpiry || r.expires_at < nextExpiry)) nextExpiry = r.expires_at;
  }
  return { available: rows.length, nextExpiry };
}

export async function availableCredits(userId: number): Promise<number> {
  return (await getCreditBalance(userId)).available;
}

// ---------------------------------------------------------------------------
// Spend
// ---------------------------------------------------------------------------

/**
 * Spend exactly one credit, oldest-expiring first.
 *
 * Returns the consumed credit id, or null when the user has none — callers
 * MUST treat null as a hard stop and do no paid work.
 *
 * Concurrency: the id is chosen by a sub-select inside the UPDATE and the
 * WHERE re-asserts `consumed_at IS NULL`, so the statement is atomic at the
 * row level. Two simultaneous calls with one credit remaining produce exactly
 * one winner; the loser updates zero rows and gets null.
 */
export async function consumeCredit(
  userId: number,
  sessionId?: string,
): Promise<number | null> {
  const result = await db.execute(sql`
    UPDATE service_credits
       SET consumed_at = NOW(),
           consumed_session_id = ${sessionId ?? null}
     WHERE id = (
       SELECT id FROM service_credits
        WHERE owner_user_id = ${userId}
          AND consumed_at IS NULL
          AND expires_at > NOW()
        ORDER BY expires_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
     )
       AND consumed_at IS NULL
    RETURNING id
  `);

  const rows = (result as unknown as { rows?: Array<{ id: number }> }).rows
    ?? (result as unknown as Array<{ id: number }>);
  const creditId = Array.isArray(rows) ? rows[0]?.id : undefined;
  if (!creditId) return null;

  await logCredit(creditId, userId, 'consumed', sessionId);
  return creditId;
}

/**
 * Return a credit to the user after paid work failed.
 * Idempotent: only un-consumes a credit that is currently consumed.
 */
export async function refundCredit(
  creditId: number,
  userId: number,
  note = 'generation failed',
): Promise<void> {
  await db
    .update(serviceCredits)
    .set({ consumed_at: null, consumed_session_id: null })
    .where(and(eq(serviceCredits.id, creditId), sql`consumed_at IS NOT NULL`));

  await logCredit(creditId, userId, 'refunded', undefined, note);
}

// ---------------------------------------------------------------------------
// Mint
// ---------------------------------------------------------------------------

/**
 * Create the credits for a paid purchase.
 *
 * Only ever called from the payment callback AFTER the payment has been
 * verified server-to-server with iyzico. Never call this from a client-facing
 * route — that would be a free-money endpoint.
 *
 * For a family purchase the buyer keeps one credit and the remaining four are
 * left unowned (owner_user_id NULL), reserved for invites.
 */
export async function grantCreditsForPurchase(purchaseId: number): Promise<number[]> {
  const [purchase] = await db.select().from(purchases).where(eq(purchases.id, purchaseId));
  if (!purchase) throw new Error(`grantCreditsForPurchase: purchase ${purchaseId} not found`);
  if (purchase.status !== 'paid') throw new Error(`grantCreditsForPurchase: purchase ${purchaseId} is not paid`);

  // Idempotency — a provider may deliver the same callback more than once.
  const existing = await db
    .select({ id: serviceCredits.id })
    .from(serviceCredits)
    .where(eq(serviceCredits.purchase_id, purchaseId));
  if (existing.length > 0) return existing.map(e => e.id);

  const total = purchase.credits_granted;
  const expiresAt = new Date(Date.now() + CREDIT_LIFETIME_MS);
  // Derived from the plan config rather than a hardcoded plan-id check, so a
  // new family-style tier (family_plus, business, ...) needs no change here —
  // its invitableSeats is enough to describe how many credits stay reserved.
  const plan = isPlanId(purchase.plan) ? PLANS[purchase.plan] : null;
  const ownedByBuyer = plan ? total - plan.invitableSeats : total;

  const rows = Array.from({ length: total }, (_, i) => ({
    owner_user_id: i < ownedByBuyer ? purchase.user_id : null,
    purchase_id: purchaseId,
    source: 'purchase',
    expires_at: expiresAt,
  }));

  const inserted = await db.insert(serviceCredits).values(rows).returning({ id: serviceCredits.id });

  for (let i = 0; i < inserted.length; i++) {
    await logCredit(
      inserted[i].id,
      i < ownedByBuyer ? purchase.user_id : null,
      i < ownedByBuyer ? 'granted' : 'reserved',
      undefined,
      `purchase ${purchaseId} (${purchase.plan})`,
    );
  }

  return inserted.map(r => r.id);
}

// ---------------------------------------------------------------------------
// Family seats
// ---------------------------------------------------------------------------

export function newInviteToken(): string {
  return `inv-${randomBytes(24).toString('hex')}`;
}

/** An unowned, unspent, unexpired credit from this purchase — i.e. a free seat. */
export async function findReservedCredit(purchaseId: number): Promise<number | null> {
  const [row] = await db
    .select({ id: serviceCredits.id })
    .from(serviceCredits)
    .where(
      and(
        eq(serviceCredits.purchase_id, purchaseId),
        isNull(serviceCredits.owner_user_id),
        isNull(serviceCredits.consumed_at),
      ),
    )
    .limit(1);
  return row?.id ?? null;
}

/**
 * Hand a reserved credit to a real user. Guarded on `owner_user_id IS NULL` so
 * a credit already claimed by someone else cannot be reassigned.
 */
export async function assignCreditToUser(
  creditId: number,
  userId: number,
  note?: string,
): Promise<boolean> {
  const updated = await db
    .update(serviceCredits)
    .set({ owner_user_id: userId, source: 'family' })
    .where(and(eq(serviceCredits.id, creditId), isNull(serviceCredits.owner_user_id)))
    .returning({ id: serviceCredits.id });

  if (updated.length === 0) return false;
  await logCredit(creditId, userId, 'assigned', undefined, note);
  return true;
}

/**
 * Claim any family seats waiting on this email address.
 * Called after signup — the invitee may have been invited before they existed.
 */
export async function claimPendingInvites(userId: number, email: string): Promise<number> {
  const pending = await db
    .select()
    .from(familyInvites)
    .where(and(eq(familyInvites.email, email.toLowerCase()), eq(familyInvites.status, 'pending')));

  let claimed = 0;
  for (const invite of pending) {
    const ok = await assignCreditToUser(invite.credit_id, userId, `family invite ${invite.id}`);
    if (!ok) continue;
    await db
      .update(familyInvites)
      .set({ status: 'accepted', accepted_user_id: userId, accepted_at: new Date() })
      .where(eq(familyInvites.id, invite.id));
    claimed++;
  }
  return claimed;
}

// ---------------------------------------------------------------------------

async function logCredit(
  creditId: number,
  userId: number | null,
  action: string,
  sessionId?: string,
  note?: string,
): Promise<void> {
  try {
    await db.insert(creditLedger).values({
      credit_id: creditId,
      user_id: userId,
      action,
      session_id: sessionId ?? null,
      note: note ?? null,
    });
  } catch (e) {
    // The ledger is an audit trail, not a correctness dependency — never let a
    // logging failure roll back or block a real credit movement.
    console.error('[credits] ledger write failed', e);
  }
}
