# -*- coding: utf-8 -*-
"""
make-sample-documents.py
Generates a consistent set of SPECIMEN documents for testing the upload
checklist, the document extraction and the appointment automation.

Everything describes one fictional applicant, so uploading several of them
fills the intake coherently rather than producing a person with three names.

They are PNGs on purpose: the vision extractor reads images and the DashScope
API refuses PDFs outright, so a PDF sample would upload fine and extract
nothing — which is exactly the confusing result these are meant to avoid.

Every page is stamped SPECIMEN and carries fictional numbers. They are test
fixtures for our own pipeline, not imitations of real paperwork.

Run:  python scripts/make-sample-documents.py
Out:  sample-documents/*.png
"""

import os
import random
import sys
from datetime import date, timedelta

from PIL import Image, ImageDraw, ImageFont

OUT = "sample-documents"

# ---------------------------------------------------------------------------
# Dates are computed from today, never hard-coded.
#
# The appointment system only offers slots inside a ~30-day window, and a fixed
# travel date goes stale the moment it passes — a sample that says "travel
# 12/09/2026" is rejected as being in the past, or sits before the appointment
# it is supposed to follow. Deriving them keeps the whole set coherent: the
# appointment falls inside the window, travel is a few days after it, and the
# insurance covers from travel onwards.
# ---------------------------------------------------------------------------
TODAY = date.today()
APPOINTMENT = TODAY + timedelta(days=25)   # inside the 30-day booking window
DEPART = APPOINTMENT + timedelta(days=5)   # travel shortly after the appointment
RETURN = DEPART + timedelta(days=300)      # end of the academic year
INSURANCE_END = DEPART + timedelta(days=365)
DEADLINE = DEPART + timedelta(days=10)

def d(value):
    """DD/MM/YYYY — the format the samples print and the extractor understands."""
    return value.strftime("%d/%m/%Y")


# ---------------------------------------------------------------------------
# A fresh identity per run.
#
# The appointment site rate-limits by passport number — "too many appointments
# in the last 30 days" — so a fixed sample number is usable a handful of times
# and then permanently blocked for a month. Regenerating gives a clean one, and
# the email and phone move with it because those get rate-limited too.
#
# Pass --seed N to reproduce a previous applicant exactly.
# ---------------------------------------------------------------------------
_seed = None
for _i, _arg in enumerate(sys.argv):
    if _arg == "--seed" and _i + 1 < len(sys.argv):
        _seed = int(sys.argv[_i + 1])
random.seed(_seed)

SERIAL = random.randint(10_000_000, 99_999_999)
PASSPORT = f"A{SERIAL}"
# Turkmen mobiles are 6X XXXXXX after the +993 country code.
MOBILE = f"+993 6{random.randint(0, 9)} {random.randint(100000, 999999)}"
EMAIL = f"merdan.annayev{SERIAL % 1000}@example.com"


# One fictional applicant, referenced by every document below.
APPLICANT = {
    "surname": "ANNAYEV",
    "given": "MERDAN",
    "passport": PASSPORT,
    "nationality": "TURKMENISTAN",
    "dob": "14/03/2003",
    "pob": "ASHGABAT",
    "sex": "Male",
    "marital": "Single",
    "father": "SAPAR ANNAYEV",
    "mother": "OGULJAN ANNAYEVA",
    # Passport validity has to comfortably outlast the trip, or the visa itself
    # is refused — anchor it to the travel date rather than a fixed year.
    "issued": d(DEPART - timedelta(days=1600)),
    "expires": d(DEPART + timedelta(days=2200)),
    "authority": "ASHGABAT",
    "email": EMAIL,
    "phone": MOBILE,
    "address": "Garassyzlyk Street 45, Apt 12",
    "city": "Ashgabat",
    "zip": "744000",
    "country": "Turkmenistan",
    "depart": d(DEPART),
    "return": d(RETURN),
    "occupation": "Student",
    "university": "Istanbul Technical University",
}


def font(size, bold=False):
    """Windows ships these; fall back to PIL's bitmap font elsewhere."""
    for name in (["arialbd.ttf", "seguisb.ttf"] if bold else ["arial.ttf", "segoeui.ttf"]):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def page(filename, title, rows, note=None, width=1240, height=1754):
    """One document: title, a stamped SPECIMEN band, then label/value rows."""
    img = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(img)

    # Watermark goes down first so the values sit on top of it — drawn last it
    # covered them, and a half-hidden date is exactly what the extractor then
    # gets wrong.
    watermark = font(120, bold=True)
    for offset in (520, 900, 1280):
        draw.text((150, offset), "SPECIMEN", font=watermark, fill="#f4f4f4")

    draw.rectangle([0, 0, width, 130], fill="#1d3557")
    draw.text((50, 34), title, font=font(38, bold=True), fill="white")
    draw.text((50, 84), "SPECIMEN - SAMPLE DOCUMENT FOR SYSTEM TESTING", font=font(19), fill="#a8c0d8")

    y = 190
    for label, value in rows:
        if value is None:  # section break
            draw.line([50, y + 12, width - 50, y + 12], fill="#cccccc", width=2)
            draw.text((50, y + 26), label, font=font(24, bold=True), fill="#1d3557")
            y += 80
            continue
        draw.text((50, y), f"{label}:", font=font(23), fill="#555555")
        draw.text((520, y), str(value), font=font(25, bold=True), fill="#000000")
        y += 58

    if note:
        y += 30
        for line in note.split("\n"):
            draw.text((50, y), line, font=font(21), fill="#444444")
            y += 36

    draw.text((50, height - 70), "Fictional data. Generated for testing TurkGateway's document pipeline.",
           font=font(19), fill="#888888")

    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, filename)
    img.save(path, "PNG")
    print(f"  {path}")
    return path


a = APPLICANT
print(f"Applicant : {a['given']} {a['surname']}")
print(f"Passport  : {PASSPORT}   <- fresh each run; the site blocks a repeat for 30 days")
print(f"Mobile    : {MOBILE}")
print(f"Email     : {EMAIL}")
print(f"Travels   : {a['depart']}   (appointment window around {d(APPOINTMENT)})")
print()
print("Writing specimen documents:\n")

# ── The two that carry almost the whole visa intake ─────────────────────────
page("01-passport.png", "PASSPORT / PASAPORT", [
    ("Document type", "P"),
    ("Country code", "TKM"),
    ("Passport No", a["passport"]),
    ("Surname", a["surname"]),
    ("Given names", a["given"]),
    ("Nationality", a["nationality"]),
    ("Date of birth", a["dob"]),
    ("Place of birth", a["pob"]),
    ("Sex", a["sex"]),
    ("Marital status", a["marital"]),
    ("Father's name", a["father"]),
    ("Mother's name", a["mother"]),
    ("Date of issue", a["issued"]),
    ("Date of expiry", a["expires"]),
    ("Issuing authority", a["authority"]),
])

page("02-contact-and-travel.png", "APPLICANT CONTACT & TRAVEL SHEET", [
    ("Occupation", a["occupation"]),
    ("Email", a["email"]),
    ("Mobile", a["phone"]),
    ("Home address", a["address"]),
    ("Home city", a["city"]),
    ("Postal code", a["zip"]),
    ("Applying from", a["country"]),
    ("Planned travel date to Turkiye", a["depart"]),
    ("Planned return date", a["return"]),
])

# ── The rest of the student-visa checklist ─────────────────────────────────
page("03-acceptance-letter.png", "LETTER OF ACCEPTANCE", [
    ("University", a["university"]),
    ("Student name", f"{a['given']} {a['surname']}"),
    ("Passport No", a["passport"]),
    ("Programme", "BSc Computer Engineering"),
    ("Academic year", f"{DEPART.year} - {DEPART.year + 1}"),
    ("Registration deadline", d(DEADLINE)),
], note="This is to confirm that the above student has been accepted to the\n"
        "programme stated for the 2026-2027 academic year.")

page("04-bank-statement.png", "BANK STATEMENT", [
    ("Account holder", f"{a['given']} {a['surname']}"),
    ("Bank", "Turkmenistan State Bank"),
    ("Account No", "TM12 0000 1234 5678 90"),
    ("Currency", "USD"),
    ("Statement period", f"{d(TODAY - timedelta(days=90))} - {d(TODAY)}"),
    ("Closing balance", "8,450.00 USD"),
    ("Average monthly balance", "2,800.00 USD"),
])

page("05-health-insurance.png", "HEALTH INSURANCE POLICY", [
    ("Policy holder", f"{a['given']} {a['surname']}"),
    ("Passport No", a["passport"]),
    ("Policy number", "TR-HI-2026-778812"),
    ("Insurer", "Anadolu Sigorta"),
    ("Coverage start", d(DEPART)),
    ("Coverage end", d(INSURANCE_END)),
    ("Coverage", "Comprehensive - meets residence permit requirements"),
])

page("06-biometric-photo.png", "BIOMETRIC PHOTOGRAPH SHEET", [
    ("Name", f"{a['given']} {a['surname']}"),
    ("Photo size", "50 x 60 mm"),
    ("Background", "White"),
    ("Taken", TODAY.strftime("%m/%Y")),
], note="Placeholder standing in for the biometric photo file.")

page("07-visa-fee-receipt.png", "VISA APPLICATION FEE RECEIPT", [
    ("Applicant", f"{a['given']} {a['surname']}"),
    ("Passport No", a["passport"]),
    ("Receipt No", "MV-2026-0099431"),
    ("Application type", "Student Visa"),
    ("Consulate", "Turkish Embassy, Ashgabat"),
    ("Amount paid", "USD 75.00"),
    ("Payment date", d(TODAY)),
])

# ── Extra pieces the ikamet / university checklists ask for ────────────────
page("08-student-certificate.png", "STUDENT CERTIFICATE (OGRENCI BELGESI)", [
    ("University", a["university"]),
    ("Student name", f"{a['given']} {a['surname']}"),
    ("Student number", "820260114"),
    ("Faculty", "Faculty of Computer and Informatics"),
    ("Enrollment date", d(DEPART + timedelta(days=3))),
    ("Status", "Actively enrolled"),
])

page("09-rental-contract.png", "RENTAL CONTRACT (ADDRESS PROOF)", [
    ("Tenant", f"{a['given']} {a['surname']}"),
    ("Address in Turkiye", "Kadikoy, Caferaga Mah. No 18/4, Istanbul"),
    ("Landlord", "Ayse Yilmaz"),
    ("Contract start", d(DEPART)),
    ("Contract end", d(DEPART + timedelta(days=364))),
    ("Monthly rent", "18,000 TL"),
])

page("10-tax-number.png", "TAX NUMBER CERTIFICATE (VERGI KIMLIK NO)", [
    ("Full name", f"{a['given']} {a['surname']}"),
    ("Passport No", a["passport"]),
    ("Tax number", "9876543210"),
    ("Tax office", "Kadikoy Vergi Dairesi"),
    ("Issue date", d(DEPART + timedelta(days=6))),
])

page("11-diploma.png", "HIGH SCHOOL DIPLOMA (APOSTILLED)", [
    ("Holder", f"{a['given']} {a['surname']}"),
    ("Date of birth", a["dob"]),
    ("School", "Ashgabat Secondary School No 21"),
    ("Graduation year", str(DEPART.year - 5)),
    ("Grade average", "4.6 / 5.0"),
    ("Apostille No", "TKM-AP-2026-4471"),
])

page("12-transcript.png", "ACADEMIC TRANSCRIPT", [
    ("Student", f"{a['given']} {a['surname']}"),
    ("School", "Ashgabat Secondary School No 21"),
    ("Mathematics", "5 / 5"),
    ("Physics", "5 / 5"),
    ("English", "4 / 5"),
    ("Chemistry", "4 / 5"),
    ("Overall", "4.6 / 5.0"),
])

print(f"\nDone. {len(os.listdir(OUT))} files in {OUT}/")
print("\nMost useful for testing extraction:")
print("  01-passport.png            -> identity, passport and parent fields")
print("  02-contact-and-travel.png  -> contact, address and travel dates")
print("Between them they fill every field the visa form needs.")
