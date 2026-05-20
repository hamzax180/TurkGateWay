import os
import google.generativeai as genai
from dotenv import load_dotenv

# Load env from .env in the same directory (backend)
load_dotenv(os.path.join(os.path.dirname(__file__), '.env'))

# --- Configure Google GenAI ---
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY", "")
genai.configure(api_key=GOOGLE_API_KEY)

# --- Model Definitions ---
# We use gemini-2.5-flash for maximum speed and intelligence
DEFAULT_MODEL_NAME = "gemini-2.5-flash"

def get_model(system_instruction: str):
    """Factory to create a Gemini model with a specific system instruction."""
    return genai.GenerativeModel(
        model_name=DEFAULT_MODEL_NAME,
        system_instruction=system_instruction
    )

# Common settings
TIMEOUT = 30  # seconds
MAX_TOKENS = 1024
