export const runtime = 'nodejs';

import { timingSafeEqual } from 'crypto';
import { purgeExpired } from '@/lib/application-documents';

/**
 * The retention sweep.
 *
 * `purgeExpired()` has existed and been correct for a long time; nothing ever
 * called it. Applications carry a hard `purge_after` deadline precisely because
 * they hold passport-level PII, and a deadline nothing enforces is not a
 * retention policy — it is a comment.
 *
 * Invoked daily by Vercel Cron (see vercel.json). Vercel sends
 * `Authorization: Bearer $CRON_SECRET`, which is the only thing that may run
 * this: the route deletes rows, so an open endpoint here is a denial-of-service
 * against the applicants' own documents.
 *
 * Without CRON_SECRET set the route refuses outright rather than running
 * unauthenticated. A sweep that anyone may trigger is worse than one that has
 * not started yet, and a loud 503 is what gets the variable set.
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('[cron/purge] CRON_SECRET is not set — refusing to run an unauthenticated purge.');
    return Response.json({ detail: 'cron not configured' }, { status: 503 });
  }

  if (!presentedSecretMatches(req, secret)) {
    return Response.json({ detail: 'Not authorized' }, { status: 403 });
  }

  try {
    const deleted = await purgeExpired();
    // Deliberately logged even when zero: a run that finds nothing is the
    // evidence the sweep is alive, and silence would be indistinguishable from
    // the cron never firing — which is the exact failure being fixed.
    console.log(`[cron/purge] swept ${deleted} expired application(s)`);
    return Response.json({ ok: true, deleted });
  } catch (e) {
    console.error('[cron/purge] sweep failed', e);
    return Response.json({ detail: 'purge failed' }, { status: 500 });
  }
}

/** Vercel Cron issues GET; keep both doors on the same check. */
export const GET = POST;

/**
 * Constant-time compare on the bearer token.
 *
 * `===` on a secret leaks its prefix through timing. The length check comes
 * first because timingSafeEqual throws on a length mismatch, and lengths are
 * not the secret.
 */
function presentedSecretMatches(req: Request, secret: string): boolean {
  const auth = req.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return false;

  const presented = Buffer.from(auth.slice(7));
  const expected = Buffer.from(secret);
  if (presented.length !== expected.length) return false;
  return timingSafeEqual(presented, expected);
}
