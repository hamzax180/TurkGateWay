/**
 * iyzico.ts
 * Signed requests to iyzico, plus the verification step that must gate every
 * credit grant.
 *
 * Previously the payment routes sent an unsigned `Authorization: IYZWS
 * apiKey:...` header (which iyzico rejects in production) and, worse, granted
 * paid status straight from the callback body without ever asking iyzico
 * whether the payment happened. Since the callback is a public unauthenticated
 * endpoint and the user id came out of an attacker-controlled `conversationId`,
 * anyone could mint themselves a paid account:
 *
 *   curl -X POST /payment/callback -d 'status=success&token=x&conversationId=tg-1-1'
 *
 * With credits being purchasable that is a free-money hole, so retrieve() below
 * is mandatory before anything is granted.
 */

import { createHmac, randomBytes } from 'crypto';

export const IYZICO_BASE_URL = process.env.IYZIPAY_BASE_URL ?? 'https://sandbox-api.iyzipay.com';

export function hasIyzicoConfig(): boolean {
  return Boolean(process.env.IYZIPAY_API_KEY && process.env.IYZIPAY_SECRET_KEY);
}

/**
 * iyzico "HmacSHA256" auth: sign randomKey + uriPath + request body with the
 * secret, then send the digest hex-encoded inside an IYZWSv2 header.
 */
function authHeader(uriPath: string, body: string): { header: string; randomKey: string } {
  const apiKey = process.env.IYZIPAY_API_KEY!;
  const secret = process.env.IYZIPAY_SECRET_KEY!;
  const randomKey = `${Date.now()}${randomBytes(6).toString('hex')}`;

  const signature = createHmac('sha256', secret)
    .update(randomKey + uriPath + body)
    .digest('hex');

  const authParams = [
    `apiKey:${apiKey}`,
    `randomKey:${randomKey}`,
    `signature:${signature}`,
  ].join('&');

  return {
    header: `IYZWSv2 ${Buffer.from(authParams).toString('base64')}`,
    randomKey,
  };
}

async function call<T>(uriPath: string, payload: unknown): Promise<T> {
  const body = JSON.stringify(payload);
  const { header, randomKey } = authHeader(uriPath, body);

  const res = await fetch(`${IYZICO_BASE_URL}${uriPath}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: header,
      'x-iyzi-rnd': randomKey,
    },
    body,
  });

  return (await res.json()) as T;
}

export interface CheckoutInitResult {
  status?: string;
  errorMessage?: string;
  checkoutFormContent?: string;
  token?: string;
}

export function initializeCheckout(payload: unknown): Promise<CheckoutInitResult> {
  return call('/payment/iyzipos/checkoutform/initialize/auth/ecommerce', payload);
}

export interface CheckoutRetrieveResult {
  status?: string;
  /** 'SUCCESS' | 'FAILURE' */
  paymentStatus?: string;
  errorMessage?: string;
  conversationId?: string;
  paymentId?: string;
  /** Amount actually charged, as a decimal string e.g. "350.00". */
  paidPrice?: string;
  currency?: string;
}

/**
 * Ask iyzico what really happened for a checkout token.
 * This is the authoritative source — never trust the callback body.
 */
export function retrieveCheckout(token: string): Promise<CheckoutRetrieveResult> {
  return call('/payment/iyzipos/checkoutform/auth/ecommerce/detail', {
    locale: 'tr',
    token,
  });
}

/** "350.00" → 35000 kuruş. Money is compared in integer minor units. */
export function toMinorUnits(decimal: string | number | undefined): number | null {
  if (decimal === undefined || decimal === null) return null;
  const n = typeof decimal === 'number' ? decimal : parseFloat(decimal);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}
