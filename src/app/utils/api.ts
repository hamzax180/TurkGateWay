/**
 * Shared API utility with:
 * - In-flight deduplication (same URL won't be fetched twice simultaneously)
 * - Backend offline detection to stop spam when server is down
 * - Auto reset after 10 seconds so it retries eventually
 */

const BACKEND_BASE = 'http://localhost:8003';
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

  // If a request is already in-flight, return a CLONED response of that promise
  if (!options && inFlight.has(key)) {
    const res = await inFlight.get(key);
    return res ? res.clone() : null;
  }

  const promise = fetch(`${BACKEND_BASE}${path}`, options)
    .then(async (res) => {
      markBackendOnline();
      
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
