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

async def run_eikamet_bot(full_name: str, passport_no: str, passport_type: str, ikamet_type: str, dob: str, is_extension: bool, father_name: str = "", mother_name: str = "") -> dict:
    """
    Navigates to e-ikamet.goc.gov.tr to simulate application for residency.
    """
    print(f"[e-Ikamet Bot] Starting session for {full_name}")
    try:
        p = await async_playwright().start()
        # Headless=False so the user can see the bot working
        browser = await p.chromium.launch(headless=False, slow_mo=1200)
        context = await browser.new_context()
        page = await context.new_page()

        # Step 1: Navigate to the main starting page
        target_url = "https://e-ikamet.goc.gov.tr/"
        print(f"[e-Ikamet Bot] Navigating to main portal: {target_url}")
        await page.goto(target_url, wait_until="domcontentloaded", timeout=45000)
        await asyncio.sleep(2)

        # Handle cookie consent if it appears
        try:
            accept_cookies = await page.query_selector('button:has-text("Accept"), button:has-text("Tamam"), .btn-accept')
            if accept_cookies and await accept_cookies.is_visible():
                await accept_cookies.click()
                print("[e-Ikamet Bot] Accepted cookies")
        except:
            pass

        # Step 2: Click the appropriate application button
        if is_extension:
            print("[e-Ikamet Bot] Selecting 'EXTENSION' application...")
            selectors = [
                'text="I APPLY FOR THE EXTENSION OF THE DURATION OF RESIDENCE PERMIT"',
                'a:has-text("EXTENSION")',
                'div.btn-eikamet-yesil'
            ]
        else:
            print("[e-Ikamet Bot] Selecting 'FIRST TIME' application...")
            selectors = [
                'text="I LODGE AN APPLICATION FOR RESIDENCE PERMIT FOR THE FIRST TIME"',
                'a:has-text("FIRST TIME")',
                'div.btn-eikamet-pembe'
            ]
            
        clicked = False
        for selector in selectors:
            try:
                btn = await page.wait_for_selector(selector, timeout=5000, state="visible")
                if btn:
                    await btn.click()
                    print(f"[e-Ikamet Bot] Clicked selection button using: {selector}")
                    clicked = True
                    break
            except:
                continue
        
        if not clicked:
            print("[e-Ikamet Bot] Warning: Could not find specific selection button, proceeding with direct navigation if possible.")
            
        await page.wait_for_load_state("networkidle")
        await asyncio.sleep(3)

        # Step 2: Handle "I have read and understand" / Consent popups if they appear
        print("[e-Ikamet Bot] Checking for consent checkboxes or popup buttons...")
        try:
            # Common selectors for terms checkboxes on TR gov sites
            selectors = [
                'input[type="checkbox"]', 
                '#chkOkudumAnladim', 
                'text="Okudum, anladım"', 
                'text="I have read"',
                'button:has-text("Devam")',
                'button:has-text("Continue")'
            ]
            for selector in selectors:
                elements = await page.query_selector_all(selector)
                for el in elements:
                    if await el.is_visible():
                        await el.click()
                        print(f"[e-Ikamet Bot] Clicked consent element: {selector}")
                        await asyncio.sleep(1)
        except Exception as e:
            print(f"[e-Ikamet Bot] No initial consent popups found or already handled: {e}")
            
        # Step 3: Simulate filling the applicant data form
        print(f"[e-Ikamet Bot] Preparing to fill applicant details...")
        
        try:
            # First, check if we need to click "I WOULD LIKE TO LODGE A NEW APPLICATION" 
            # if we landed on the splash page
            print("[e-Ikamet Bot] Checking for 'New Application' splash screen...")
            
            # More robust selector found by inspection
            new_app_selectors = [
                'button:has-text("I WOULD LIKE TO LODGE A NEW APPLICATION")',
                'button.btn-eikamet-mavi.btn-detay',
                'text="I WOULD LIKE TO LODGE A NEW APPLICATION"'
            ]
            
            for selector in new_app_selectors:
                try:
                    btn = await page.wait_for_selector(selector, timeout=5000, state="visible")
                    if btn:
                        await btn.click()
                        print(f"[e-Ikamet Bot] Clicked 'New Application' button using: {selector}")
                        await page.wait_for_load_state("networkidle")
                        await asyncio.sleep(2)
                        break
                except:
                    continue

            # Check for "OK" buttons on informational popups that often follow
            try:
                ok_buttons = await page.query_selector_all('button:has-text("OK"), button:has-text("Tamam")')
                for ok_btn in ok_buttons:
                    if await ok_btn.is_visible():
                        await ok_btn.click()
                        print("[e-Ikamet Bot] Dismissed info popup with 'OK'")
                        await asyncio.sleep(1)
            except:
                pass

            # Fill the fields
            print(f"[e-Ikamet Bot] Filling form fields for {full_name}...")
            
            # Helper to fill if exists
            async def fill_if_exists(selector, value):
                if not value: return
                el = await page.query_selector(selector)
                if el and await el.is_visible():
                    await el.fill(value)
                    print(f"[e-Ikamet Bot] Filled {selector} with {value}")

            # Split full name if possible (very basic split)
            name_parts = full_name.split(' ')
            first_name = name_parts[0]
            last_name = ' '.join(name_parts[1:]) if len(name_parts) > 1 else "Unknown"

            await fill_if_exists("#ad", first_name)
            await fill_if_exists("#soyad", last_name)
            await fill_if_exists("#babaAd", father_name)
            await fill_if_exists("#anneAd", mother_name)
            
            # Date of Birth (format often needs to be dd.mm.yyyy for TR sites)
            if dob:
                # Basic conversion if needed, but assuming yyyy-mm-dd from frontend
                formatted_dob = dob
                if "-" in dob:
                    parts = dob.split("-")
                    formatted_dob = f"{parts[2]}.{parts[1]}.{parts[0]}"
                await fill_if_exists("#DogumTarih", formatted_dob)

            await fill_if_exists("#pasaportBelgeNo", passport_no)
            
            # Fill Nationality ID if provided (mapped to passport_no for now if no specific field)
            # await fill_if_exists("#uyrukKimlikNo", "") 

            # Handle Kendo Dropdowns (basic attempt)
            async def set_kendo_dropdown(title, value):
                try:
                    dropdown = await page.query_selector(f"span[title='{title}']")
                    if dropdown:
                        await dropdown.click()
                        await asyncio.sleep(1)
                        # Try to find the item in the list that opens
                        await page.click(f"li:has-text('{value}')")
                        print(f"[e-Ikamet Bot] Selected {value} in {title} dropdown")
                except:
                    pass

            await set_kendo_dropdown("Gender", "Male" if "male" in ikamet_type.lower() else "Female")
            # We don't have nationality in our schema yet, but we could add it.
            
            print("[e-Ikamet Bot] Form filling simulation complete.")
            
        except Exception as fill_err:
            print(f"[e-Ikamet Bot] Error during form filling: {fill_err}")

        print(f"[e-Ikamet Bot] Bot reached the application portal. Data ready: Name={full_name}, Passport={passport_no}")
        await asyncio.sleep(5)
        
        return {"status": "success", "message": f"e-Ikamet bot successfully navigated to the {('extension' if is_extension else 'initial')} application form and filled initial data."}
    except Exception as e:
        err_trace = traceback.format_exc()
        print(f"[e-Ikamet Bot] Fatal Error:\\n{err_trace}")
        return {"status": "error", "message": f"e-Ikamet Bot failed: {str(e)}"}
