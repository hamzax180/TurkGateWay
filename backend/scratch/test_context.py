import sys
import os

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from smart_router.context_engine import parse_context, resolve_followup

history_text = "[user]: i am coming from dubai\n[assistant]: Which country are you applying from?\n[user]: who are you"
state = parse_context(history_text)
print("STATE:", state)
response = resolve_followup("who are you", state, "student", "en", history_text)
print("RESPONSE:", response)
