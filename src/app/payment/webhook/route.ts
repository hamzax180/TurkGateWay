export const runtime = 'nodejs';

import { settlePurchase } from '@/lib/settle-purchase';

/**
 * Server-to-server notification from iyzico.
 *
 * Like the browser callback this is a public endpoint, so the body is only ever
 * used to obtain a lookup token. settlePurchase() does the authoritative
 * verification and the amount check before any credit is minted, and is
 * idempotent so repeated deliveries are harmless.
 *
 * Always returns 200 — a non-2xx makes the provider retry, and a retry storm
 * helps nobody when the failure is "this payment genuinely did not succeed".
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const token =
      (typeof body.token === 'string' && body.token) ||
      (typeof body.paymentConversationId === 'string' && body.paymentConversationId) ||
      '';

    if (!token) {
      console.warn('[payment/webhook] no token in payload');
      return Response.json({ received: true });
    }

    const result = await settlePurchase(token);
    if (!result.ok) {
      console.warn('[payment/webhook] not settled:', result.reason);
    } else {
      console.log(`[payment/webhook] purchase ${result.purchaseId} settled, ${result.creditIds.length} credits`);
    }

    return Response.json({ received: true });
  } catch (e) {
    console.error('[payment/webhook]', e);
    return Response.json({ received: true });
  }
}
