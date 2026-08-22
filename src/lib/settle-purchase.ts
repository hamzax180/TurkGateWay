/**
 * settle-purchase.ts
 * The single place a purchase can become 'paid' and mint credits.
 *
 * Both the browser callback and the server webhook funnel through here so the
 * verification cannot be bypassed by whichever door an attacker knocks on.
 *
 * Rules, in order:
 *   1. The checkout token is verified server-to-server with iyzico. Nothing in
 *      the incoming request body is trusted — it is all attacker-controllable.
 *   2. The purchase row is located by the conversationId iyzico echoes back,
 *      not by anything the caller supplied.
 *   3. The amount iyzico says was charged must match the amount we recorded
 *      when the checkout was created, or the purchase is rejected. This stops
 *      a tampered checkout paying ₺1 for a ₺1500 plan.
 *   4. Credit minting is idempotent, since providers retry callbacks.
 */

import { eq } from 'drizzle-orm';
import { db } from './db';
import { purchases } from './schema';
import { retrieveCheckout, toMinorUnits } from './iyzico';
import { grantCreditsForPurchase } from './credits';

export type SettleResult =
  | { ok: true; purchaseId: number; creditIds: number[] }
  | { ok: false; reason: string };

export async function settlePurchase(token: string): Promise<SettleResult> {
  if (!token) return { ok: false, reason: 'missing token' };

  // 1. Authoritative check with the provider.
  let detail;
  try {
    detail = await retrieveCheckout(token);
  } catch (e) {
    console.error('[settle] iyzico retrieve threw', e);
    return { ok: false, reason: 'provider unreachable' };
  }

  if (detail.status !== 'success' || detail.paymentStatus !== 'SUCCESS') {
    return { ok: false, reason: `provider says not paid (${detail.paymentStatus ?? detail.errorMessage ?? 'unknown'})` };
  }

  const conversationId = detail.conversationId;
  if (!conversationId) return { ok: false, reason: 'provider returned no conversationId' };

  // 2. Find our own record of what was supposed to be bought.
  const [purchase] = await db
    .select()
    .from(purchases)
    .where(eq(purchases.conversation_id, conversationId));

  if (!purchase) return { ok: false, reason: 'no matching purchase' };

  // 4a. Already settled — return the existing credits rather than minting more.
  if (purchase.status === 'paid') {
    const creditIds = await grantCreditsForPurchase(purchase.id);
    return { ok: true, purchaseId: purchase.id, creditIds };
  }

  // 3. The amount charged must be the amount we asked for.
  const paidMinor = toMinorUnits(detail.paidPrice);
  if (paidMinor === null || paidMinor !== purchase.amount_try_minor) {
    console.error(
      `[settle] amount mismatch on purchase ${purchase.id}: expected ${purchase.amount_try_minor}, provider reported ${paidMinor}`,
    );
    await db.update(purchases).set({ status: 'failed' }).where(eq(purchases.id, purchase.id));
    return { ok: false, reason: 'amount mismatch' };
  }

  if (detail.currency && detail.currency !== 'TRY') {
    return { ok: false, reason: `unexpected currency ${detail.currency}` };
  }

  await db
    .update(purchases)
    .set({ status: 'paid', paid_at: new Date(), provider_ref: detail.paymentId ?? token })
    .where(eq(purchases.id, purchase.id));

  // 4b. Mint. grantCreditsForPurchase is itself idempotent.
  const creditIds = await grantCreditsForPurchase(purchase.id);
  return { ok: true, purchaseId: purchase.id, creditIds };
}
