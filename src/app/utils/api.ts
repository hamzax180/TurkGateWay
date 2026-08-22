/**
 * Shared API utility with:
 * - In-flight deduplication (same URL won't be fetched twice simultaneously)
 * - Backend offline detection to stop spam when server is down
 * - Auto reset after 10 seconds so it retries eventually
 */

const BACKEND_BASE = process.env.NEXT_PUBLIC_API_URL || '';
const OFFLINE_COOLDOWN_MS = 10_000;

let backendOfflineSince: number | null = null;
const inFlight = new Map<string, Promise<Response | null>>();

function isBackendOffline(): boolean {
  if (backendOfflineSince === null) return false;
  if (Date.now() - backendOfflineSince > OFFLINE_COOLDOWN_MS) {
    backendOfflineSince = null; // reset cooldown
    return false;
  }
  return true;
}

export function markBackendOffline() {
  backendOfflineSince = Date.now();
}

export function markBackendOnline() {
  backendOfflineSince = null;
}

// ---------------------------------------------------------------------------
// Throttling
// ---------------------------------------------------------------------------

/**
 * A 429 is not an outage, and must not be treated as one: the offline path
 * below silences requests for 10 seconds and is reserved for a backend that
 * cannot be reached at all. A throttled request reached the server perfectly
 * well and got a considered answer.
 *
 * We record when the window frees up so the UI can say something useful, and
 * emit an event so a listener can surface it without every caller having to
 * check for status 429 itself.
 */
let throttledUntil = 0;

/** Seconds until the current rate-limit window frees up; 0 when not throttled. */
export function retryAfterSeconds(): number {
  const left = throttledUntil - Date.now();
  return left > 0 ? Math.ceil(left / 1000) : 0;
}

function markThrottled(res: Response) {
  const header = Number(res.headers.get('Retry-After'));
  const seconds = Number.isFinite(header) && header > 0 ? header : 30;
  throttledUntil = Date.now() + seconds * 1000;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('tg:rate-limited', { detail: { seconds, path: res.url } }),
    );
  }
}

/**
 * A fetch wrapper that:
 * 1. Silently returns null if the backend is known offline
 * 2. Deduplicates simultaneous identical requests
 * 3. Marks the backend offline on connection refused
 */
export async function apiFetch(
  path: string,
  options?: RequestInit
): Promise<Response | null> {
  if (isBackendOffline()) return null;

  const key = `${options?.method ?? 'GET'}:${path}`;

  // Auto-inject Authorization header if token exists
  const token = typeof window !== 'undefined' ? localStorage.getItem('permitops_token') : null;
  const enhancedHeaders = {
    ...(options?.headers || {}),
    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
  };

  const enhancedOptions = {
    ...options,
    headers: enhancedHeaders
  };

  // If a request is already in-flight, return a CLONED response of that promise
  if (!options && inFlight.has(key)) {
    const res = await inFlight.get(key);
    return res ? res.clone() : null;
  }

  const promise = fetch(`${BACKEND_BASE}${path}`, enhancedOptions)
    .then(async (res) => {
      markBackendOnline();
      
      // Throttled — record the window, but leave the response intact so the
      // caller can read its `detail` rather than guessing at a failure.
      if (res.status === 429) {
        markThrottled(res);
        return res;
      }

      // Global 401 Handling: If unauthorized, clear the token
      if (res.status === 401) {
        console.warn("Unauthorized request (401). Clearing token...");
        localStorage.removeItem('permitops_token');
        // Dispatch event for same-window listeners (standard 'storage' event only fires for OTHER windows)
        window.dispatchEvent(new StorageEvent('storage', { key: 'permitops_token', newValue: null }));
      }
      
      return res;
    })
    .catch((err) => {
      if (
        err instanceof TypeError &&
        (err.message.includes('Failed to fetch') ||
          err.message.includes('NetworkError'))
      ) {
        markBackendOffline();
      }
      return null;
    })
    .finally(() => {
      inFlight.delete(key);
    });

  if (!options) inFlight.set(key, promise);
  return promise;
}

export { BACKEND_BASE };
