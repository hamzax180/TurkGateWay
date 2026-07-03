export const runtime = 'nodejs';

import { db } from '@/lib/db';
import { users } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { requireUser } from '@/lib/user-helper';

export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
    const body = await req.json().catch(() => ({}));

    // iyzipay integration — forward to payment provider
    const IYZIPAY_API_KEY = process.env.IYZIPAY_API_KEY;
    const IYZIPAY_SECRET_KEY = process.env.IYZIPAY_SECRET_KEY;
    const IYZIPAY_BASE_URL = process.env.IYZIPAY_BASE_URL ?? 'https://sandbox-api.iyzipay.com';

    if (!IYZIPAY_API_KEY || !IYZIPAY_SECRET_KEY) {
      return Response.json({ detail: 'Payment provider not configured' }, { status: 503 });
    }

    // Build iyzipay checkout form request
    const conversationId = `tg-${user.id}-${Date.now()}`;
    const callbackUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/payment/callback`;

    const requestBody = {
      locale: 'tr',
      conversationId,
      price: '299',
      paidPrice: '299',
      currency: 'TRY',
      installment: '1',
      paymentChannel: 'WEB',
      paymentGroup: 'SUBSCRIPTION',
      callbackUrl,
      buyer: {
        id: String(user.id),
        name: user.full_name?.split(' ')[0] ?? 'User',
        surname: user.full_name?.split(' ').slice(1).join(' ') || 'User',
        email: user.email,
        identityNumber: '11111111111',
        registrationAddress: 'Istanbul, Turkey',
        city: 'Istanbul',
        country: 'Turkey',
        ip: '127.0.0.1',
      },
      shippingAddress: { contactName: user.full_name ?? 'User', city: 'Istanbul', country: 'Turkey', address: 'Istanbul, Turkey' },
      billingAddress: { contactName: user.full_name ?? 'User', city: 'Istanbul', country: 'Turkey', address: 'Istanbul, Turkey' },
      basketItems: [{
        id: 'premium-monthly',
        name: 'TurkGateWay Premium - Monthly',
        category1: 'SaaS',
        itemType: 'VIRTUAL',
        price: '299',
      }],
    };

    // Call iyzipay (simplified — use iyzipay npm package for production)
    const res = await fetch(`${IYZIPAY_BASE_URL}/payment/iyzipos/checkoutform/initialize/auth/ecommerce`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `IYZWS apiKey:${IYZIPAY_API_KEY}`,
      },
      body: JSON.stringify(requestBody),
    });

    const data = await res.json();
    return Response.json(data);
  } catch (e: any) {
    if (e instanceof Response) return e;
    return Response.json({ detail: 'Payment init failed' }, { status: 500 });
  }
}
