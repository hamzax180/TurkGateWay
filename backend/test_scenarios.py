import asyncio
import json
import os
import sys
import io

# Fix for Windows terminal UTF-8 encoding
if sys.stdout.encoding != 'utf-8':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

# Add the current directory to sys.path for absolute imports
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from smart_router import smart_router_handle

async def run_tests():
    scenarios = [
        # --- PERMIT TESTS ---
        {
            "name": "Permit: Cafe in Kadikoy (TR)",
            "query": "Kadikoy de bir cafe acmak istiyorum",
            "assistant": "permit",
            "lang": "tr"
        },
        {
            "name": "Permit: Retail in Besiktas (EN)",
            "query": "i want to open a retail clothing store in Besiktas",
            "assistant": "permit",
            "lang": "en"
        },
        {
            "name": "Permit: Restaurant in Fatih (AR)",
            "query": "اريد فتح مطعم في الفاتح",
            "assistant": "permit",
            "lang": "ar"
        },
        
        # --- STUDENT TESTS ---
        {
            "name": "Student: Renew ID (EN)",
            "query": "renew my student id",
            "assistant": "student",
            "lang": "en"
        },
        {
            "name": "Student: Registration (TR)",
            "query": "universite kaydi nasil yapilir",
            "assistant": "student",
            "lang": "tr"
        },
        
        # --- LAWYER TESTS ---
        {
            "name": "Lawyer: Company Formation (EN)",
            "query": "how to form a company in Turkey",
            "assistant": "lawyer",
            "lang": "en"
        },
        
        # --- KEYWORD TESTS ---
        {
            "name": "Keyword: Greeting",
            "query": "Hello",
            "assistant": "permit",
            "lang": "en"
        },
        {
            "name": "Keyword: Pricing",
            "query": "how much does it cost",
            "assistant": "permit",
            "lang": "en"
        }
    ]

    print("\n" + "="*80)
    print("🚀 OFFLINE SMART ROUTER - COMPREHENSIVE SCENARIO TESTING")
    print("="*80 + "\n")

    for s in scenarios:
        print(f"🔍 Testing {s['name']}...")
        print(f"   Query: '{s['query']}'")
        
        try:
            # smart_router_handle returns either a string (library) or a tuple (dashboard)
            smart_result = await smart_router_handle(
                query=s['query'],
                assistant_type=s['assistant'],
                language=s['lang']
            )
            
            if not smart_result:
                print("   ⚠️ [AI FALLBACK] (Query was not handled offline)")
            else:
                msg = None
                dash = None
                
                if isinstance(smart_result, tuple):
                    msg, dash = smart_result
                else:
                    msg = smart_result
                
                if dash:
                    # Dashboard scenario
                    # Correctly point to the nested structure in PermitState
                    summ = dash.get("combined_result", {}).get("summary", "")
                    steps = dash.get("execution_plan", {}).get("steps", [])
                    print(f"   ✅ SUMMARY: {summ[:120]}...")
                    print(f"   ✅ DASHBOARD: {len(steps)} steps generated.")
                    if steps:
                         print(f"   ✅ SAMPLE STEP: {steps[0]['title']}")
                else:
                    # Plain library response
                    print(f"   ✅ RESPONSE: {msg[:120]}...")
        except Exception as e:
            print(f"   ❌ ERROR: {e}")
        
        print("-" * 40)

if __name__ == "__main__":
    asyncio.run(run_tests())
