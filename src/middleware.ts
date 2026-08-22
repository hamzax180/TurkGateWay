/**
 * middleware.ts
 * Applies the rate-limit policy to every API request.
 *
 * Enforcing here rather than in each handler is deliberate: the previous
 * arrangement had a call in 4 of 52 route handlers, and the 48 that mattered
 * most — vision extraction, browser automation, the Qwen endpoint — were the
 * ones nobody remembered. A route added next month inherits the `default` tier
 * without anyone doing anything.
 *
 * This runs on the Edge runtime, so everything it imports has to be Edge-safe.
 * `rate-limit.ts` and `rate-limit-policy.ts` are; do not import `./lib/auth`
 * (bcryptjs, node:crypto) or `./lib/db` here.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { identify, rateLimit } from '@/lib/rate-limit';
import { policyFor } from '@/lib/rate-limit-policy';

export async function middleware(req: NextRequest) {
  const tier = policyFor(req.nextUrl.pathname, req.method);
  if (!tier) return NextResponse.next();

  const who = await identify(req);
  const scope = `${tier.name}:${who}`;

  // The minute window first: it is the one that trips in practice, and
  // checking it first keeps the common path to a single round trip.
  const minute = await rateLimit(`m:${scope}`, tier.perMinute, 60);
  if (!minute.success) return tooMany(minute);

  if (tier.perDay) {
    const day = await rateLimit(`d:${scope}`, tier.perDay, 86_400);
    if (!day.success) return tooMany(day);
  }

  const res = NextResponse.next();
  applyHeaders(res.headers, minute);
  return res;
}

function tooMany(result: { limit: number; remaining: number; reset: number }) {
  const res = NextResponse.json(
    { detail: 'Too many requests. Please try again shortly.' },
    { status: 429 },
  );
  applyHeaders(res.headers, result);
  res.headers.set(
    'Retry-After',
    String(Math.max(1, Math.ceil((result.reset - Date.now()) / 1000))),
  );
  return res;
}

function applyHeaders(
  headers: Headers,
  result: { limit: number; remaining: number; reset: number },
) {
  headers.set('RateLimit-Limit', String(result.limit));
  headers.set('RateLimit-Remaining', String(result.remaining));
  headers.set('RateLimit-Reset', String(Math.ceil(result.reset / 1000)));
}

/**
 * API prefixes only.
 *
 * These are listed one by one rather than as a catch-all because several route
 * prefixes collide with pages: `/chat` is a page while `/chat/sessions` and
 * `/chat/history` are handlers, so a blanket `/chat/:path*` would meter page
 * navigations against the same budget as the API calls the page then makes.
 */
export const config = {
  matcher: [
    '/agent/:path*',
    '/api/:path*',
    '/auth/:path*',
    '/chat/sessions/:path*',
    '/chat/history/:path*',
    '/payment/:path*',
    '/workflow/:path*',
  ],
};
