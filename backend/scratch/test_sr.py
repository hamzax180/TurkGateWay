import asyncio
import json
from smart_router import smart_router_handle

async def main():
    reply, dashboard, src = await smart_router_handle("Renew Kimlik/ID", "student", "Hamza", "en")
    with open('scratch/test_sr_out.json', 'w', encoding='utf-8') as f:
        json.dump({'reply': reply, 'dashboard': dashboard, 'src': src}, f, ensure_ascii=False, indent=2)

asyncio.run(main())
