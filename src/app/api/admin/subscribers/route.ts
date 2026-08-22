export const runtime = 'nodejs';

import { db } from '@/lib/db';
import { users, serviceCredits } from '@/lib/schema';
import { requireAdmin } from '@/lib/user-helper';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';

/**
 * GET /api/admin/subscribers
 *
 * Two balances per account, because the product has two and they answer
 * different questions. `free_questions` is the allowance that refreshes on a
 * schedule; `credits` is what was bought and is what actually unlocks the paid
 * services. An account can sit on 100 questions and still be unable to start a
 * placement, which is invisible unless both are on screen together.
 *
 * Credits are counted with a LEFT JOIN rather than per-row queries so the list
 * stays one round trip regardless of how many accounts there are.
 */
export async function GET(req: Request) {
  try {
    await requireAdmin(req);

    const all = await db
      .select({
        id: users.id,
        email: users.email,
        full_name: users.full_name,
        subscription_status: users.subscription_status,
        subscription_reference_code: users.subscription_reference_code,
        token_balance: users.token_balance,
        is_admin: users.is_admin,
        // Spendable right now: not consumed, not expired.
        credits: sql<number>`count(${serviceCredits.id}) filter (
          where ${serviceCredits.consumed_at} is null
            and ${serviceCredits.expires_at} > now()
        )::int`,
        credits_spent: sql<number>`count(${serviceCredits.id}) filter (
          where ${serviceCredits.consumed_at} is not null
        )::int`,
      })
      .from(users)
      .leftJoin(serviceCredits, eq(serviceCredits.owner_user_id, users.id))
      .groupBy(users.id);

    return Response.json(all);
  } catch (e) {
    if (e instanceof Response) return e;
    console.error('[admin/subscribers]', e);
    return Response.json({ detail: 'Error' }, { status: 500 });
  }
}
