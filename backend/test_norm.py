import re
_RE_NON_WORD = re.compile(r"[^\w\s]")
_RE_MULTI_SPACE = re.compile(r"\s+")

def _normalize_query(query: str) -> str:
    text = query.lower().strip()
    text = _RE_NON_WORD.sub("", text)
    text = _RE_MULTI_SPACE.sub(" ", text)
    return text

test_q = "What are the requirements for a residency permit in Turkey?"
print(f"Original: [{test_q}]")
print(f"Normalized: [{_normalize_query(test_q)}]")
