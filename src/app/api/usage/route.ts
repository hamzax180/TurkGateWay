export const runtime = 'nodejs';

import { db } from '@/lib/db';
import { serviceCredits, applications, chatSessions } from '@/lib/schema';
import { requireUser, defaultTokens, shouldResetTokens } from '@/lib/user-helper';
import { desc, eq, sql } from 'drizzle-orm';

/**
 * GET /api/usage — the signed-in user's own credit statement.
 *
 * Reports no revenue or cost figure of any kind. What the platform earns or
 * spends is our number, not the customer's, and unit economics leaking through
 * a customer endpoint is very hard to take back once it has.
 *
 * Two balances, kept separate because the product genuinely has two and
 * running them together is what made "how many credits do I have" ambiguous:
 *   · questions — the free allowance, refreshed on a schedule
 *   · credits   — bought, spent per service, valid until their expiry
 */
const SERVICE_EXPR = sql<string>`coalesce(${applications.kind}, 'roadmap')`;

export async function GET(req: Request) {
  try {
    const user = await requireUser(req);

    const windowMs =
      user.subscription_status === 'active' ? 30 * 24 * 60 * 60 * 1000 : 12 * 60 * 60 * 1000;
    const lastReset = user.last_token_reset ? new Date(user.last_token_reset).getTime() : Date.now();

    const questions = {
      remaining: user.token_balance ?? 0,
      allowance: defaultTokens(user),
      refreshesAt: new Date(lastReset + windowMs).toISOString(),
      refreshDue: shouldResetTokens(user),
    };

    const [credits] = await db
      .select({
        purchased: sql<number>`count(*)::int`,
        spent: sql<number>`count(*) filter (where ${serviceCredits.consumed_at} is not null)::int`,
        available: sql<number>`count(*) filter (where ${serviceCredits.consumed_at} is null and ${serviceCredits.expires_at} > now())::int`,
        expired: sql<number>`count(*) filter (where ${serviceCredits.consumed_at} is null and ${serviceCredits.expires_at} <= now())::int`,
      })
      .from(serviceCredits)
      .where(eq(serviceCredits.owner_user_id, user.id));

    // Where their credits went, one row per service.
    const byService = await db
      .select({
        service: SERVICE_EXPR,
        credits: sql<number>`count(*)::int`,
      })
      .from(serviceCredits)
      .leftJoin(applications, eq(applications.session_id, serviceCredits.consumed_session_id))
      .where(sql`${serviceCredits.owner_user_id} = ${user.id} and ${serviceCredits.consumed_at} is not null`)
      .groupBy(SERVICE_EXPR)
      .orderBy(sql`count(*) desc`);

    // The statement itself — one line per credit, in and out.
    const history = await db
      .select({
        id: serviceCredits.id,
        source: serviceCredits.source,
        grantedAt: serviceCredits.created_at,
        consumedAt: serviceCredits.consumed_at,
        expiresAt: serviceCredits.expires_at,
        service: SERVICE_EXPR,
        sessionTitle: chatSessions.title,
      })
      .from(serviceCredits)
      .leftJoin(applications, eq(applications.session_id, serviceCredits.consumed_session_id))
      .leftJoin(chatSessions, eq(chatSessions.id, serviceCredits.consumed_session_id))
      .where(eq(serviceCredits.owner_user_id, user.id))
      .orderBy(desc(serviceCredits.created_at))
      .limit(50);

    return Response.json({
      plan: user.subscription_status ?? 'free',
      questions,
      credits,
      byService,
      history,
    });
  } catch (e) {
    if (e instanceof Response) return e;
    console.error('[api/usage]', e);
    return Response.json({ detail: 'Error' }, { status: 500 });
  }
}
