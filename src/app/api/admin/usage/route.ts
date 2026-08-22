export const runtime = 'nodejs';

import { db } from '@/lib/db';
import { serviceCredits, purchases, applications, users, chatSessions } from '@/lib/schema';
import { requireAdmin } from '@/lib/user-helper';
import { desc, eq, gte, sql } from 'drizzle-orm';

/**
 * GET /api/admin/usage?days=30 — the credit statement.
 *
 * In and out are reported as two separate columns, never netted into one
 * balance. "In" is credits bought; "out" is credits spent, broken down by the
 * service they were spent on. A single net number would answer none of the
 * questions this screen exists for — which service consumes the credits, and
 * whether a given account is spending more than it bought.
 *
 * The service a credit went to is DERIVED rather than stored: a consumed
 * credit carries the session it was spent in, and that session's application
 * says what kind it was. A credit spent with no application behind it paid for
 * a roadmap, which is the one deliverable that produces no application row.
 * Deriving it means the breakdown covers credits spent before any of this
 * existed, instead of starting empty.
 */
const SERVICE_EXPR = sql<string>`coalesce(${applications.kind}, 'roadmap')`;

export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    const days = Math.min(365, Math.max(1, Number(new URL(req.url).searchParams.get('days') ?? 30)));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // ── IN: credits bought ──────────────────────────────────────────────
    const [purchased] = await db
      .select({
        orders: sql<number>`count(*)::int`,
        credits: sql<number>`coalesce(sum(${purchases.credits_granted}), 0)::int`,
        revenueTryMinor: sql<number>`coalesce(sum(${purchases.amount_try_minor}), 0)::bigint`,
      })
      .from(purchases)
      .where(sql`${purchases.status} = 'paid' and ${purchases.created_at} >= ${since}`);

    // ── OUT: credits spent, by service ──────────────────────────────────
    const byService = await db
      .select({
        service: SERVICE_EXPR,
        credits: sql<number>`count(*)::int`,
      })
      .from(serviceCredits)
      .leftJoin(applications, eq(applications.session_id, serviceCredits.consumed_session_id))
      .where(sql`${serviceCredits.consumed_at} is not null and ${serviceCredits.consumed_at} >= ${since}`)
      .groupBy(SERVICE_EXPR)
      .orderBy(sql`count(*) desc`);

    const byUser = await db
      .select({
        userId: serviceCredits.owner_user_id,
        email: users.email,
        spent: sql<number>`count(*)::int`,
      })
      .from(serviceCredits)
      .leftJoin(users, eq(serviceCredits.owner_user_id, users.id))
      .where(sql`${serviceCredits.consumed_at} is not null and ${serviceCredits.consumed_at} >= ${since}`)
      .groupBy(serviceCredits.owner_user_id, users.email)
      .orderBy(sql`count(*) desc`)
      .limit(25);

    // ── Balances across the whole account base, not just this window ────
    const [balances] = await db
      .select({
        total: sql<number>`count(*)::int`,
        spent: sql<number>`count(*) filter (where ${serviceCredits.consumed_at} is not null)::int`,
        available: sql<number>`count(*) filter (where ${serviceCredits.consumed_at} is null and ${serviceCredits.expires_at} > now())::int`,
        expired: sql<number>`count(*) filter (where ${serviceCredits.consumed_at} is null and ${serviceCredits.expires_at} <= now())::int`,
      })
      .from(serviceCredits);

    const recent = await db
      .select({
        id: serviceCredits.id,
        at: serviceCredits.consumed_at,
        email: users.email,
        service: SERVICE_EXPR,
        sessionTitle: chatSessions.title,
      })
      .from(serviceCredits)
      .leftJoin(users, eq(serviceCredits.owner_user_id, users.id))
      .leftJoin(applications, eq(applications.session_id, serviceCredits.consumed_session_id))
      .leftJoin(chatSessions, eq(chatSessions.id, serviceCredits.consumed_session_id))
      .where(sql`${serviceCredits.consumed_at} is not null`)
      .orderBy(desc(serviceCredits.consumed_at))
      .limit(50);

    return Response.json({ days, purchased, byService, byUser, balances, recent });
  } catch (e) {
    if (e instanceof Response) return e;
    console.error('[admin/usage]', e);
    return Response.json({ detail: 'Error' }, { status: 500 });
  }
}
