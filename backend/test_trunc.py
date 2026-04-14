import asyncio
from utils.database import SessionLocal
from smart_router import smart_router_handle

async def test():
    res = await smart_router_handle('student register', 'student', '', 'en', None, None, None, '')
    print(res)

asyncio.run(test())
