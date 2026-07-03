export const runtime = 'nodejs';

import { db } from '@/lib/db';
import { users } from '@/lib/schema';
import { eq } from 'drizzle-orm';

// POST /payment/webhook — iyzipay webhook for subscription updates
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));

    const { status, conversationId, paymentId } = body;

    if (conversationId) {
      const userIdMatch = String(conversationId).match(/^tg-(\d+)-/);
      if (userIdMatch) {
        const userId = parseInt(userIdMatch[1]);

        if (status === 'SUCCESS') {
          await db.update(users).set({
            subscription_status: 'active',
            subscription_reference_code: paymentId ?? conversationId,
            token_balance: 100,
            last_token_reset: new Date(),
          }).where(eq(users.id, userId));
        } else if (status === 'FAILURE' || status === 'CANCELED') {
          await db.update(users).set({
            subscription_status: 'past_due',
          }).where(eq(users.id, userId));
        }
      }
    }

    return Response.json({ status: 'ok' });
  } catch {
    return Response.json({ status: 'ok' }); // Always 200 to avoid webhook retries
  }
}
