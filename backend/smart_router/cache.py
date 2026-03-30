"""
cache.py
--------
In-memory LRU response cache with optional JSON persistence.
- Keyed by MD5 of normalized query string
- TTL: 1 hour
- Max size: 500 entries (LRU eviction)
- Persists to cache_store.json on every write
"""

import hashlib
import json
import os
import time
from collections import OrderedDict
from typing import Optional

_CACHE_FILE = os.path.join(os.path.dirname(__file__), "cache_store.json")
_MAX_SIZE = 500
_TTL_SECONDS = 3600  # 1 hour

# In-memory store: {key: {"response": str, "ts": float}}
_store: OrderedDict = OrderedDict()
_loaded = False


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _normalize(query: str) -> str:
    """Lowercase, strip whitespace, remove punctuation for a stable cache key."""
    import re
    text = query.lower().strip()
    text = re.sub(r"[^\w\s]", "", text)
    text = re.sub(r"\s+", " ", text)
    return text


def _make_key(query: str, assistant_type: str = "", language: str = "") -> str:
    key_string = f"{_normalize(query)}_{assistant_type}_{language}"
    return hashlib.md5(key_string.encode()).hexdigest()


def _load_from_disk() -> None:
    """Load persisted cache from JSON file (called once on first access)."""
    global _loaded
    if _loaded:
        return
    _loaded = True
    if not os.path.exists(_CACHE_FILE):
        return
    try:
        with open(_CACHE_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        now = time.time()
        for key, entry in data.items():
            if now - entry.get("ts", 0) < _TTL_SECONDS:
                _store[key] = entry
        # Enforce max size on load
        while len(_store) > _MAX_SIZE:
            _store.popitem(last=False)
    except Exception as e:
        print(f"[Cache] Failed to load from disk: {e}")


def _save_to_disk() -> None:
    """Persist current in-memory cache to JSON file."""
    try:
        with open(_CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump(dict(_store), f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"[Cache] Failed to save to disk: {e}")


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def get(query: str, assistant_type: str = "", language: str = "") -> Optional[str]:
    """
    Return cached response for query, or None if not found / expired.
    """
    _load_from_disk()
    key = _make_key(query, assistant_type, language)
    entry = _store.get(key)
    if entry is None:
        return None

    if time.time() - entry["ts"] > _TTL_SECONDS:
        # Expired — evict
        del _store[key]
        return None

    # LRU: move to end (most recently used)
    _store.move_to_end(key)
    print(f"[SmartRouter] CACHE HIT for: {query[:60]}")
    return entry["response"]


def set(query: str, response: str, assistant_type: str = "", language: str = "") -> None:
    """
    Store a response in the cache and persist to disk.
    Evicts the oldest entry when max size is reached.
    """
    _load_from_disk()
    key = _make_key(query, assistant_type, language)

    if key in _store:
        _store.move_to_end(key)

    _store[key] = {"response": response, "ts": time.time()}

    if len(_store) > _MAX_SIZE:
        evicted_key, _ = _store.popitem(last=False)
        print(f"[Cache] Evicted LRU entry: {evicted_key}")

    _save_to_disk()


def stats() -> dict:
    """Return basic cache stats for monitoring."""
    _load_from_disk()
    return {"size": len(_store), "max_size": _MAX_SIZE, "ttl_seconds": _TTL_SECONDS}
