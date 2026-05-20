import asyncio
from smart_router import smart_router_handle

async def test():
    tests = [
        ("what documents do I need?", "permit", "en"),
        ("how much does it cost?", "permit", "en"),
        ("how long does it take?", "permit", "en"),
        ("help", "permit", "en"),
        ("help", "lawyer", "en"),
        ("caffe", "permit", "en"),
        ("resteruant", "permit", "en"),
        ("┘à╪º ┘ç┘è ╪º┘ä┘à╪│╪¬┘å╪»╪º╪¬ ╪º┘ä┘à╪╖┘ä┘ê╪¿╪⌐", "permit", "ar"),
        ("┘â┘è┘ü ╪ú╪¿╪»╪ú", "permit", "ar"),
        ("┘à╪│╪º╪╣╪»╪⌐", "lawyer", "ar"),
    ]
    for query, agent, lang in tests:
        r = await smart_router_handle(query, agent, "", lang)
        if r:
            text = r if isinstance(r, str) else str(r)
            print(f"  Γ£à [{agent}/{lang}] {query!r:40s} => {text[:80]}...")
        else:
            print(f"  Γ¥î [{agent}/{lang}] {query!r:40s} => NO LOCAL RESULT (falls to AI)")

asyncio.run(test())
