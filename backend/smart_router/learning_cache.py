"""
learning_cache.py
-----------------
Smart Learning Cache — permanently saves AI API responses into the local
response library so they can be served offline on future identical/similar queries.

How it works:
  1. When the AI fallback generates a response, we call `learn()`.
  2. `learn()` normalizes the query, classifies it by agent + intent,
     and appends the response to the agent's learned/{lang}.json file.
  3. On the next identical query, the keyword router matches the intent
     and `find_learned_response()` finds the learned response — 
     zero API tokens consumed.
  4. For queries that land in the "learned" bucket (no known intent),
     `find_learned_response()` performs fuzzy matching against previously
     stored query+response pairs — also zero API tokens consumed.

Files modified:
  - agents/{agent}/learned/en.json   (English)
  - agents/{agent}/learned/tr.json   (Turkish)
  - agents/{agent}/learned/ar.json   (Arabic)

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
from typing import Optional, Tuple
from datetime import datetime

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
_AGENTS_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "agents")
_MAX_LEARNED_PER_INTENT = 10       # Max learned responses per intent key
_MAX_LEARNED_PAIRS = 50            # Max query+response pairs in "learned" bucket
_MIN_RESPONSE_LENGTH = 10          # Ignore tiny/error responses
# Fuzzy matching thresholds: must pass both
_MIN_CHAR_SIMILARITY = 0.80
_MIN_WORD_SIMILARITY = 0.75
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


def _get_learned_file(agent: str, language: str) -> str:
    """Return the path to the agent's learned JSON file for a given language."""
    return os.path.join(_AGENTS_DIR, agent, "learned", f"{language}.json")


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


def _classify_intent(query: str, assistant_type: str) -> str:
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
    intent_hint: Optional[str] = None,
    dashboard_state: Optional[dict] = None
) -> bool:
    """
    Save an AI-generated response into the permanent learned library.
    
    ALL AI-generated responses are stored in agents/{agent}/learned/{lang}.json
    to keep the curated responses.json files clean and hand-maintained.
    
    Args:
        query: The original user query
        response: The AI-generated response text
        assistant_type: 'permit', 'student', or 'lawyer'
        language: 'en', 'tr', or 'ar'
        intent_hint: Optional pre-classified intent (sub_intent)
        dashboard_state: Optional dictionary containing state/roadmap data
    
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
    
    # --- ALL learned responses go to learned/{lang}.json ---
    filepath = _get_learned_file(assistant_type, language)
    
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
            # "learned" bucket uses dict format: {"q": ..., "r": ..., "s": ...}
            if len(existing) >= _MAX_LEARNED_PAIRS:
                # Evict oldest entry
                existing.pop(0)
                print(f"[LearningCache] Evicted oldest learned entry for {assistant_type} ({language})")
            
            entry = {
                "q": _normalize_query(query),
                "r": response.strip(),
            }
            if dashboard_state:
                entry["s"] = dashboard_state # 's' for state

            data[intent_key].append(entry)
        else:
            # Known intent: store with query metadata for fuzzy matching
            if len(existing) >= _MAX_LEARNED_PER_INTENT:
                print(f"[LearningCache] SKIP — {assistant_type}.{intent_key} already has {len(existing)} responses (max {_MAX_LEARNED_PER_INTENT})")
                return False
            
            entry = {
                "q": _normalize_query(query),
                "r": response.strip(),
                "intent": intent_key,
            }
            if dashboard_state:
                entry["s"] = dashboard_state
            
            data[intent_key].append(entry)
        
        _save_json(filepath, data)
    
    # Update the in-memory library so it takes effect immediately
    _update_live_library(assistant_type, language, intent_key, query, response, dashboard_state)
    
    # Log it
    _log_learning(query, assistant_type, intent_key, language)
    
    print(f"[LearningCache] ✅ LEARNED new response for {assistant_type}.{intent_key} ({language}) — Library now has {len(data[intent_key])} variations")
    return True


def _update_live_library(assistant_type: str, language: str, intent_key: str, query: str, response: str, dashboard_state: Optional[dict] = None):
    """Update the in-memory library so learned responses take effect immediately."""
    if not _live_library:
        return
    
    lang_lib = _live_library.get(language, {})
    agent_data = lang_lib.get(assistant_type, {})
    if not isinstance(agent_data, dict):
        return
    
    if intent_key not in agent_data:
        agent_data[intent_key] = []
    
    entry = {
        "q": _normalize_query(query),
        "r": response.strip(),
    }
    if intent_key != "learned":
        entry["intent"] = intent_key
    if dashboard_state:
        entry["s"] = dashboard_state
    
    if not _is_duplicate(agent_data[intent_key], response):
        agent_data[intent_key].append(entry)


# ---------------------------------------------------------------------------
# Public API: Retrieve Learned Response
# ---------------------------------------------------------------------------

def find_learned_response(
    query: str,
    assistant_type: str,
    language: str = "en",
) -> Optional[Tuple[str, Optional[dict]]]:
    """
    Search ALL learned entries for a previously seen query that closely
    matches the current one. Uses fuzzy matching (SequenceMatcher).
    
    Searches across ALL intent buckets in the learned file, not just "learned".
    
    Args:
        query: The current user query
        assistant_type: 'permit', 'student', or 'lawyer'
        language: 'en', 'tr', or 'ar'
    
    Returns:
        A tuple of (response_text, dashboard_state) if found, else None.
    """
    if assistant_type not in ("permit", "student", "lawyer"):
        return None

    normalized = _normalize_query(query)
    
    # --- Collect ALL learned entries across all intent buckets ---
    all_entries = []
    
    # Try in-memory library first (faster)
    if _live_library:
        lang_lib = _live_library.get(language, {})
        agent_data = lang_lib.get(assistant_type, {})
        if isinstance(agent_data, dict):
            for bucket_key, bucket_entries in agent_data.items():
                if not isinstance(bucket_entries, list):
                    continue
                for entry in bucket_entries:
                    if isinstance(entry, dict) and "q" in entry and "r" in entry:
                        all_entries.append(entry)
    
    # Fallback: load from disk if in-memory is empty
    if not all_entries:
        filepath = _get_learned_file(assistant_type, language)
        data = _load_json(filepath)
        for bucket_key, bucket_entries in data.items():
            if not isinstance(bucket_entries, list):
                continue
            for entry in bucket_entries:
                if isinstance(entry, dict) and "q" in entry and "r" in entry:
                    all_entries.append(entry)
    
    if not all_entries:
        return None
    
    # --- Fuzzy match against stored queries ---
    best_match_text = None
    best_match_state = None
    best_score = 0.0
    
    for entry in all_entries:
        stored_query = entry.get("q", "")
        stored_response = entry.get("r", "")
        stored_state = entry.get("s") # Optional state
        
        if not stored_query or not stored_response:
            continue
        
        # Exact match shortcut
        if normalized == stored_query:
            print(f"[LearningCache] 🎯 EXACT LEARNED HIT for: {query[:60]}")
            return stored_response, stored_state
            
        q_words = set(normalized.split())
        s_words = set(stored_query.split())
        
        if not q_words or not s_words:
            continue
            
        # Word overlap (Jaccard)
        intersection = q_words.intersection(s_words)
        union = q_words.union(s_words)
        word_score = len(intersection) / len(union)
        
        # Character overlap
        char_score = SequenceMatcher(None, normalized, stored_query).ratio()
        
        # Must pass both thresholds to prevent proper noun confusion
        if char_score >= _MIN_CHAR_SIMILARITY and word_score >= _MIN_WORD_SIMILARITY:
            combined = (char_score + word_score) / 2
            if combined > best_score:
                best_score = combined
                best_match_text = stored_response
                best_match_state = stored_state
    
    if best_match_text:
        print(f"[LearningCache] 🎯 LEARNED HIT (score={best_score:.2f}) for: {query[:60]}")
        return best_match_text, best_match_state
    
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
