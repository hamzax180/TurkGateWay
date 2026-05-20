import sys
import os

sys.path.append(os.path.join(os.path.dirname(__file__), '..'))
from smart_router.keyword_router import detect_intent

print(detect_intent("whats docs req", "student"))
