/**
 * support-tools.ts
 * DB-backed helpers for the customer service agent.
 *
 * Customer service must be able to actually FIX account problems, not just
 * apologise for them. The classic one: a payment went through (iyzico marked
 * it paid) but the credits never landed — a lost webhook, a failed callback.
 * These helpers let the support agent look at the real data and repair it,
 * idempotently, so the customer leaves with what they paid for.
 */

import { db } from './db';
import { users, purchases, serviceCredits, creditLedger } from './schema';
import { and, eq, isNull } from 'drizzle-orm';
import { defaultTokens, shouldResetTokens } from './user-helper';

const CREDIT_LIFETIME_MS = 365 * 24 * 60 * 60 * 1000;

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  const head = local.slice(0, Math.min(2, local.length));
  return `${head}${'*'.repeat(Math.max(1, local.length - head.length))}@${domain ?? ''}`;
}

export type SupportAccountSummary = {
  email: string;
  creditsAvailable: number;
  creditsExpiringSoon: number;
  nextExpiry: string | null;
  tokenBalance: number;
  subscriptionStatus: string;
  purchases: {
    id: number;
    plan: string;
    status: string;
    creditsGranted: number;
    paidAt: string | null;
    amountTryMinor: number;
  }[];
  /** Paid purchases whose credit rows are missing — candidates for repair. */
  mismatches: { purchaseId: number; plan: string; missing: number }[];
};

export async function getSupportAccountSummary(userId: number): Promise<SupportAccountSummary> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) throw new Error('user not found');

  const now = new Date();
  const soon = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const credits = await db
    .select()
    .from(serviceCredits)
    .where(and(eq(serviceCredits.owner_user_id, userId), isNull(serviceCredits.consumed_at)));

  const available = credits.filter((c) => c.expires_at > now);
  const expiringSoon = available.filter((c) => c.expires_at <= soon);

  const purchaseRows = await db
    .select()
    .from(purchases)
    .where(eq(purchases.user_id, userId))
    .orderBy(purchases.id);

  const creditCounts = new Map<number, number>();
  for (const c of await db.select().from(serviceCredits)) {
    creditCounts.set(c.purchase_id, (creditCounts.get(c.purchase_id) ?? 0) + 1);
  }

  const mismatches = purchaseRows
    .filter((p) => p.status === 'paid')
    .map((p) => ({ purchaseId: p.id, plan: p.plan, missing: Math.max(0, p.credits_granted - (creditCounts.get(p.id) ?? 0)) }))
    .filter((m) => m.missing > 0);

  return {
    email: maskEmail(user.email),
    creditsAvailable: available.length,
    creditsExpiringSoon: expiringSoon.length,
    nextExpiry: available.length ? available[0].expires_at.toISOString() : null,
    tokenBalance: user.token_balance ?? 0,
    subscriptionStatus: user.subscription_status ?? 'free',
    purchases: purchaseRows.map((p) => ({
      id: p.id,
      plan: p.plan,
      status: p.status,
      creditsGranted: p.credits_granted,
      paidAt: p.paid_at ? p.paid_at.toISOString() : null,
      amountTryMinor: p.amount_try_minor,
    })),
    mismatches,
  };
}

/**
 * Repair: for every PAID purchase whose credit rows are missing, create the
 * missing credits (12-month lifetime from payment) and record the grant in
 * the ledger. Idempotent — running it twice restores nothing twice.
 */
export async function restoreMissingCreditsForUser(userId: number): Promise<{
  restored: number;
  creditsAvailable: number;
  repairedPurchases: number[];
}> {
  const paid = await db
    .select()
    .from(purchases)
    .where(and(eq(purchases.user_id, userId), eq(purchases.status, 'paid')));

  let restored = 0;
  const repairedPurchases: number[] = [];

  for (const purchase of paid) {
    const existing = await db
      .select({ id: serviceCredits.id })
      .from(serviceCredits)
      .where(eq(serviceCredits.purchase_id, purchase.id));

    const missing = Math.max(0, purchase.credits_granted - existing.length);
    if (missing === 0) continue;

    const base = purchase.paid_at ?? purchase.created_at ?? new Date();
    const expiresAt = new Date(base.getTime() + CREDIT_LIFETIME_MS);

    const rows = Array.from({ length: missing }, () => ({
      owner_user_id: userId,
      purchase_id: purchase.id,
      source: 'purchase' as const,
      expires_at: expiresAt,
    }));

    const inserted = await db.insert(serviceCredits).values(rows).returning({ id: serviceCredits.id });
    if (inserted.length) {
      await db.insert(creditLedger).values(
        inserted.map((c) => ({
          credit_id: c.id,
          user_id: userId,
          action: 'granted' as const,
          note: 'support restoration of a paid purchase with missing credits',
        })),
      );
      restored += inserted.length;
      repairedPurchases.push(purchase.id);
    }
  }

  const summary = await getSupportAccountSummary(userId);
  return { restored, creditsAvailable: summary.creditsAvailable, repairedPurchases };
}

/** Refill the free question allowance — for "my questions ran out" complaints. */
export type QuotaResetResult =
  | { ok: true; tokenBalance: number }
  | { ok: false; reason: 'not_due'; tokenBalance: number; refreshesAt: Date };

/**
 * Apply the scheduled free-quota refresh, but only when it is actually due.
 *
 * This used to refill on request, every time, with no cooldown — so anyone
 * could tell customer service "reset" and get their allowance back to 25 as
 * often as they liked. That is unmetered free usage of a paid model, and it
 * was reachable by simply asking.
 *
 * The refresh is a schedule, not a favour: `shouldResetTokens` already defines
 * when one is owed (12 hours for free accounts, 30 days for subscribers). This
 * now performs exactly that scheduled reset early-if-owed, and refuses
 * otherwise, reporting when the next one lands. The genuine support case — "my
 * quota should have refreshed and didn't" — still works, because in that case
 * the reset really is due.
 */
export async function resetUserTokenQuota(userId: number): Promise<QuotaResetResult> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) throw new Error('user not found');

  const balance = defaultTokens(user);

  if (!shouldResetTokens(user)) {
    const windowMs =
      user.subscription_status === 'active' ? 30 * 24 * 60 * 60 * 1000 : 12 * 60 * 60 * 1000;
    const last = user.last_token_reset ? new Date(user.last_token_reset).getTime() : Date.now();
    return {
      ok: false,
      reason: 'not_due',
      tokenBalance: user.token_balance ?? 0,
      refreshesAt: new Date(last + windowMs),
    };
  }

  // Conditional on last_token_reset not having moved since it was read, so two
  // simultaneous requests cannot both be granted.
  const updated = await db
    .update(users)
    .set({ token_balance: balance, last_token_reset: new Date() })
    .where(
      and(
        eq(users.id, userId),
        user.last_token_reset
          ? eq(users.last_token_reset, user.last_token_reset)
          : isNull(users.last_token_reset),
      ),
    )
    .returning({ id: users.id });

  if (!updated.length) {
    return {
      ok: false,
      reason: 'not_due',
      tokenBalance: user.token_balance ?? 0,
      refreshesAt: new Date(),
    };
  }

  return { ok: true, tokenBalance: balance };
}
