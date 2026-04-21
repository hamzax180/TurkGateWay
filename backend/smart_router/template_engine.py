"""
template_engine.py
------------------
Lightweight string template renderer.
Fills {name}, {issue}, {timeframe}, {university}, {district} etc.
Uses a safe fallback: missing keys are left as empty strings.
No AI required.
"""

import re
from typing import Dict, Any


class _SafeDict(dict):
    """Return empty string for any missing key instead of raising KeyError."""
    def __missing__(self, key: str) -> str:
        return ""


def render(template: str, variables: Dict[str, Any]) -> str:
    """
    Fill template placeholders with variables.

    Example:
        render("Hi {name}! Your {issue} has been noted.", {"name": "Ali"})
        → "Hi Ali! Your  has been noted."

    Args:
        template:  String with {placeholder} tokens.
        variables: Dict of values to substitute.

    Returns:
        Rendered string with placeholders filled.
    """
    try:
        return template.format_map(_SafeDict(variables))
    except Exception:
        # Absolute last-resort: strip all placeholders
        return re.sub(r"\{[^}]+\}", "", template).strip()


def build_variables(
    user_name: str = "",
    issue: str = "",
    timeframe: str = "",
    university: str = "",
    district: str = "",
    **kwargs: Any,
) -> Dict[str, Any]:
    """
    Convenience builder for the variables dict.
    Accepts named arguments and passes through any extras via **kwargs.
    """
    base = {
        "name": user_name if user_name else "there",  # Fallback: avoids "Welcome back, !"
        "issue": issue or "",
        "timeframe": timeframe or "",
        "university": university or "",
        "district": district or "",
    }
    base.update(kwargs)
    return base
