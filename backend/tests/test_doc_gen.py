import asyncio
import sys
import os

# Add the backend directory to sys.path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from smart_router import smart_router_handle

async def test_free_user():
    print("\n--- Testing Free User Doc Gen ---")
    query = "write a petition for my residency permit"
    answer, state, source = await smart_router_handle(
        query=query,
        assistant_type="permit",
        language="en",
        subscription_status="free"
    )
    print(f"Source: {source}")
    print(f"Answer: {answer}")
    if "Premium" in answer:
        print("PASS: Correctly restricted for free user.")
    else:
        print("FAIL: Should have been restricted.")

async def test_premium_user():
    print("\n--- Testing Premium User Doc Gen ---")
    query = "write a petition for my residency permit"
    answer, state, source = await smart_router_handle(
        query=query,
        assistant_type="permit",
        language="en",
        subscription_status="active" # Premium
    )
    print(f"Source: {source}")
    # Answer should contain a PDF link
    if "Download your official document (PDF)" in answer:
        print("PASS: Correctly generated PDF link for premium user.")
        print(f"Link: {answer.split('(')[-1].split(')')[0]}")
    else:
        print(f"FAIL: Should have generated PDF link. Answer: {answer}")

async def main():
    await test_free_user()
    await test_premium_user()

if __name__ == "__main__":
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    asyncio.run(main())
