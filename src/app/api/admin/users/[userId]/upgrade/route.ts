export const runtime = 'nodejs';

import { db } from '@/lib/db';
import { users, purchases, serviceCredits } from '@/lib/schema';
import { requireAdmin } from '@/lib/user-helper';
import { grantCreditsForPurchase } from '@/lib/credits';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';

/** How many service credits a manual upgrade hands over. */
const UPGRADE_CREDITS = 5;

/**
 * POST /api/admin/users/:id/upgrade — put an account on the paid plan.
 *
 * Upgrading now grants real service credits rather than only flipping a flag.
 * Everything that costs money is gated on a credit — starting a placement,
 * the document checklist, the automation, opening a voice call — so an account
 * marked "active" with nothing in its balance could not actually use any of
 * it. That mismatch is what made an upgraded account still get told to go and
 * buy something.
 *
 * The credits are minted through a real `purchases` row marked paid, not
 * inserted straight into service_credits. That costs one extra insert and buys
 * three things: the foreign key stays satisfied, the credit ledger records
 * where they came from, and the credits show up in the same statement as
 * bought ones instead of appearing from nowhere. `plan: 'admin-grant'` is
 * deliberately not a real plan id — grantCreditsForPurchase reserves seats
 * only for known family plans, so an unknown plan assigns every credit to the
 * account itself, which is what a manual grant should do.
 */
export async function POST(req: Request, { params }: { params: Promise<{ userId: string }> }) {
  try {
    await requireAdmin(req);
    const { userId } = await params;
    const id = parseInt(userId);
    const [user] = await db.select().from(users).where(eq(users.id, id));
    if (!user) return Response.json({ detail: 'Not found' }, { status: 404 });

    await db
      .update(users)
      .set({
        subscription_status: 'active',
        subscription_reference_code: user.subscription_reference_code ?? 'manual-upgrade',
        token_balance: 100,
        last_token_reset: new Date(),
      })
      .where(eq(users.id, user.id));

    // Top up to UPGRADE_CREDITS rather than adding blindly, so upgrading an
    // account twice does not quietly stack ten credits onto it.
    const [held] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(serviceCredits)
      .where(
        and(
          eq(serviceCredits.owner_user_id, user.id),
          isNull(serviceCredits.consumed_at),
          gt(serviceCredits.expires_at, new Date()),
        ),
      );

    const shortfall = Math.max(0, UPGRADE_CREDITS - Number(held?.n ?? 0));
    let granted = 0;

    if (shortfall > 0) {
      const [purchase] = await db
        .insert(purchases)
        .values({
          user_id: user.id,
          plan: 'admin-grant',
          amount_try_minor: 0,
          credits_granted: shortfall,
          status: 'paid',
          conversation_id: `admin-grant-${user.id}-${Date.now()}`,
          provider_ref: 'manual-upgrade',
          paid_at: new Date(),
        })
        .returning({ id: purchases.id });

      const ids = await grantCreditsForPurchase(purchase.id);
      granted = ids.length;
    }

    return Response.json({
      status: 'success',
      user_id: user.id,
      subscription_status: 'active',
      credits_granted: granted,
      credits_available: Number(held?.n ?? 0) + granted,
    });
  } catch (e) {
    if (e instanceof Response) return e;
    console.error('[admin/upgrade]', e);
    return Response.json({ detail: 'Error' }, { status: 500 });
  }
}
