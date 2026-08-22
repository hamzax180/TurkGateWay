export const runtime = 'nodejs';

import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { purchases } from '@/lib/schema';
import { requireUser } from '@/lib/user-helper';
import { hasIyzicoConfig, initializeCheckout } from '@/lib/iyzico';
import { PLANS, isPlanId, minorToDecimalString } from '@/lib/plans';

/**
 * Start a checkout.
 *
 * The client picks a plan id; the price comes from the server-side price list
 * in plans.ts. A `pending` purchase row is written first so the callback has
 * something authoritative to reconcile against — the plan and expected amount
 * are never read back out of the provider's response.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser(req);

    const url = new URL(req.url);
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const requested = body.plan ?? url.searchParams.get('plan');

    if (!isPlanId(requested)) {
      return Response.json({ detail: 'Unknown plan' }, { status: 400 });
    }
    const plan = PLANS[requested];

    if (!hasIyzicoConfig()) {
      return Response.json({ detail: 'Payment provider not configured' }, { status: 503 });
    }

    // conversationId is the only identifier that survives the round trip, so it
    // carries the purchase row id. It is still treated as untrusted on the way
    // back — the callback re-reads the row and verifies with iyzico.
    const [purchase] = await db
      .insert(purchases)
      .values({
        user_id: user.id,
        plan: plan.id,
        amount_try_minor: plan.priceTryMinor,
        amount_usd_minor: plan.priceUsdMinor,
        credits_granted: plan.credits,
        status: 'pending',
      })
      .returning({ id: purchases.id });

    const conversationId = `tg-${user.id}-${purchase.id}-${Date.now()}`;
    await db
      .update(purchases)
      .set({ conversation_id: conversationId })
      .where(eq(purchases.id, purchase.id));

    const price = minorToDecimalString(plan.priceTryMinor);
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

    const data = await initializeCheckout({
      locale: 'tr',
      conversationId,
      price,
      paidPrice: price,
      currency: 'TRY',
      installment: '1',
      paymentChannel: 'WEB',
      paymentGroup: 'PRODUCT',
      callbackUrl: `${appUrl}/payment/callback`,
      buyer: {
        id: String(user.id),
        name: user.full_name?.split(' ')[0] ?? 'User',
        surname: user.full_name?.split(' ').slice(1).join(' ') || 'User',
        email: user.email,
        identityNumber: '11111111111',
        registrationAddress: 'Istanbul, Turkey',
        city: 'Istanbul',
        country: 'Turkey',
        ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || '127.0.0.1',
      },
      shippingAddress: { contactName: user.full_name ?? 'User', city: 'Istanbul', country: 'Turkey', address: 'Istanbul, Turkey' },
      billingAddress: { contactName: user.full_name ?? 'User', city: 'Istanbul', country: 'Turkey', address: 'Istanbul, Turkey' },
      basketItems: [{
        id: `${plan.id}-credits`,
        name: plan.label,
        category1: 'SaaS',
        itemType: 'VIRTUAL',
        price,
      }],
    });

    if (data.status !== 'success' || !data.checkoutFormContent) {
      console.error('[payment/subscribe] iyzico init failed', data.errorMessage);
      await db.update(purchases).set({ status: 'failed' }).where(eq(purchases.id, purchase.id));
      return Response.json({ detail: data.errorMessage ?? 'Payment init failed' }, { status: 502 });
    }

    return Response.json(data);
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error('[payment/subscribe]', e);
    return Response.json({ detail: 'Payment init failed' }, { status: 500 });
  }
}
