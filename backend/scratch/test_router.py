import sys
import os
import json

# Add backend to sys.path
sys.path.append(os.path.abspath('backend'))

from smart_router import smart_router_handle
from smart_router import _pick_response, _library

print(f"Library keys for 'en': {_library['en'].keys()}")
if 'student' in _library['en']:
    print(f"Student keys: {_library['en']['student'].keys()}")
    print(f"Deadlines in student: {'deadlines' in _library['en']['student']}")
else:
    print("CRITICAL: 'student' not in _library['en']")

test_queries = [
    ("Deadlines", "student"),
]

import asyncio

async def test():
    for q, atype in test_queries:
        result = await smart_router_handle(q, atype)
        if isinstance(result, tuple):
            print(f"Query: '{q}' -> Response: {result[0][:50]}...")
        else:
            print(f"Query: '{q}' -> Response: {result[:50] if result else 'None'}")

asyncio.run(test())
