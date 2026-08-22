import { Redis } from '@upstash/redis';

// ---------------------------------------------------------------------------
// In-memory LRU cache — fallback when Upstash Redis is not configured
// ---------------------------------------------------------------------------
const LRU_MAX = 1000;
const LRU_DEFAULT_TTL = 60 * 60 * 6; // 6 hours in seconds

interface LRUEntry {
  value: string;
  ts: number;       // insertion timestamp (ms)
  ttl: number;      // TTL in seconds
}

// Module-level Map preserves insertion order — oldest entry is Map.keys().next()
const _lru = new Map<string, LRUEntry>();

export const memCache = {
  get(key: string): string | null {
    const entry = _lru.get(key);
    if (!entry) return null;

    // Expired?
    if (Date.now() - entry.ts > entry.ttl * 1000) {
      _lru.delete(key);
      return null;
    }

    // Move to end (most-recently used)
    _lru.delete(key);
    _lru.set(key, entry);
    return entry.value;
  },

  set(key: string, value: string, opts?: { ex?: number }): void {
    // Evict oldest entries when at capacity
    while (_lru.size >= LRU_MAX) {
      const firstKey = _lru.keys().next().value;
      if (firstKey !== undefined) _lru.delete(firstKey);
    }
    _lru.set(key, {
      value,
      ts: Date.now(),
      ttl: opts?.ex ?? LRU_DEFAULT_TTL,
    });
  },

  /**
   * Needed by the shared-state helpers below: releasing a claimed slot has to
   * actually free it, and an LRU that can only expire on a timer cannot.
   */
  del(key: string): void {
    _lru.delete(key);
  },
};

// ---------------------------------------------------------------------------
// Upstash Redis client — only instantiated when env vars are present
// ---------------------------------------------------------------------------
const hasUpstash =
  Boolean(process.env.UPSTASH_REDIS_REST_URL) &&
  Boolean(process.env.UPSTASH_REDIS_REST_TOKEN);

let _upstash: Redis | null = null;

function getUpstash(): Redis | null {
  if (!hasUpstash) return null;
  if (!_upstash) {
    _upstash = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    });
  }
  return _upstash;
}

// ---------------------------------------------------------------------------
// Unified redis object — tries Upstash first, falls back to memCache
// ---------------------------------------------------------------------------
export const redis = {
  async get<T = string>(key: string): Promise<T | null> {
    const client = getUpstash();
    if (client) {
      try {
        const val = await client.get<T>(key);
        if (val !== null && val !== undefined) return val;
      } catch {
        // Upstash unavailable — fall through to memCache
      }
    }
    const mem = memCache.get(key);
    return (mem !== null ? (mem as unknown as T) : null);
  },

  async set(key: string, value: unknown, opts?: { ex?: number }): Promise<void> {
    const strVal = typeof value === 'string' ? value : JSON.stringify(value);
    const client = getUpstash();
    if (client) {
      try {
        if (opts?.ex) {
          await client.set(key, strVal, { ex: opts.ex });
        } else {
          await client.set(key, strVal);
        }
        return;
      } catch {
        // Upstash unavailable — fall through to memCache
      }
    }
    memCache.set(key, strVal, opts);
  },
};

/**
 * Primitives the cache helpers above do not need, but shared state does.
 *
 * `claim` is the important one: it is the only way to hand out a resource —
 * a support agent, say — correctly when several server instances are running.
 * A read-then-write cannot do it, because two instances can both read "free"
 * before either writes. SET NX decides it in one atomic step at Redis.
 *
 * Without Upstash configured these fall back to the in-process map, which is
 * correct for a single instance (local dev) and no worse than what they
 * replace anywhere else.
 */
export const redisState = {
  /**
   * Take `key` only if nobody holds it. Returns true if we got it.
   * The TTL means a crashed holder releases automatically.
   */
  async claim(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    const client = getUpstash();
    if (client) {
      try {
        const res = await client.set(key, value, { nx: true, ex: ttlSeconds });
        return res === 'OK';
      } catch {
        // Fall through — better to serve with weaker guarantees than to fail.
      }
    }
    if (memCache.get(key) !== null) return false;
    memCache.set(key, value, { ex: ttlSeconds });
    return true;
  },

  async get(key: string): Promise<string | null> {
    const client = getUpstash();
    if (client) {
      try {
        const val = await client.get<string>(key);
        return val ?? null;
      } catch {
        /* fall through */
      }
    }
    return memCache.get(key);
  },

  /** Refresh the TTL on something we already hold — the heartbeat. */
  async renew(key: string, value: string, ttlSeconds: number): Promise<void> {
    const client = getUpstash();
    if (client) {
      try {
        await client.set(key, value, { ex: ttlSeconds });
        return;
      } catch {
        /* fall through */
      }
    }
    memCache.set(key, value, { ex: ttlSeconds });
  },

  /**
   * Renew only if `value` is still the holder.
   *
   * A plain SET would let a late heartbeat take a key back after it had
   * expired and been claimed by somebody else — the holder would be silently
   * overwritten and two callers would believe they own the same slot. The
   * GET-then-SET version of this check has the same race in a wider window,
   * so the comparison and the write have to happen together at Redis.
   *
   * Returns false when we no longer hold it, which is the caller's signal to
   * stop pretending it does.
   */
  async renewIfHeld(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    const client = getUpstash();
    if (client) {
      try {
        const res = await client.eval(
          `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('EXPIRE', KEYS[1], ARGV[2]) else return 0 end`,
          [key],
          [value, String(ttlSeconds)],
        );
        return Number(res) === 1;
      } catch {
        /* fall through */
      }
    }
    if (memCache.get(key) !== value) return false;
    memCache.set(key, value, { ex: ttlSeconds });
    return true;
  },

  async release(key: string): Promise<void> {
    const client = getUpstash();
    if (client) {
      try {
        await client.del(key);
        return;
      } catch {
        /* fall through */
      }
    }
    memCache.del(key);
  },

  /**
   * Release only our own claim. Same reasoning as renewIfHeld: releasing a key
   * that expired and was re-claimed would hand somebody else's slot away.
   */
  async releaseIfHeld(key: string, value: string): Promise<void> {
    const client = getUpstash();
    if (client) {
      try {
        await client.eval(
          `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end`,
          [key],
          [value],
        );
        return;
      } catch {
        /* fall through */
      }
    }
    if (memCache.get(key) === value) memCache.del(key);
  },

  /** Monotonic counter, used for queue positions. */
  async increment(key: string, ttlSeconds: number): Promise<number> {
    const client = getUpstash();
    if (client) {
      try {
        const n = await client.incr(key);
        if (n === 1) await client.expire(key, ttlSeconds);
        return n;
      } catch {
        /* fall through */
      }
    }
    const current = Number(memCache.get(key) ?? '0') + 1;
    memCache.set(key, String(current), { ex: ttlSeconds });
    return current;
  },
};

/** True when shared state is actually shared, rather than per-process. */
export function hasSharedState(): boolean {
  return hasUpstash;
}

export const CACHE_TTL = 60 * 60 * 6; // 6 hours

export function cacheKey(query: string, lang: string, type: string) {
  return `tg:${type}:${lang}:${query.toLowerCase().trim().slice(0, 120)}`;
}
