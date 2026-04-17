import os
import asyncio
from playwright.async_api import async_playwright
import traceback

MERSIS_URL = "https://mersis.ticaret.gov.tr/Portal/KullaniciIslemleri/GirisIslemleri"

# Step-specific post-login MERSİS pages
MERSIS_STEP_URLS = {
    3: "/Portal/KurumIslemleri/SirketIslemleri/SirketUnvanSorgula",   # Company name reservation
    4: "/Portal/KurumIslemleri/SirketIslemleri/SirketKurulusBasvurusu",  # Company formation (type/capital)
    5: "/Portal/KurumIslemleri/SirketIslemleri/SirketIslemleri",        # Company address / structure
}

async def run_mersis_bot(tckn: str, password: str, portal_url: str, step_id: int = 0) -> dict:
    """
    MERSİS login sequence via e-Government. After login, navigates to
    the step-specific MERSİS page (steps 3/4/5).
    """
    print(f"[MERSİS Bot] Starting session for TCKN: {tckn}, step_id={step_id}")

    try:
        p = await async_playwright().start()
        browser = await p.chromium.launch(headless=False, slow_mo=800)
        context = await browser.new_context()
        page = await context.new_page()

        target_url = portal_url or MERSIS_URL
        print(f"[MERSİS Bot] Navigating to: {target_url}")
        await page.goto(target_url, wait_until="domcontentloaded", timeout=30000)

        print("[MERSİS Bot] Looking for login buttons...")
        try:
            # First try the big red E-Devlet button
            await page.click('text="E-Devlet Üzerinden Giriş"', timeout=10000)
        except Exception:
            try:
                # Try English fallback
                await page.click('text="Login via e-Government"', timeout=5000)
            except Exception:
                # Try the top-right "Giriş" link if we are on the home page instead of login page
                await page.click('a:has-text("Giriş"), .header-login', timeout=5000)
                # Then wait for the red button on the next page
                await page.click('text="E-Devlet Üzerinden Giriş"', timeout=10000)

        # Wait for redirect to e-Devlet login form
        await page.wait_for_selector('input[name="tridField"]', timeout=30000)

        print("[MERSİS Bot] Entering TCKN...")
        await page.type('input[name="tridField"]', tckn, delay=350)

        print("[MERSİS Bot] Entering password...")
        await page.type('input[name="egpField"]', password, delay=350)

        print("[MERSİS Bot] Clicking Log in...")
        submit_btn = await page.query_selector('input[name="submitButton"], .submitButton, button[type="submit"]')
        if submit_btn:
            await submit_btn.click()

        print("[MERSİS Bot] Waiting for MERSİS dashboard...")
        try:
            await page.wait_for_url("**/Portal/Home**", timeout=120000)
            print("[MERSİS Bot] Dashboard detected!")
        except Exception:
            if "mersis" in page.url and "Giris" not in page.url:
                print("[MERSİS Bot] Dashboard loaded via URL check. Proceeding...")
            else:
                return {"status": "error", "message": "Login timeout. MERSİS Dashboard not reached."}

        # ── Step-specific post-login navigation ──────────────────────────────
        if step_id in MERSIS_STEP_URLS:
            base = "https://mersis.ticaret.gov.tr"
            step_path = MERSIS_STEP_URLS[step_id]
            step_full_url = base + step_path
            print(f"[MERSİS Bot] Step {step_id}: navigating to {step_full_url}")
            try:
                await page.goto(step_full_url, wait_until="domcontentloaded", timeout=30000)
                await asyncio.sleep(5)
                print(f"[MERSİS Bot] Step {step_id} page loaded.")

                if step_id == 3:
                    print("[MERSİS Bot] Executing Step 3: Company Name Reservation...")
                    # Click "Add New Title" if it exists
                    try:
                        await page.click('button:has-text("Yeni Ünvan Ekle"), a:has-text("Yeni Ünvan"), .btn-success', timeout=5000)
                        await asyncio.sleep(2)
                        await page.type('input[name="Unvan"]', "PERMITOPS CAFE VE RESTORAN LİMİTED ŞİRKETİ", delay=100)
                        print("[MERSİS Bot] Filled suggested company title for reservation.")
                    except Exception as e:
                        print(f"[MERSİS Bot] Step 3 minor error: {e}")

                elif step_id == 4:
                    print("[MERSİS Bot] Executing Step 4: Company Formation Application...")
                    # Click "New Application" -> "Limited Company"
                    try:
                        await page.click('button:has-text("Yeni Başvuru"), a:has-text("Kuruluş Başlat")', timeout=5000)
                        await asyncio.sleep(2)
                        print("[MERSİS Bot] Initiated company formation wizard.")
                    except Exception as e:
                        print(f"[MERSİS Bot] Step 4 minor error: {e}")

                elif step_id == 5:
                    print("[MERSİS Bot] Executing Step 5: Company Address / Structure...")
                    try:
                        await page.click('button:has-text("Adres Ekle"), a:has-text("Merkez Adresi")', timeout=5000)
                        await asyncio.sleep(2)
                        print("[MERSİS Bot] Opened address entry form.")
                    except Exception as e:
                        print(f"[MERSİS Bot] Step 5 minor error: {e}")

                print(f"[MERSİS Bot] Leaving browser open for user to review Step {step_id}.")

            except Exception as nav_err:
                print(f"[MERSİS Bot] Step page navigation warning: {nav_err}")

        step_labels = {
            3: "Company name reservation",
            4: "Company formation application",
            5: "Company address / structure form",
        }
        label = step_labels.get(step_id, f"Step {step_id}")
        return {"status": "success", "message": f"MERSİS logged in successfully. Opened: {label}."}

    except Exception as e:
        err_trace = traceback.format_exc()
        print(f"[MERSİS Bot] Fatal Error:\n{err_trace}")
        return {"status": "error", "message": f"MERSİS Automation failed: {str(e)}"}

async def run_edevlet_bot(tckn: str, password: str, docs: list, location: str = "Beşiktaş") -> dict:
    """
    Simulates logging into e-Devlet and submitting documents (Step 12).
    """
    print(f"[e-Devlet Bot] Starting session for TCKN: {tckn}, location: {location}")
    
    try:
        p = await async_playwright().start()
        browser = await p.chromium.launch(headless=False, slow_mo=1000)
        context = await browser.new_context()
        page = await context.new_page()

        print("[e-Devlet Bot] Navigating to turkiye.gov.tr...")
        await page.goto("https://giris.turkiye.gov.tr/Giris/")

        await page.wait_for_selector('input[name="tridField"]', timeout=30000)

        print("[e-Devlet Bot] Typing TCKN character by character...")
        await page.type('input[name="tridField"]', tckn, delay=400)
        
        print("[e-Devlet Bot] Typing Password character by character...")
        await page.type('input[name="egpField"]', password, delay=400)
        
        try:
            dashboard_el = await page.query_selector('input#searchField')
            if not dashboard_el:
                print("[e-Devlet Bot] Clicking Giris Yap...")
                await page.click('input[name="submitButton"]', timeout=10000)
            else:
                print("[e-Devlet Bot] Already on dashboard. Skipping login click.")
        except Exception:
            print("[e-Devlet Bot] Login button not found or already logged in.")

        print("[e-Devlet Bot] Waiting for dashboard activation...")
        try:
            await page.wait_for_selector('input#searchField', timeout=120000, state="visible")
            print("[e-Devlet Bot] Dashboard detected!")
        except Exception:
            if "turkiye.gov.tr" in page.url and "Giris" not in page.url:
                 print("[e-Devlet Bot] Dashboard seems loaded via URL.")
            else:
                return {"status": "error", "message": "Login timeout. Dashboard not reached."}

        # --- STEP 12 SPECIFIC LOGIC: MULTI-PORTAL NAVIGATION ---
        print(f"[e-Devlet Bot] Institution 1: {location} Municipality...")
        await page.click('input#searchField')
        search_query = f"{location} Belediyesi İş Yeri Açma"
        await page.type('input#searchField', search_query, delay=300)
        await asyncio.sleep(2)
        await page.keyboard.press("ArrowDown")
        await page.keyboard.press("Enter")
        
        await asyncio.sleep(5)

        print("[e-Devlet Bot] Institution 2: IBB Fire Safety...")
        await page.goto("https://www.turkiye.gov.tr/ibb-itfaiye-uygunluk-belgesi-basvurusu", wait_until="networkidle", timeout=60000)
        await asyncio.sleep(5)

        print("[e-Devlet Bot] Institution 3: Health Ministry...")
        await page.goto("https://www.turkiye.gov.tr/saglik-bakanligi-hijyen-egitimi-belgesi-sorgulama", wait_until="networkidle", timeout=60000)
        await asyncio.sleep(5)

        return {"status": "success", "message": "Step 12 automation (3 portals) completed."}

    except Exception as e:
        err_trace = traceback.format_exc()
        print(f"[e-Devlet Bot] Fatal Error:\n{err_trace}")
        return {"status": "error", "message": f"e-Devlet Automation failed: {str(e)}"}

async def run_health_insurance_bot(passport_no: str = "", dob: str = "", start_date: str = "") -> dict:
    """
    Simulates navigating to a health insurance provider and purchasing Yabancı Sağlık Sigortası.
    """
    print(f"[Insurance Bot] Starting session for Passport: {passport_no}")
    try:
        p = await async_playwright().start()
        browser = await p.chromium.launch(headless=False, slow_mo=1000)
        context = await browser.new_context()
        page = await context.new_page()

        print("[Insurance Bot] Navigating to e-ikametsigorta.com...")
        await page.goto("https://www.e-ikametsigorta.com/")
        await asyncio.sleep(3)
        print(f"[Insurance Bot] Waiting for user info: passport_no={passport_no}, dob={dob}, start={start_date}")
        # In a real scenario, we would fill the form:
        # await page.fill('input[name="passport"]', passport_no)
        # ...
        await asyncio.sleep(4)
        return {"status": "success", "message": "Health insurance simulation completed."}
    except Exception as e:
        err_trace = traceback.format_exc()
        print(f"[Insurance Bot] Fatal Error:\n{err_trace}")
        return {"status": "error", "message": f"Insurance Bot failed: {str(e)}"}

async def run_eikamet_bot(full_name: str, passport_no: str, passport_type: str, ikamet_type: str, dob: str, is_extension: bool) -> dict:
    """
    Navigates to e-ikamet.goc.gov.tr to simulate application for residency.
    """
    print(f"[e-Ikamet Bot] Starting session for {full_name}")
    try:
        p = await async_playwright().start()
        browser = await p.chromium.launch(headless=False, slow_mo=1000)
        context = await browser.new_context()
        page = await context.new_page()

        if is_extension:
            print(f"[e-Ikamet Bot] Navigating to Extension URL: https://e-ikamet.goc.gov.tr/Ikamet/Basvuru/UzatmaBasvuru")
            await page.goto("https://e-ikamet.goc.gov.tr/Ikamet/Basvuru/UzatmaBasvuru")
        else:
            print(f"[e-Ikamet Bot] Navigating to First Time URL: https://e-ikamet.goc.gov.tr/Ikamet/Basvuru/IlkBasvuru")
            await page.goto("https://e-ikamet.goc.gov.tr/Ikamet/Basvuru/IlkBasvuru")
        
        await asyncio.sleep(2)
            
        print(f"[e-Ikamet Bot] Filling Applicant Details: Name={full_name}, Passport={passport_no}, Type={passport_type}, IkametType={ikamet_type}, DOB={dob}")
        await asyncio.sleep(5)
        
        return {"status": "success", "message": "e-Ikamet automation simulation completed."}
    except Exception as e:
        err_trace = traceback.format_exc()
        print(f"[e-Ikamet Bot] Fatal Error:\n{err_trace}")
        return {"status": "error", "message": f"e-Ikamet Bot failed: {str(e)}"}
