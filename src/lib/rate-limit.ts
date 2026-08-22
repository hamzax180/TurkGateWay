/**
 * rate-limit.ts
 * The one rate limiter. Used by middleware for every API route, and directly
 * by the auth routes for their extra email-keyed check.
 *
 * ── What was wrong before ─────────────────────────────────────────────────
 *
 * This module built a single `Ratelimit` at import time with a hardcoded
 * `slidingWindow(10, '60 s')`, which meant the `limit` and `windowSec`
 * arguments below were dead whenever Upstash was configured — every caller
 * silently got 10/minute no matter what it asked for. Limiters are now built
 * per policy and cached, so the arguments are real.
 *
 * ── Edge constraint ───────────────────────────────────────────────────────
 *
 * This file runs inside `middleware.ts`, which is an Edge runtime. It must not
 * import anything Node-only. That is why `identify()` verifies the JWT here
 * with jose rather than reusing `verifyToken` from ./auth — that module pulls
 * in bcryptjs and node:crypto, which would break the Edge build. It also means
 * identification is signature-verification only, with no database lookup, so
 * it costs nothing on the hot path.
 *
 * ── Failure mode ──────────────────────────────────────────────────────────
 *
 * If Upstash is unreachable, requests are ALLOWED rather than rejected. For a
 * consumer product, failing open is the right trade: a Redis blip should not
 * take down sign-in. It does mean the limiter is only as available as Upstash.
 */

import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { jwtVerify } from 'jose';

const hasUpstash =
  Boolean(process.env.UPSTASH_REDIS_REST_URL) &&
  Boolean(process.env.UPSTASH_REDIS_REST_TOKEN);

let _redis: Redis | null = null;
function redisClient(): Redis | null {
  if (!hasUpstash) return null;
  if (!_redis) {
    _redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    });
  }
  return _redis;
}

export interface RateLimitResult {
  success: boolean;
  /** The ceiling that applied, for RateLimit-Limit. */
  limit: number;
  /** Requests left in the window, for RateLimit-Remaining. */
  remaining: number;
  /** Epoch ms when the window frees up, for Retry-After / RateLimit-Reset. */
  reset: number;
}

// ---------------------------------------------------------------------------
// Upstash limiters, one per (limit, window) policy
// ---------------------------------------------------------------------------

/**
 * Built lazily and cached. The prefix keys each policy separately so a caller
 * spending its 3/minute browser budget doesn't also drain its 120/minute read
 * budget under the same Redis key.
 *
 * `ephemeralCache` lets Upstash reject an already-blocked identifier from
 * process memory without a network round trip — worth having now that this
 * runs on every API request rather than only on sign-in.
 */
const limiters = new Map<string, Ratelimit>();

function limiterFor(limit: number, windowSec: number): Ratelimit | null {
  const redis = redisClient();
  if (!redis) return null;

  const key = `${limit}:${windowSec}`;
  let limiter = limiters.get(key);
  if (!limiter) {
    limiter = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(limit, `${windowSec} s`),
      prefix: `rl:${key}`,
      ephemeralCache: new Map(),
      analytics: false,
    });
    limiters.set(key, limiter);
  }
  return limiter;
}

// ---------------------------------------------------------------------------
// In-memory fallback — correct for a single process, advisory on Vercel
// ---------------------------------------------------------------------------

const memory = new Map<string, number[]>();
const MAX_MEMORY_KEYS = 10_000;

function memoryWindow(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const recent = (memory.get(key) ?? []).filter((t) => now - t < windowMs);
  const success = recent.length < limit;
  if (success) recent.push(now);
  memory.set(key, recent);

  // Bound the map so a long-running dev server cannot grow it forever.
  if (memory.size > MAX_MEMORY_KEYS) {
    for (const [k, stamps] of memory) {
      if (stamps.every((t) => now - t >= windowMs)) memory.delete(k);
    }
  }

  return {
    success,
    limit,
    remaining: Math.max(0, limit - recent.length),
    reset: (recent[0] ?? now) + windowMs,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** IP + subject key, so one client cannot lock out another user's email. */
export function clientKey(req: Request, subject: string): string {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'anon';
  return `${ip}:${subject.toLowerCase().trim()}`;
}

/**
 * Who is this request? A signed-in caller is metered by user id so that
 * sharing an office NAT with someone else doesn't halve your budget; everyone
 * else falls back to IP.
 *
 * An invalid or expired token is not an error here — it just means we cannot
 * identify the caller, so they get the IP bucket. Rejecting bad tokens is the
 * route handler's job, not the limiter's.
 */
export async function identify(req: Request): Promise<string> {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'anon';

  const auth = req.headers.get('authorization');
  const secret = process.env.JWT_SECRET;
  if (auth?.startsWith('Bearer ') && secret) {
    try {
      const { payload } = await jwtVerify(
        auth.slice(7),
        new TextEncoder().encode(secret),
      );
      if (payload.sub) return `user:${payload.sub}`;
    } catch {
      // Unverifiable token — fall through to the IP bucket.
    }
  }

  return `ip:${ip}`;
}

export async function rateLimit(
  key: string,
  limit = 10,
  windowSec = 60,
): Promise<RateLimitResult> {
  const limiter = limiterFor(limit, windowSec);
  if (limiter) {
    try {
      const res = await limiter.limit(key);
      return {
        success: res.success,
        limit: res.limit,
        remaining: res.remaining,
        reset: res.reset,
      };
    } catch {
      // Upstash unreachable — fail open. See the note at the top of the file.
      return { success: true, limit, remaining: limit, reset: Date.now() + windowSec * 1000 };
    }
  }
  return memoryWindow(key, limit, windowSec * 1000);
}

/** True when limits are actually shared between instances. */
export function hasSharedLimiter(): boolean {
  return hasUpstash;
}
