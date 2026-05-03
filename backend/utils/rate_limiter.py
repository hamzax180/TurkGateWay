import asyncio
import time
import hashlib
import json
from typing import Dict, Any

# Simple in-memory cache — stores successful responses only
_cache: Dict[str, Any] = {}

# Sequential lock so we never send two concurrent requests to Gemini
_api_lock = asyncio.Lock()
_last_call_time: float = 0
_COOLDOWN_SECONDS = 5.0

_MAX_RETRIES = 3
_RETRY_BASE_WAIT = 15.0  # seconds


def _make_cache_key(args, kwargs) -> str:
    ser = json.dumps([args, kwargs], sort_keys=True, default=str)
    return hashlib.md5(ser.encode()).hexdigest()


async def _wait_for_cooldown():
    global _last_call_time
    elapsed = time.time() - _last_call_time
    if elapsed < _COOLDOWN_SECONDS:
        wait = _COOLDOWN_SECONDS - elapsed
        print(f"[RateLimiter] Cooldown: {wait:.1f}s")
        await asyncio.sleep(wait)


async def throttled_run(agent, *args, **kwargs):
    """
    Run pydantic-ai agent with:
    - Sequential locking
    - Cooldown between calls
    - Automatic retry with exponential backoff on 429
    - In-memory caching of successful responses

    Uses asyncio.to_thread so pydantic-ai's sync internals
    don't deadlock FastAPI's event loop on Windows.
    """
    cache_key = _make_cache_key(args, kwargs)

    if cache_key in _cache:
        print("[RateLimiter] Cache hit")
        return _cache[cache_key]

    async with _api_lock:
        # Check again inside lock in case another coroutine filled it
        if cache_key in _cache:
            return _cache[cache_key]

        last_exc = None
        for attempt in range(_MAX_RETRIES + 1):
            await _wait_for_cooldown()

            try:
                print(f"[RateLimiter] Attempt {attempt + 1} — running agent in thread...")
                # Run pydantic-ai's synchronous run_sync in a thread pool
                # This avoids the nested event loop deadlock on Windows
                result = await asyncio.to_thread(agent.run_sync, *args, **kwargs)
                _last_call_time = time.time()
                _cache[cache_key] = result
                return result

            except Exception as exc:
                _last_call_time = time.time()
                err = str(exc).lower()
                last_exc = exc

                if "429" in err or "quota" in err or "rate" in err or "limit" in err:
                    if attempt < _MAX_RETRIES:
                        wait = _RETRY_BASE_WAIT * (2 ** attempt)
                        print(f"[RateLimiter] 429 on attempt {attempt + 1}, retrying in {wait:.0f}s...")
                        await asyncio.sleep(wait)
                        continue
                    raise last_exc
                else:
                    raise

        raise last_exc
