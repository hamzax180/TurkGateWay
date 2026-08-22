export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { hasQwenKey } from '@/lib/qwen';
import { hasSharedLimiter } from '@/lib/rate-limit';
import { hasIyzicoConfig } from '@/lib/iyzico';

/**
 * GET /api/health — is this deployment actually able to work?
 *
 * There was nothing to point uptime monitoring at, and no cheap way to tell a
 * deploy that boots from a deploy that can reach its dependencies.
 *
 * The database is genuinely probed, because "the process is up" and "the
 * process can reach Neon" are different facts and only the second one matters.
 * Everything else is a configuration check rather than a live call — pinging a
 * metered model provider on every health check would bill for monitoring.
 *
 * Reports configuration, never values. `degraded` rather than `down` for a
 * missing optional dependency: the app still serves without Upstash or iyzico,
 * it just serves with a property the operator should know it has lost.
 */
export async function GET() {
  const checks: Record<string, string> = {};

  let dbOk = false;
  const startedAt = Date.now();
  try {
    await db.execute(sql`select 1`);
    dbOk = true;
    checks.database = `ok (${Date.now() - startedAt}ms)`;
  } catch (e) {
    checks.database = 'unreachable';
    console.error('[health] database probe failed', e);
  }

  // Configured-or-not only. A missing model key means chat cannot answer at
  // all, so it counts against readiness the same way the database does.
  const modelOk = hasQwenKey();
  checks.model = modelOk ? 'configured' : 'DASHSCOPE_API_KEY missing';

  // Optional, but their absence changes how the app behaves in production:
  // without Upstash the rate limiter is per-process and therefore advisory.
  checks.rateLimiter = hasSharedLimiter() ? 'shared (upstash)' : 'per-process fallback';
  checks.payments = hasIyzicoConfig() ? 'configured' : 'not configured';
  checks.retentionSweep = process.env.CRON_SECRET ? 'armed' : 'CRON_SECRET missing';

  const ready = dbOk && modelOk;
  const degraded = ready && !hasSharedLimiter();

  return Response.json(
    {
      status: !ready ? 'down' : degraded ? 'degraded' : 'ok',
      checks,
      timestamp: new Date().toISOString(),
    },
    {
      status: ready ? 200 : 503,
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}
