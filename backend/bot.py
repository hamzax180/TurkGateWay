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

async def run_eikamet_bot(
    full_name: str,
    passport_no: str,
    passport_type: str,
    ikamet_type: str,
    dob: str,
    is_extension: bool,
    father_name: str = "",
    mother_name: str = "",
    nationality_id: str = "",
    nationality: str = "",
    gender: str = "Male",
    email: str = "",
    phone: str = "",
) -> dict:
    """
    Navigates to e-ikamet.goc.gov.tr and fills the Pre-registration Form.
    Flow:
      1. Navigate to homepage
      2. Dismiss announcement modal
      3. Accept cookies
      4. Click RED (new) or GREEN (extension) button
      5. Handle intermediate page → click 'Lodge New Application'
      6. Dismiss form-page popups + check consent
      7. Fill all fields using keyboard.type() so JS events fire
    """
    app_label = "EXTENSION (Green)" if is_extension else "FIRST-TIME (Red/Pink)"
    print(f"[e-Ikamet Bot] Starting {app_label} application for: {full_name}")
    try:
        p = await async_playwright().start()
        browser = await p.chromium.launch(headless=False, slow_mo=600)
        context = await browser.new_context(viewport={"width": 1280, "height": 900})
        page = await context.new_page()

        # ── 1. Navigate to portal home ──────────────────────────────────────────
        print("[e-Ikamet Bot] Navigating to https://e-ikamet.goc.gov.tr/")
        await page.goto("https://e-ikamet.goc.gov.tr/", wait_until="domcontentloaded", timeout=45000)
        await asyncio.sleep(2)

        # ── 2. Dismiss IMPORTANT/Announcement modal that opens on load ──────────
        print("[e-Ikamet Bot] Dismissing announcement modal...")
        modal_close_selectors = [
            '.modal .close', '.modal button.close', '.modal [data-dismiss="modal"]',
            'button:has-text("×")', '.modal-header .close', '.ui-dialog-titlebar-close',
            '.modal-footer button', '.modal button:has-text("OK")',
            '.modal button:has-text("Tamam")', '.modal button:has-text("Kapat")',
            '.modal button:has-text("Close")', '[aria-label="Close"]', '[aria-label="close"]',
        ]
        modal_dismissed = False
        for sel in modal_close_selectors:
            try:
                btn = await page.query_selector(sel)
                if btn and await btn.is_visible():
                    await btn.click(force=True)
                    print(f"[e-Ikamet Bot] ✅ Dismissed modal via: {sel}")
                    await asyncio.sleep(1)
                    modal_dismissed = True
                    break
            except:
                pass
        if not modal_dismissed:
            try:
                await page.keyboard.press('Escape')
                await asyncio.sleep(0.8)
            except:
                pass

        # ── 3. Accept cookie banner ─────────────────────────────────────────────
        cookie_selectors = [
            'a:has-text("Accept")', 'button:has-text("Accept")',
            '#acceptCookies', '.cookie-accept', '#cookieAccept', '#btnAccept',
            '.cookieWarningBox a', '.cc-btn', '.cc-allow', 'a:has-text("Kabul Et")',
        ]
        for sel in cookie_selectors:
            try:
                btn = await page.query_selector(sel)
                if btn and await btn.is_visible():
                    await btn.click(force=True)
                    print(f"[e-Ikamet Bot] Cookie accepted via {sel}")
                    await asyncio.sleep(0.8)
                    break
            except:
                pass

        # ── 4. Click the correct homepage application button ────────────────────
        if is_extension:
            btn_selectors = [
                'a:has-text("I APPLY FOR THE EXTENSION")',
                'a:has-text("EXTENSION OF THE DURATION")',
                '.btn-yesil', '.btn-green',
                'a[href*="UzatmaBasvuru"]', 'a[href*="uzatma"]',
            ]
        else:
            btn_selectors = [
                'a:has-text("FIRST TIME")',
                'a:has-text("I LODGE AN APPLICATION FOR RESIDENCE PERMIT")',
                'a[href*="IlkBasvuru"]', 'a[href*="OnKayit"]',
                '.btn-pembe', '.btn-pink', '.btn-red',
            ]

        clicked = False
        for attempt in range(12):
            # Re-dismiss any blocking modal on each attempt
            if attempt > 0:
                for sel in ['.modal .close', '.modal-header .close', '[aria-label="Close"]',
                             'button:has-text("×")', '.modal button:has-text("OK")',
                             '.modal button:has-text("Tamam")', '.modal-footer button']:
                    try:
                        btn = await page.query_selector(sel)
                        if btn and await btn.is_visible():
                            await btn.click(force=True)
                            await asyncio.sleep(0.5)
                            break
                    except:
                        pass

            for sel in btn_selectors:
                try:
                    btn = await page.query_selector(sel)
                    if btn and await btn.is_visible():
                        await btn.click(force=True)
                        print(f"[e-Ikamet Bot] ✅ Clicked {app_label} button: {sel}")
                        clicked = True
                        break
                except:
                    pass
            if clicked:
                break
            await asyncio.sleep(1)

        if not clicked:
            print(f"[e-Ikamet Bot] ⚠ Could not find homepage button — navigating directly")
            direct_url = (
                "https://e-ikamet.goc.gov.tr/Ikamet/Basvuru/UzatmaBasvuru"
                if is_extension
                else "https://e-ikamet.goc.gov.tr/Ikamet/OnKayit"
            )
            await page.goto(direct_url, wait_until="domcontentloaded", timeout=30000)

        await page.wait_for_load_state("networkidle", timeout=20000)
        await asyncio.sleep(2)

        # ── 5. Handle INTERMEDIATE page ─────────────────────────────────────────
        # After the homepage button, the site shows:
        #   "I WOULD LIKE TO LODGE A NEW APPLICATION"
        #   "I WANT TO CONTINUE MY APPLICATION"
        #   "I WOULD LIKE TO SEE MY APPLICATION RESULT"
        print("[e-Ikamet Bot] Checking for intermediate selection page...")
        intermediate_selectors = [
            'a:has-text("I WOULD LIKE TO LODGE A NEW APPLICATION")',
            'a:has-text("LODGE A NEW APPLICATION")',
            'a:has-text("YENİ BAŞVURU YAPMAK İSTİYORUM")',
            'a:has-text("Yeni Başvuru")',
        ] if not is_extension else [
            'a:has-text("I WANT TO CONTINUE MY APPLICATION")',
            'a:has-text("CONTINUE MY APPLICATION")',
            'a:has-text("BAŞVURUMU SÜRDÜRMEK")',
            'a:has-text("I WOULD LIKE TO LODGE A NEW APPLICATION")',
        ]
        for sel in intermediate_selectors:
            try:
                btn = await page.query_selector(sel)
                if btn and await btn.is_visible():
                    await btn.click(force=True)
                    print(f"[e-Ikamet Bot] ✅ Intermediate page: {sel}")
                    await page.wait_for_load_state("networkidle", timeout=20000)
                    await asyncio.sleep(2)
                    break
            except:
                pass

        # ── 6. Dismiss form-page modals + handle consent ────────────────────────
        print("[e-Ikamet Bot] Dismissing form-page modals...")
        for _ in range(3):
            dismissed = False
            for sel in ['.modal .close', '.modal-header .close', '[aria-label="Close"]',
                        'button:has-text("×")', '.modal button:has-text("OK")',
                        '.modal button:has-text("Tamam")', '.modal-footer button',
                        '.modal button:has-text("Kapat")', '.modal button:has-text("Close")']:
                try:
                    btn = await page.query_selector(sel)
                    if btn and await btn.is_visible():
                        await btn.click(force=True)
                        print(f"[e-Ikamet Bot] Dismissed form modal: {sel}")
                        await asyncio.sleep(0.8)
                        dismissed = True
                        break
                except:
                    pass
            if not dismissed:
                break

        try:
            await page.keyboard.press('Escape')
            await asyncio.sleep(0.4)
        except:
            pass

        # Check "I READ, UNDERSTOOD" checkbox
        for sel in ['#chkOkudumAnladim', 'input[id*="Okudum"]',
                    'input[id*="Read"]', 'input[type="checkbox"]']:
            try:
                boxes = await page.query_selector_all(sel)
                for box in boxes:
                    if await box.is_visible() and not await box.is_checked():
                        await box.check()
                        print(f"[e-Ikamet Bot] Checked consent: {sel}")
                        await asyncio.sleep(0.5)
            except:
                pass

        # Click Devam/Continue if shown
        for sel in ['button:has-text("Devam")', 'a:has-text("Devam")',
                    'button:has-text("Continue")', 'a:has-text("Continue")']:
            try:
                btn = await page.query_selector(sel)
                if btn and await btn.is_visible():
                    await btn.click()
                    print(f"[e-Ikamet Bot] Clicked continue: {sel}")
                    await page.wait_for_load_state("networkidle", timeout=15000)
                    await asyncio.sleep(1.5)
            except:
                pass

        # Wait for the actual form fields to appear
        print("[e-Ikamet Bot] Waiting for form fields...")
        try:
            await page.wait_for_selector('input[type="text"]', timeout=12000, state="visible")
        except:
            print("[e-Ikamet Bot] Warning: text inputs not found, attempting fill anyway...")
        await asyncio.sleep(1)

        # ── 7. Fill the Pre-registration Form ───────────────────────────────────
        print(f"[e-Ikamet Bot] Filling form for: {full_name}")

        name_parts = full_name.strip().split()
        first_name = name_parts[0] if name_parts else ""
        last_name = " ".join(name_parts[1:]) if len(name_parts) > 1 else ""

        # Format DOB: yyyy-mm-dd → dd.mm.yyyy
        formatted_dob = dob
        if dob and "-" in dob:
            parts = dob.split("-")
            if len(parts) == 3:
                formatted_dob = f"{parts[2]}.{parts[1]}.{parts[0]}"

        async def smart_fill(selectors: list, value: str):
            """Try selectors in order; use keyboard.type() so all JS events fire."""
            if not value:
                return False
            for selector in selectors:
                try:
                    el = await page.wait_for_selector(selector, timeout=3000, state="visible")
                    if not el:
                        continue
                    await el.scroll_into_view_if_needed()
                    await el.click()
                    await asyncio.sleep(0.2)
                    await page.keyboard.press('Control+A')
                    await page.keyboard.press('Delete')
                    await page.keyboard.type(value, delay=60)
                    # Dispatch events for Kendo/jQuery/React validation
                    await page.evaluate("""
                        (sel) => {
                            const el = document.querySelector(sel);
                            if (el) {
                                el.dispatchEvent(new Event('input', { bubbles: true }));
                                el.dispatchEvent(new Event('change', { bubbles: true }));
                                el.dispatchEvent(new Event('blur', { bubbles: true }));
                            }
                        }
                    """, selector)
                    print(f"[e-Ikamet Bot] ✅ Typed '{value}' → '{selector}'")
                    return True
                except Exception as e:
                    pass
            print(f"[e-Ikamet Bot] ⚠ Could not fill any selector for value '{value}'")
            return False

        async def select_kendo(field_id: str, value: str):
            """Open Kendo/jQuery dropdown and pick value by text."""
            if not value:
                return
            # Try to find and open the dropdown trigger
            trigger = None
            for t_sel in [
                f"[aria-owns='{field_id}-listbox']",
                f"[data-role='dropdownlist'][id='{field_id}']",
                f"span.k-dropdown-wrap[aria-labelledby*='{field_id}']",
                f"#{field_id}_wrapper span.k-dropdown-wrap",
            ]:
                try:
                    trigger = await page.query_selector(t_sel)
                    if trigger and await trigger.is_visible():
                        break
                    trigger = None
                except:
                    pass

            if trigger:
                try:
                    await trigger.click()
                    await asyncio.sleep(0.8)
                    for item_sel in [
                        f".k-animation-container li:has-text('{value}')",
                        f".k-list-container li:has-text('{value}')",
                        f"ul.k-list li:has-text('{value}')",
                        f"li.k-item:has-text('{value}')",
                    ]:
                        try:
                            await page.click(item_sel, timeout=2000)
                            print(f"[e-Ikamet Bot] ✅ Kendo '{field_id}' = '{value}'")
                            return
                        except:
                            pass
                except:
                    pass

            # Fallback: native HTML select
            for s_sel in [f"#{field_id}", f"select[name='{field_id}']",
                          f"select[name='{field_id.capitalize()}']"]:
                try:
                    await page.select_option(s_sel, label=value)
                    print(f"[e-Ikamet Bot] ✅ Native select '{field_id}' = '{value}'")
                    return
                except:
                    pass

        # Fill all fields
        await smart_fill(['#Ad', '#ad', 'input[name="Ad"]', 'input[placeholder*="Ad "]',
                          'input[placeholder*="Name"]', 'input[placeholder*="name"]'], first_name)

        await smart_fill(['#Soyad', '#soyad', 'input[name="Soyad"]', 'input[name="Surname"]',
                          'input[placeholder*="Soyad"]', 'input[placeholder*="Last"]'], last_name)

        await smart_fill(['#BabaAdi', '#BabaAd', '#babaAd', 'input[name="BabaAdi"]',
                          'input[name="BabaAd"]', 'input[placeholder*="Baba"]',
                          'input[placeholder*="Father"]'], father_name)

        await smart_fill(['#AnneAdi', '#AnneAd', '#anneAd', 'input[name="AnneAdi"]',
                          'input[name="AnneAd"]', 'input[placeholder*="Anne"]',
                          'input[placeholder*="Mother"]'], mother_name)

        await smart_fill(['#DogumTarihi', '#DogumTarih', '#dogumTarih',
                          'input[name="DogumTarihi"]', 'input[name="DogumTarih"]',
                          'input[placeholder*="Tarih"]', 'input[placeholder*="Birth"]'], formatted_dob)

        await smart_fill(['#UyrukKimlikNo', '#uyrukKimlikNo', 'input[name="UyrukKimlikNo"]',
                          'input[placeholder*="Kimlik"]', 'input[placeholder*="country ID"]'], nationality_id)

        await smart_fill(['#PasaportBelgeNo', '#pasaportBelgeNo', 'input[name="PasaportBelgeNo"]',
                          'input[name="PasaportNo"]', 'input[placeholder*="Pasaport"]',
                          'input[placeholder*="Passport"]', 'input[placeholder*="document"]'], passport_no)

        await smart_fill(['#EPosta', '#ePosta', 'input[name="EPosta"]',
                          'input[type="email"]', 'input[placeholder*="mail"]'], email)

        await smart_fill(['#CepTelefonu', '#CepTelefon', '#cepTelefon',
                          'input[name="CepTelefonu"]', 'input[name="CepTelefon"]',
                          'input[type="tel"]', 'input[placeholder*="Telefon"]',
                          'input[placeholder*="Phone"]'], phone)

        # Dropdowns
        await select_kendo("Cinsiyet", gender)
        await select_kendo("cinsiyet", gender)

        if nationality:
            await select_kendo("Uyruk", nationality)
            await select_kendo("uyruk", nationality)

        await select_kendo("IletisimTercihi", "E-Mail")
        await select_kendo("iletisimTercihi", "E-Mail")

        print("[e-Ikamet Bot] ✅ Pre-registration form filled. Leaving browser open for user review.")
        await asyncio.sleep(8)

        return {
            "status": "success",
            "message": (
                f"e-Ikamet bot launched the {'EXTENSION (Green)' if is_extension else 'NEW APPLICATION (Red)'} "
                f"portal and filled the pre-registration form for {full_name}. "
                "Please review the browser window, complete CAPTCHA if shown, and submit."
            ),
        }

    except Exception as e:
        err_trace = traceback.format_exc()
        print(f"[e-Ikamet Bot] Fatal Error:\n{err_trace}")
        return {"status": "error", "message": f"e-Ikamet Bot failed: {str(e)}"}

