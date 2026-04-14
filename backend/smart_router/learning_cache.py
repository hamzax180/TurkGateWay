"""
learning_cache.py
-----------------
Smart Learning Cache — permanently saves AI API responses into the local
response library so they can be served offline on future identical/similar queries.

How it works:
  1. When the AI fallback generates a response, we call `learn()`.
  2. `learn()` normalizes the query, classifies it by agent + intent,
     and appends the response to the correct JSON response library file.
  3. On the next identical query, the keyword router matches the intent
     and `_pick_response()` finds the learned response in the library — 
     zero API tokens consumed.
  4. For queries that land in the "learned" bucket (no known intent),
     `find_learned_response()` performs fuzzy matching against previously
     stored query+response pairs — also zero API tokens consumed.

Files modified:
  - agents/{agent}/responses.json      (English)
  - agents/{agent}/responses_tr.json   (Turkish)
  - agents/{agent}/responses_ar.json   (Arabic)

Safety:
  - Max 10 learned responses per intent (prevents bloat)
  - Max 50 learned query+response pairs per agent (prevents unbounded growth)
  - Duplicate detection (won't save the same response twice)
  - Thread-safe file writes with locking
  - Only saves responses that are >50 chars (filters out errors/noise)
"""

import json
import os
import re
import threading
from difflib import SequenceMatcher
from typing import Optional
from datetime import datetime

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
_AGENTS_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "agents")
_MAX_LEARNED_PER_INTENT = 10       # Max learned responses per intent key
_MAX_LEARNED_PAIRS = 50            # Max query+response pairs in "learned" bucket
_MIN_RESPONSE_LENGTH = 50          # Ignore tiny/error responses
_FUZZY_MATCH_THRESHOLD = 0.75      # Min similarity to return a learned response
_LEARNING_LOG = os.path.join(os.path.dirname(__file__), "learning_log.json")
_file_lock = threading.Lock()

# Pre-compiled regex for normalization
_RE_NON_WORD = re.compile(r"[^\w\s]")
_RE_MULTI_SPACE = re.compile(r"\s+")

# In-memory reference to the live library (set by __init__.py on load)
_live_library: dict = {}


def set_live_library(lib: dict):
    """Called by __init__.py to share the in-memory response library reference."""
    global _live_library
    _live_library = lib


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _normalize_query(query: str) -> str:
    """Lowercase, strip whitespace, remove punctuation for stable matching."""
    text = query.lower().strip()
    text = _RE_NON_WORD.sub("", text)
    text = _RE_MULTI_SPACE.sub(" ", text)
    return text


def _get_response_file(agent: str, language: str) -> str:
    """Return the path to the agent's response JSON file for a given language."""
    suffix = f"_{language}" if language != "en" else ""
    return os.path.join(_AGENTS_DIR, agent, f"responses{suffix}.json")


def _get_learned_file(agent: str, language: str) -> str:
    """Return the path to the agent's learned JSON file for a given language."""
    suffix = f"_{language}" if language != "en" else ""
    return os.path.join(_AGENTS_DIR, agent, f"learned{suffix}.json")


def _load_json(filepath: str) -> dict:
    """Safely load a JSON file, returning empty dict on failure."""
    if not os.path.exists(filepath):
        return {}
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        print(f"[LearningCache] Failed to read {filepath}: {e}")
        return {}


def _save_json(filepath: str, data: dict):
    """Safely write a JSON file."""
    try:
        os.makedirs(os.path.dirname(filepath), exist_ok=True)
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"[LearningCache] Failed to write {filepath}: {e}")


def _is_duplicate(existing_responses: list, new_response: str) -> bool:
    """Check if the response (or something very similar) already exists."""
    for r in existing_responses:
        # Handle both string entries (curated) and dict entries (learned pairs)
        text = r if isinstance(r, str) else r.get("r", "")
        if text == new_response:
            return True
        # Fuzzy: if first 80 chars match
        if text[:80].lower().strip() == new_response[:80].lower().strip():
            return True
    return False


def _classify_intent(query: str, assistant_type: str) -> Optional[str]:
    """
    Try to classify the query into a known intent key (sub_intent).
    Uses the keyword_router for detection.
    Returns the sub_intent string (e.g., 'visa', 'renew_id') or 'learned' as fallback.
    """
    try:
        from .keyword_router import detect_intent
        intent_group, sub_intent, confidence = detect_intent(query, assistant_type)
        
        # Only accept high-confidence matches from the correct agent
        if confidence >= 0.7 and intent_group == assistant_type and sub_intent:
            return sub_intent
        
        # If no good match, classify into a 'learned' bucket
        return "learned"
    except Exception:
        return "learned"


# ---------------------------------------------------------------------------
# Learning Log (tracks what we learned and when)
# ---------------------------------------------------------------------------

def _log_learning(query: str, agent: str, intent: str, language: str):
    """Append to learning log for auditability."""
    try:
        log = _load_json(_LEARNING_LOG)
        if not isinstance(log, list):
            log = []
        
        log.append({
            "query": query[:100],
            "agent": agent,
            "intent": intent,
            "language": language,
            "timestamp": datetime.now().isoformat()
        })
        
        # Keep last 200 entries
        if len(log) > 200:
            log = log[-200:]
        
        with _file_lock:
            with open(_LEARNING_LOG, "w", encoding="utf-8") as f:
                json.dump(log, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"[LearningCache] Log error: {e}")


# ---------------------------------------------------------------------------
# Public API: Learn
# ---------------------------------------------------------------------------

def learn(
    query: str,
    response: str,
    assistant_type: str,
    language: str = "en",
    intent_hint: Optional[str] = None
) -> bool:
    """
    Save an AI-generated response into the permanent response library.
    
    Args:
        query: The original user query
        response: The AI-generated response text
        assistant_type: 'permit', 'student', or 'lawyer'
        language: 'en', 'tr', or 'ar'
        intent_hint: Optional pre-classified intent (sub_intent)
    
    Returns:
        True if the response was saved, False if skipped.
    """
    # --- Guard clauses ---
    if not response or len(response.strip()) < _MIN_RESPONSE_LENGTH:
        return False
    
    if assistant_type not in ("permit", "student", "lawyer"):
        return False
    
    # Don't learn error messages or redirect messages
    skip_markers = ["REDIRECT_NEW_CHAT", "Critical Error", "switch to", "mode using the selector"]
    if any(m.lower() in response.lower() for m in skip_markers):
        return False
    
    # --- Classify the intent ---
    intent_key = intent_hint or _classify_intent(query, assistant_type)
    
    # --- Route to the correct file ---
    if intent_key == "learned":
        # Learned entries go to the separate learned.json
        filepath = _get_learned_file(assistant_type, language)
    else:
        # Known-intent entries go to the curated responses.json
        filepath = _get_response_file(assistant_type, language)
    
    with _file_lock:
        data = _load_json(filepath)
        
        # Ensure the intent key exists
        if intent_key not in data:
            data[intent_key] = []
        
        existing = data[intent_key]
        
        # --- Safety checks ---
        if _is_duplicate(existing, response):
            print(f"[LearningCache] SKIP duplicate for {assistant_type}.{intent_key}")
            return False
        
        if intent_key == "learned":
            # "learned" bucket uses dict format: {"q": ..., "r": ...}
            if len(existing) >= _MAX_LEARNED_PAIRS:
                # Evict oldest entry
                existing.pop(0)
                print(f"[LearningCache] Evicted oldest learned entry for {assistant_type} ({language})")
            
            data[intent_key].append({
                "q": _normalize_query(query),
                "r": response.strip()
            })
        else:
            # Known intent: use simple string list (compatible with curated library)
            if len(existing) >= _MAX_LEARNED_PER_INTENT:
                print(f"[LearningCache] SKIP — {assistant_type}.{intent_key} already has {len(existing)} responses (max {_MAX_LEARNED_PER_INTENT})")
                return False
            
            data[intent_key].append(response.strip())
        
        _save_json(filepath, data)
    
    # Update the in-memory library so it takes effect immediately
    if _live_library:
        lang_lib = _live_library.get(language, {})
        agent_data = lang_lib.get(assistant_type, {})
        if isinstance(agent_data, dict):
            if intent_key not in agent_data:
                agent_data[intent_key] = []
            if intent_key == "learned":
                agent_data[intent_key].append({
                    "q": _normalize_query(query),
                    "r": response.strip()
                })
            elif not _is_duplicate(agent_data[intent_key], response):
                agent_data[intent_key].append(response.strip())
    
    # Log it
    _log_learning(query, assistant_type, intent_key, language)
    
    print(f"[LearningCache] ✅ LEARNED new response for {assistant_type}.{intent_key} ({language}) — Library now has {len(data[intent_key])} variations")
    return True


# ---------------------------------------------------------------------------
# Public API: Retrieve Learned Response
# ---------------------------------------------------------------------------

def find_learned_response(
    query: str,
    assistant_type: str,
    language: str = "en",
) -> Optional[str]:
    """
    Search the "learned" bucket for a previously seen query that closely
    matches the current one. Uses fuzzy matching (SequenceMatcher).
    
    Args:
        query: The current user query
        assistant_type: 'permit', 'student', or 'lawyer'
        language: 'en', 'tr', or 'ar'
    
    Returns:
        The learned response string if a good match is found, else None.
    """
    if assistant_type not in ("permit", "student", "lawyer"):
        return None

    normalized = _normalize_query(query)
    
    # --- Try in-memory library first (faster) ---
    learned_entries = []
    if _live_library:
        lang_lib = _live_library.get(language, {})
        agent_data = lang_lib.get(assistant_type, {})
        if isinstance(agent_data, dict):
            learned_entries = agent_data.get("learned", [])
    
    # Fallback: load from disk if in-memory is empty
    if not learned_entries:
        filepath = _get_learned_file(assistant_type, language)
        data = _load_json(filepath)
        learned_entries = data.get("learned", [])
    
    if not learned_entries:
        return None
    
    # --- Fuzzy match against stored queries ---
    best_match = None
    best_score = 0.0
    
    for entry in learned_entries:
        if not isinstance(entry, dict):
            continue  # Skip legacy string entries
        
        stored_query = entry.get("q", "")
        stored_response = entry.get("r", "")
        
        if not stored_query or not stored_response:
            continue
        
        score = SequenceMatcher(None, normalized, stored_query).ratio()
        
        if score > best_score:
            best_score = score
            best_match = stored_response
    
    if best_score >= _FUZZY_MATCH_THRESHOLD and best_match:
        print(f"[LearningCache] 🎯 LEARNED HIT (score={best_score:.2f}) for: {query[:60]}")
        return best_match
    
    return None


# ---------------------------------------------------------------------------
# Public API: Stats
# ---------------------------------------------------------------------------

def get_stats() -> dict:
    """Return learning statistics."""
    log = _load_json(_LEARNING_LOG)
    if not isinstance(log, list):
        log = []
    
    # Count by agent
    by_agent = {}
    for entry in log:
        agent = entry.get("agent", "unknown")
        by_agent[agent] = by_agent.get(agent, 0) + 1
    
    return {
        "total_learned": len(log),
        "by_agent": by_agent,
        "last_learned": log[-1] if log else None
    }
