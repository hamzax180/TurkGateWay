import os
import uuid
import urllib.request
from fpdf import FPDF
from pathlib import Path

# Base directories
BASE_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = BASE_DIR / "static"
FONTS_DIR = STATIC_DIR / "fonts"
FORMS_DIR = STATIC_DIR / "forms"

# Ensure directories exist
os.makedirs(FONTS_DIR, exist_ok=True)
os.makedirs(FORMS_DIR, exist_ok=True)

FONT_PATH = FONTS_DIR / "Roboto-Regular.ttf"

def ensure_font():
    """Download Roboto if not exists to support Turkish chars."""
    if not os.path.exists(FONT_PATH):
        url = "https://github.com/googlefonts/roboto/raw/main/src/hinted/Roboto-Regular.ttf"
        try:
            urllib.request.urlretrieve(url, FONT_PATH)
        except Exception as e:
            print(f"Failed to download font: {e}")

class TurkGatewayPDF(FPDF):
    def __init__(self):
        super().__init__()
        ensure_font()
        if os.path.exists(FONT_PATH):
            self.add_font("Roboto", "", str(FONT_PATH), uni=True)
            self.add_font("Roboto", "B", str(FONT_PATH), uni=True)

    def header(self):
        # Arial bold 15
        if os.path.exists(FONT_PATH):
            self.set_font("Roboto", "B", 15)
        else:
            self.set_font("helvetica", "B", 15)
        
        # Calculate width of title and position
        w = self.get_string_width("TurkGateWay AI") + 6
        self.set_x((210 - w) / 2)
        
        # Colors of frame, background and text
        self.set_draw_color(0, 80, 180)
        self.set_fill_color(230, 230, 250)
        self.set_text_color(10, 40, 100)
        
        # Title
        self.cell(w, 9, "TurkGateWay AI", border=1, align="C", fill=True)
        self.ln(20)

    def footer(self):
        # Position at 1.5 cm from bottom
        self.set_y(-15)
        if os.path.exists(FONT_PATH):
            self.set_font("Roboto", "", 8)
        else:
            self.set_font("helvetica", "I", 8)
        self.set_text_color(128)
        # Page number
        self.cell(0, 10, f"Page {self.page_no()}", align="C")

def generate_petition_pdf(title: str, content: str) -> str:
    """
    Generates a PDF petition and returns the relative URL to it.
    """
    ensure_font()
    
    pdf = TurkGatewayPDF()
    pdf.add_page()
    
    # Title
    if os.path.exists(FONT_PATH):
        pdf.set_font("Roboto", "B", 14)
    else:
        pdf.set_font("helvetica", "B", 14)
    
    # Title
    pdf.cell(0, 10, title, align="C")
    pdf.ln(15)
    
    # Body
    if os.path.exists(FONT_PATH):
        pdf.set_font("Roboto", "", 12)
    else:
        pdf.set_font("helvetica", "", 12)
        
    pdf.multi_cell(0, 8, content)
    
    # Generate unique filename
    filename = f"form_{uuid.uuid4().hex[:8]}.pdf"
    file_path = FORMS_DIR / filename
    
    pdf.output(str(file_path))
    
    # Return URL to the static file
    return f"/static/forms/{filename}"
