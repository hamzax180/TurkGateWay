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

export const CACHE_TTL = 60 * 60 * 6; // 6 hours

export function cacheKey(query: string, lang: string, type: string) {
  return `tg:${type}:${lang}:${query.toLowerCase().trim().slice(0, 120)}`;
}
