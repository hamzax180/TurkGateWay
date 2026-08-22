export const runtime = 'nodejs';

import { settlePurchase } from '@/lib/settle-purchase';

/**
 * Browser return URL after iyzico checkout.
 *
 * This endpoint is public and unauthenticated — iyzico POSTs the user's browser
 * here — so nothing in the request body may be believed. The only field used is
 * `token`, and even that is treated purely as a lookup key: settlePurchase()
 * asks iyzico directly what happened and reconciles against the purchase row we
 * created before checkout.
 *
 * Previously this route read a user id straight out of the posted
 * `conversationId` and granted paid status, meaning anyone could POST
 * `status=success&conversationId=tg-1-1` and upgrade any account for free.
 */
export async function POST(req: Request) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

  try {
    const form = await req.formData().catch(() => null);
    const body = form
      ? Object.fromEntries(form.entries())
      : await req.json().catch(() => ({} as Record<string, unknown>));

    const token = typeof body.token === 'string' ? body.token : '';
    const result = await settlePurchase(token);

    if (!result.ok) {
      console.warn('[payment/callback] not settled:', result.reason);
      return Response.redirect(`${appUrl}/pricing?payment=failed`, 303);
    }

    return Response.redirect(`${appUrl}/applications?payment=success`, 303);
  } catch (e) {
    console.error('[payment/callback]', e);
    return Response.redirect(`${appUrl}/pricing?payment=failed`, 303);
  }
}

export async function GET() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  return Response.redirect(`${appUrl}/pricing`, 303);
}
