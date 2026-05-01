import sys
import io

# Force UTF-8 encoding for stdout and stderr to prevent crashes on Windows with non-ASCII characters
if sys.stdout.encoding != 'utf-8':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
if sys.stderr.encoding != 'utf-8':
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')


# Adaptive Learning Engine - Heartbeat Force Reload
import os
import asyncio
import datetime
from fastapi import FastAPI, Depends, HTTPException, status, Query, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.responses import RedirectResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, List, Dict
import google.generativeai as genai
from dotenv import load_dotenv
import json

from database import engine, Base, get_db, SessionLocal
from models.user import User as DBUser
from models.chat import ChatSession, ChatMessage
from models.schemas import UserCreate, UserLogin, Token, UserQuery
from utils.auth import get_password_hash, verify_password, create_access_token, decode_access_token
from utils.protocol import get_localized_steps
from utils.payment import IyzicoPayment
from smart_router.learning_cache import learn as learn_response, set_database_session_factory

# Create tables
Base.metadata.create_all(bind=engine)

# Set up database access for the learning cache
set_database_session_factory(SessionLocal)

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), '.env'), override=True)

# --- Load AI Assistant Models ---
from agents.permit.model import gemini_model, chat_model
from agents.student.model import student_model, student_chat_model
from agents.lawyer.model import lawyer_model, lawyer_chat_model


app = FastAPI(title="PermitOps AI Backend")

@app.get("/")
async def root():
    return {"status": "ok", "message": "PermitOps AI Backend is running"}

# Configure CORS - Explicit origins are required when allow_credentials is True
origins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3001",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    # 1. HSTS (Strict Transport Security)
    response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    # 2. Prevent MIME-sniffing
    response.headers["X-Content-Type-Options"] = "nosniff"
    # 3. Clickjacking protection
    response.headers["X-Frame-Options"] = "DENY"
    # 4. XSS Protection filter
    response.headers["X-XSS-Protection"] = "1; mode=block"
    # 5. Basic Content Security Policy
    response.headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';"
    return response

# --- Try to load the agent pipeline (optional, runs in thread to avoid deadlock) ---
_agents_available = False
try:
    from workflow.permit_orchestrator import orchestrator
    from models.schemas import PermitState
    _agents_available = True
    print("[Startup] Agent pipeline loaded successfully")
except Exception as e:
    print(f"[Startup] Agent pipeline unavailable: {e}. Using direct Gemini fallback.")
# Global in-memory states for guests (non-persistent across restarts)
guest_dashboard_states = {}
guest_chat_histories: Dict[str, List[Dict]] = {}

def sanitize_surrogates(text: str) -> str:
    """Strip surrogate pairs that crash SQLite's utf-8 encoder."""
    if not isinstance(text, str): return text
    return "".join(c for c in text if not (0xD800 <= ord(c) <= 0xDFFF))

# ── Input allowlists ─────────────────────────────────────────────────────────
_VALID_LANGUAGES      = {"en", "tr", "ar"}
_VALID_AGENT_TYPES    = {"permit", "student", "lawyer"}
_SESSION_ID_PATTERN   = __import__('re').compile(r'^[a-zA-Z0-9\-_]{1,64}$')

def _safe_language(val: str) -> str:
    """Return val if it's an allowed language code, else 'en'."""
    return val if val in _VALID_LANGUAGES else "en"

def _safe_agent_type(val: str) -> str:
    """Return val if it's an allowed agent type, else 'permit'."""
    return val if val in _VALID_AGENT_TYPES else "permit"

def _safe_session_id(val: str) -> str:
    """Validate session_id; reject if it doesn't match safe pattern."""
    val = str(val).strip()
    return val if _SESSION_ID_PATTERN.match(val) else "default-session"


# --- Smart Router (zero/low-token layer) ---
try:
    from smart_router import smart_router_handle as _smart_router_handle
    _smart_router_available = True
    print("[Startup] Smart Router loaded successfully")
except Exception as _sr_err:
    _smart_router_available = False
    _smart_router_handle = None
    print(f"[Startup] Smart Router unavailable: {_sr_err}")


# Credential store — populated when user submits the e-Devlet/MERSİS modal
# Keyed by token (authenticated) or session_id (guest)
user_credentials_store: dict = {}

class UserCredentials(BaseModel):
    tckn: Optional[str] = None
    password: Optional[str] = None
    portal_url: Optional[str] = None
    step_id: Optional[int] = None
    # For Student/Residency bots
    full_name: Optional[str] = None
    passport_no: Optional[str] = None
    passport_type: Optional[str] = None
    ikamet_type: Optional[str] = None
    dob: Optional[str] = None
    is_extension: Optional[bool] = False
    father_name: Optional[str] = None
    mother_name: Optional[str] = None
    # Extended e-İkamet pre-registration fields
    nationality_id: Optional[str] = None
    nationality: Optional[str] = None
    gender: Optional[str] = "Male"
    email: Optional[str] = None
    phone: Optional[str] = None

from fastapi.security import APIKeyHeader
security = HTTPBearer()
security_optional = HTTPBearer(auto_error=False)
api_key_header = APIKeyHeader(name="Authorization", auto_error=False)

async def get_user_from_api_key(api_key_str: str = Depends(api_key_header), db: Session = Depends(get_db)):
    if not api_key_str:
        raise HTTPException(status_code=401, detail="API Key required")
    if api_key_str.startswith("Bearer "):
        api_key_str = api_key_str[7:]
    
    user = db.query(DBUser).filter(DBUser.api_key == api_key_str).first()
    if not user:
        raise HTTPException(status_code=401, detail="Invalid API Key")
    return user

async def get_current_user(token: str = None, db: Session = Depends(get_db), credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)):
    user = await get_current_user_optional(token, db, credentials)
    if not user:
        token_preview = (credentials.credentials[:10] + "...") if credentials else (token[:10] + "...") if token else "None"
        print(f"DEBUG: get_current_user failed. Token: {token_preview}")
        raise HTTPException(status_code=401, detail="Authentication required")
    return user

async def get_current_user_optional(token: str = None, db: Session = Depends(get_db), credentials: Optional[HTTPAuthorizationCredentials] = Depends(security_optional)):
    # Source token from header (preferred) or query param
    final_token = None
    # Check if credentials is the actual credentials object or just a Depends placeholder
    if credentials and hasattr(credentials, 'credentials'):
        final_token = credentials.credentials
    elif token:
        final_token = token
        
    if not final_token:
        return None
        
    payload = decode_access_token(final_token)
    if not payload:
        print(f"DEBUG: decode_access_token failed for token starting with {final_token[:10] if final_token else 'None'}")
        return None
        
    email: str = payload.get("sub")
    if email is None:
        return None
        
    try:
        user = db.query(DBUser).filter(DBUser.email == email).first()
        if not user:
            print(f"DEBUG: User not found in DB for email: {email}")
        return user
    except Exception as e:
        print(f"[DB Error in get_current_user_optional] {e}")
        return None

# --- Rate Limiting ---
limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

def user_id_key(request: Request):
    # Try to get user from token for more precise rate limiting (URL param or Auth Header)
    token = request.query_params.get("token")
    if not token:
        auth_header = request.headers.get("Authorization")
        if auth_header and auth_header.startswith("Bearer "):
            token = auth_header.split(" ")[1]
    
    if token:
        try:
            payload = decode_access_token(token)
            if payload and "sub" in payload:
                return f"user:{payload['sub']}"
        except:
            pass
    return f"ip:{get_remote_address(request)}"

# --- Auth Endpoints ---
@app.post("/auth/register", response_model=Token)
@limiter.limit("10/minute", key_func=user_id_key)
async def register(request: Request, user: UserCreate, db: Session = Depends(get_db)):
    db_user = db.query(DBUser).filter(DBUser.email == user.email).first()
    if db_user:
        raise HTTPException(status_code=400, detail="Email already registered")
    
    hashed_pwd = get_password_hash(user.password)
    new_user = DBUser(email=user.email, hashed_password=hashed_pwd, full_name=user.full_name)
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    
    access_token = create_access_token(data={"sub": new_user.email})
    return {"access_token": access_token, "token_type": "bearer", "email": new_user.email, "full_name": new_user.full_name, "is_admin": new_user.is_admin, "token_balance": new_user.token_balance}

@app.post("/auth/login", response_model=Token)
@limiter.limit("10/minute", key_func=user_id_key)
async def login(request: Request, user: UserLogin, db: Session = Depends(get_db)):
    db_user = db.query(DBUser).filter(DBUser.email == user.email).first()
    if not db_user or not verify_password(user.password, db_user.hashed_password):
        raise HTTPException(status_code=401, detail="Incorrect email or password")
    
    if db_user.mfa_enabled:
        if not user.mfa_code:
            raise HTTPException(status_code=403, detail="MFA_REQUIRED")
        import pyotp
        totp = pyotp.TOTP(db_user.mfa_secret)
        if not totp.verify(user.mfa_code):
            raise HTTPException(status_code=401, detail="Invalid MFA code")
    
    access_token = create_access_token(data={"sub": db_user.email})
    return {"access_token": access_token, "token_type": "bearer", "email": db_user.email, "full_name": db_user.full_name, "is_admin": db_user.is_admin, "token_balance": db_user.token_balance}

class MFAVerify(BaseModel):
    code: str

@app.post("/auth/mfa/setup")
async def setup_mfa(current_user: DBUser = Depends(get_current_user), db: Session = Depends(get_db)):
    if current_user.mfa_enabled:
        raise HTTPException(status_code=400, detail="MFA is already enabled")
    
    import pyotp
    secret = pyotp.random_base32()
    current_user.mfa_secret = secret
    db.commit()
    
    totp = pyotp.TOTP(secret)
    provisioning_uri = totp.provisioning_uri(name=current_user.email, issuer_name="PermitOps")
    
    return {"secret": secret, "provisioning_uri": provisioning_uri}

@app.post("/auth/mfa/verify")
async def verify_mfa(mfa: MFAVerify, current_user: DBUser = Depends(get_current_user), db: Session = Depends(get_db)):
    if current_user.mfa_enabled:
        raise HTTPException(status_code=400, detail="MFA is already enabled")
    
    if not current_user.mfa_secret:
        raise HTTPException(status_code=400, detail="MFA setup not initiated")
        
    import pyotp
    totp = pyotp.TOTP(current_user.mfa_secret)
    if totp.verify(mfa.code):
        current_user.mfa_enabled = True
        db.commit()
        return {"status": "success", "message": "MFA enabled successfully"}
    else:
        raise HTTPException(status_code=400, detail="Invalid code")

@app.post("/auth/check-email")
async def check_email(request: Request, db: Session = Depends(get_db)):
    body = await request.json()
    email = body.get("email")
    if not email:
        raise HTTPException(status_code=400, detail="Email is required")
    db_user = db.query(DBUser).filter(DBUser.email == email).first()
    if not db_user:
        raise HTTPException(status_code=404, detail="Couldn't find your TurkGateway Account")
    return {"status": "exists"}

import secrets
from models.schemas import APIKeyResponse, DeveloperChatRequest

@app.post("/auth/api-key/generate", response_model=APIKeyResponse)
async def generate_api_key(current_user: DBUser = Depends(get_current_user), db: Session = Depends(get_db)):
    api_key = f"sk_po_{secrets.token_urlsafe(32)}"
    current_user.api_key = api_key
    db.commit()
    return {"api_key": api_key}

@app.get("/auth/api-key")
async def get_api_key(current_user: DBUser = Depends(get_current_user)):
    return {"api_key": current_user.api_key}

@app.delete("/auth/api-key")
async def revoke_api_key(current_user: DBUser = Depends(get_current_user), db: Session = Depends(get_db)):
    current_user.api_key = None
    db.commit()
    return {"status": "success"}

# --- Developer API Public Endpoints ---
@app.post("/v1/chat/completions")
async def api_chat_completions(request: DeveloperChatRequest, current_user: DBUser = Depends(get_user_from_api_key), db: Session = Depends(get_db)):
    # Verify Token Limit
    if current_user.subscription_status == "free":
        now = datetime.datetime.utcnow()
        if current_user.last_token_reset is None or (now - current_user.last_token_reset).total_seconds() > 12 * 3600:
            current_user.token_balance = 5
            current_user.last_token_reset = now
            db.commit()
            
        if current_user.token_balance <= 0:
            raise HTTPException(status_code=429, detail="API Token Limit Reached")
        current_user.token_balance -= 1
        db.commit()
        
    # Standardize input
    user_message = next((m.content for m in reversed(request.messages) if m.role == "user"), "")
    if not user_message:
        raise HTTPException(status_code=400, detail="No user message provided")
        
    # Route to correct agent
    assistant_type = request.model.replace("permitops-", "").replace("-v1", "")
    if assistant_type not in ["permit", "student", "lawyer"]:
        assistant_type = "permit"
        
    try:
        model = None
        if assistant_type == "permit": model = gemini_model
        elif assistant_type == "student": model = student_model
        elif assistant_type == "lawyer": model = lawyer_model
        else: model = gemini_model
        
        if hasattr(model, 'generate_content_async'):
            response = await model.generate_content_async(user_message)
            text_resp = response.text
        else:
            text_resp = "API Agent not ready"
            
        return {
            "id": f"chatcmpl-{secrets.token_hex(12)}",
            "object": "chat.completion",
            "created": int(datetime.datetime.utcnow().timestamp()),
            "model": request.model,
            "choices": [{
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": text_resp,
                },
                "finish_reason": "stop"
            }],
            "usage": {
                "prompt_tokens": len(user_message) // 4,
                "completion_tokens": len(text_resp) // 4,
                "total_tokens": (len(user_message) + len(text_resp)) // 4
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/auth/me")
async def get_me(user: DBUser = Depends(get_current_user)):
    return {
        "email": user.email,
        "full_name": user.full_name,
        "is_admin": user.is_admin,
        "subscription_status": user.subscription_status,
        "token_balance": user.token_balance,
        "last_token_reset": user.last_token_reset.isoformat() if user.last_token_reset else None
    }

@app.delete("/auth/account")
async def delete_account(user: DBUser = Depends(get_current_user), db: Session = Depends(get_db)):
    # Delete all associated data
    session_ids = [s.id for s in db.query(ChatSession.id).filter(ChatSession.user_id == user.id).all()]
    if session_ids:
        db.query(ChatMessage).filter(ChatMessage.session_id.in_(session_ids)).delete(synchronize_session=False)
        db.query(ChatSession).filter(ChatSession.user_id == user.id).delete(synchronize_session=False)
    
    db.delete(user)
    db.commit()
    return {"status": "success", "message": "Account deleted successfully"}

import uuid

@app.get("/chat/sessions")
@limiter.limit("20/minute", key_func=user_id_key)
async def get_chat_sessions(request: Request, user: DBUser = Depends(get_current_user), db: Session = Depends(get_db)):
    sessions = db.query(ChatSession).filter(ChatSession.user_id == user.id).order_by(ChatSession.is_favorite.desc(), ChatSession.created_at.desc()).all()
    return [{"id": s.id, "title": s.title or "New Chat", "created_at": s.created_at, "assistant_type": s.assistant_type or "permit", "is_favorite": s.is_favorite} for s in sessions]

@app.post("/chat/sessions")
@limiter.limit("20/minute", key_func=user_id_key)
async def create_chat_session(request: Request, assistant_type: str = "permit", user: DBUser = Depends(get_current_user), db: Session = Depends(get_db)):
    session_id = str(uuid.uuid4())
    new_session = ChatSession(id=session_id, user_id=user.id, title="New Chat", assistant_type=assistant_type)
    db.add(new_session)
    db.commit()
    return {"id": session_id, "title": "New Chat", "assistant_type": assistant_type, "is_favorite": False}

@app.post("/chat/sessions/{session_id}/favorite")
@limiter.limit("20/minute", key_func=user_id_key)
async def toggle_session_favorite(request: Request, session_id: str, user: DBUser = Depends(get_current_user), db: Session = Depends(get_db)):
    session = db.query(ChatSession).filter(ChatSession.id == session_id, ChatSession.user_id == user.id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    session.is_favorite = not session.is_favorite
    db.commit()
    return {"status": "success", "is_favorite": session.is_favorite}

async def _get_history_context(session_id: str, db: Session, limit: int = 10, current_query: Optional[str] = None, strip_boilerplate: bool = False, user_id: Optional[int] = None) -> str:
    """Fetch recent chat history to provide context for the AI."""
    try:
        # 1. Ownership & Guest Check
        if not user_id:
            # GUEST MODE: Return in-memory history if available, else empty (block DB leak)
            guest_history = guest_chat_histories.get(session_id, [])
            if not guest_history:
                return ""
            
            # Format in-memory list chronologically
            context = "\n--- GUEST CHAT HISTORY (EPHEMERAL) ---\n"
            for m in guest_history[-limit:]:
                role = "User" if m["role"] == "user" else "Assistant"
                context += f"[{role}]: {m['content']}\n"
            context += "-------------------------------------\n"
            return context

        # 2. USER MODE: Strict ownership check for DB entries
        db_sess = db.query(ChatSession).filter(ChatSession.id == session_id).first()
        if not db_sess or db_sess.user_id != user_id:
            return ""

        # Fetch recent messages from DB
        msgs = db.query(ChatMessage).filter(ChatMessage.session_id == session_id)\
                 .order_by(ChatMessage.timestamp.desc()).limit(limit + 1).all()
        if not msgs:
            return ""
        
        # If the most recent message is the current query, skip it
        if current_query and msgs and msgs[0].role == "user" and msgs[0].content.strip() == current_query.strip():
            msgs = msgs[1:]
        
        msgs = msgs[:limit]
        if not msgs:
            return ""

        context = "\n--- PREVIOUS CONVERSATION HISTORY ---\n"
        for m in reversed(msgs):
            role = "User" if m.role == "user" else "Assistant"
            content = m.content
            if strip_boilerplate and role == "Assistant":
                lower_content = content.lower()
                for marker in ["permits (agencies)", "required docs", "action steps", "📋"]:
                    idx = lower_content.find(marker.lower())
                    if idx != -1:
                        content = content[:idx].strip()
                        lower_content = content.lower()
            context += f"[{role}]: {content}\n"
        context += "-------------------------------------\n"
        return context
    except Exception as e:
        print(f"[_get_history_context error] {e}")
        return ""

async def _run_local_fallback(query: str, assistant_type: str, language: str, user_name: str = "") -> str:
    """Last resort: Try to get a locally correct answer if AI fails."""
    try:
        from smart_router import smart_router_handle
        # Force the smart router to be more aggressive by passing a dummy history if needed
        # and ignore the confidence threshold by setting it to a specialized 'fallback' mode
        result = await smart_router_handle(
            query=query,
            assistant_type=assistant_type,
            user_name=user_name,
            language=language,
            history_text="[OFFLINE FALLBACK MODE]" # Signals the router to try harder
        )
        
        if result:
            if isinstance(result, tuple):
                return result[0]
            return result
            
        # Humanized local fallbacks if even smart router fails
        if assistant_type == "student":
            fallbacks = {
                "en": "Hey! \ud83c\udf93 I'm all set to help you with your student journey in Turkey. Whether it's university registration, your residence permit (Ikamet), or finding housing \u2014 just tell me what you need and we'll figure it out together!",
                "tr": "Selam! \ud83c\udf93 T\u00fcrkiye'deki \u00f6\u011frencilik maceranda sana yard\u0131m etmeye haz\u0131r\u0131m. \u00dcniversite kay\u0131t, ikamet izni veya yurt bulma \u2014 ne laz\u0131msa s\u00f6yle, beraber \u00e7\u00f6zelim!",
                "ar": "\u0623\u0647\u0644\u0627\u064b! \ud83c\udf93 \u0623\u0646\u0627 \u062c\u0627\u0647\u0632 \u0644\u0645\u0633\u0627\u0639\u062f\u062a\u0643 \u0641\u064a \u0631\u062d\u0644\u062a\u0643 \u0627\u0644\u062f\u0631\u0627\u0633\u064a\u0629 \u0641\u064a \u062a\u0631\u0643\u064a\u0627. \u0633\u0648\u0627\u0621 \u0643\u0627\u0646 \u0627\u0644\u062a\u0633\u062c\u064a\u0644 \u0627\u0644\u062c\u0627\u0645\u0639\u064a \u0623\u0648 \u0627\u0644\u0625\u0642\u0627\u0645\u0629 \u0623\u0648 \u0627\u0644\u0633\u0643\u0646 \u2014 \u0642\u0644\u0644\u064a \u0634\u0648 \u062a\u062d\u062a\u0627\u062c \u0648\u0628\u0646\u0631\u062a\u0628\u0647\u0627 \u0633\u0648\u0627!"
            }
        elif assistant_type == "lawyer":
            fallbacks = {
                "en": "Hi there! \u2696\ufe0f I'm ready to help you navigate Turkish law. Whether it's contracts, company formation, or a legal dispute \u2014 share the details and I'll point you in the right direction.",
                "tr": "Merhaba! \u2696\ufe0f T\u00fcrk hukuki s\u00fcre\u00e7lerinde sana yard\u0131mc\u0131 olmaya haz\u0131r\u0131m. S\u00f6zle\u015fme, \u015firket kurulu\u015fu veya hukuki bir mesele \u2014 detaylar\u0131 payla\u015f\u0131rsan en iyi y\u00f6n\u00fc birlikte bulal\u0131m.",
                "ar": "\u0623\u0647\u0644\u0627\u064b! \u2696\ufe0f \u0623\u0646\u0627 \u062c\u0627\u0647\u0632 \u0644\u0645\u0633\u0627\u0639\u062f\u062a\u0643 \u0641\u064a \u0627\u0644\u0634\u0624\u0648\u0646 \u0627\u0644\u0642\u0627\u0646\u0648\u0646\u064a\u0629 \u0641\u064a \u062a\u0631\u0643\u064a\u0627. \u0633\u0648\u0627\u0621 \u0643\u0627\u0646\u062a \u0639\u0642\u0648\u062f \u0623\u0648 \u062a\u0623\u0633\u064a\u0633 \u0634\u0631\u0643\u0629 \u0623\u0648 \u0646\u0632\u0627\u0639 \u0642\u0627\u0646\u0648\u0646\u064a \u2014 \u0634\u0627\u0631\u0643\u0646\u064a \u0627\u0644\u062a\u0641\u0627\u0635\u064a\u0644 \u0648\u0628\u0646\u0644\u0627\u0642\u064a \u0627\u0644\u062d\u0644 \u0627\u0644\u0623\u0646\u0633\u0628."
            }
        else: # permit
            fallbacks = {
                "en": "Hey! \ud83d\udc4b Let's get your business started in Turkey! To give you the best guidance, could you tell me what kind of business you're planning (cafe, shop, office, etc.) and which district you're looking at?",
                "tr": "Merhaba! \ud83d\udc4b Yeni i\u015fini T\u00fcrkiye'de kurmana yard\u0131m edelim! Sana en do\u011fru rehberli\u011fi yapabilmem i\u00e7in, ne t\u00fcr bir i\u015fletme (kafe, d\u00fckkan, ofis vb.) planlad\u0131\u011f\u0131n\u0131 ve hangi il\u00e7ede olaca\u011f\u0131n\u0131 s\u00f6yler misin?",
                "ar": "\u0623\u0647\u0644\u0627\u064b! \ud83d\udc4b \u062e\u0644\u064a\u0646\u0627 \u0646\u0628\u062f\u0623 \u0645\u0634\u0631\u0648\u0639\u0643 \u0627\u0644\u062c\u062f\u064a\u062f \u0641\u064a \u062a\u0631\u0643\u064a\u0627! \u0639\u0634\u0627\u0646 \u0623\u0633\u0627\u0639\u062f\u0643 \u0628\u0634\u0643\u0644 \u0623\u0641\u0636\u0644\u060c \u0642\u0644\u0644\u064a \u0634\u0648 \u0646\u0648\u0639 \u0627\u0644\u0646\u0634\u0627\u0637 (\u0645\u0642\u0647\u0649\u060c \u0645\u062d\u0644\u060c \u0645\u0643\u062a\u0628) \u0648\u0641\u064a \u0623\u064a \u0645\u0646\u0637\u0642\u0629\u061f"
            }
        return fallbacks.get(language, fallbacks["en"])
    except Exception as e:
        print(f"[_run_local_fallback CRITICAL] {e}")
        # Assistant-aware emergency fallbacks
        if assistant_type == "student":
            fallbacks = {
                "en": "I'm working on getting you the best answer! \ud83c\udf93 In the meantime, for student ID renewals, head to your faculty's Student Affairs office with your old ID and a photo.",
                "tr": "\u015eu anda en iyi cevab\u0131 haz\u0131rl\u0131yorum! \ud83c\udf93 Bu arada, \u00f6\u011frenci kimlik yenileme i\u00e7in eski kimli\u011finiz ve foto\u011frafla Fak\u00fclte \u00d6\u011frenci \u0130\u015fleri'ne ba\u015fvurun.",
                "ar": "\u0623\u0639\u0645\u0644 \u0639\u0644\u0649 \u0625\u064a\u062c\u0627\u062f \u0623\u0641\u0636\u0644 \u0625\u062c\u0627\u0628\u0629 \u0644\u0643! \ud83c\udf93 \u0628\u0627\u0644\u0646\u0633\u0628\u0629 \u0644\u062a\u062c\u062f\u064a\u062f \u0647\u0648\u064a\u0629 \u0627\u0644\u0637\u0627\u0644\u0628\u060c \u0631\u0627\u062c\u0639 \u0645\u0643\u062a\u0628 \u0634\u0624\u0648\u0646 \u0627\u0644\u0637\u0644\u0627\u0628 \u0645\u0639 \u0647\u0648\u064a\u062a\u0643 \u0627\u0644\u0642\u062f\u064a\u0645\u0629 \u0648\u0635\u0648\u0631\u0629."
            }
        else:
            fallbacks = {
                "en": "I'm putting together the best guidance for you! \ud83d\udc4b For permits, your local municipality office is the best starting point. Tell me what kind of business you're planning!",
                "tr": "Sizin i\u00e7in en do\u011fru rehberli\u011fi haz\u0131rl\u0131yorum! \ud83d\udc4b Ruhsat i\u015flemleri i\u00e7in ba\u011fl\u0131 oldu\u011funuz il\u00e7e belediyesi en iyi ba\u015flang\u0131\u00e7 noktas\u0131. Hangi t\u00fcr i\u015fletme planlad\u0131\u011f\u0131n\u0131z\u0131 s\u00f6yleyin!",
                "ar": "\u0623\u062d\u0636\u0631 \u0644\u0643 \u0623\u0641\u0636\u0644 \u0645\u0639\u0644\u0648\u0645\u0627\u062a! \ud83d\udc4b \u0628\u0627\u0644\u0646\u0633\u0628\u0629 \u0644\u0644\u062a\u0631\u0627\u062e\u064a\u0635\u060c \u0627\u0644\u0628\u0644\u062f\u064a\u0629 \u0627\u0644\u0645\u062d\u0644\u064a\u0629 \u0647\u064a \u0623\u0641\u0636\u0644 \u0646\u0642\u0637\u0629 \u0628\u062f\u0627\u064a\u0629. \u0642\u0644\u0644\u064a \u0634\u0648 \u0646\u0648\u0639 \u0627\u0644\u0645\u0634\u0631\u0648\u0639 \u0627\u0644\u0644\u064a \u062a\u062e\u0637\u0637 \u0644\u0647!"
            }
        return fallbacks.get(language, fallbacks["en"])

async def _run_with_agents(query: str, user: Optional[DBUser] = None, db: Session = None, language: str = "en", session_id: str = "default-session") -> str:
    """Run the multi-agent langgraph workflow."""
    if not _agents_available:
        return await _run_direct_gemini(query, user, db, language, session_id)
        
    initial_state = {
        "state": PermitState(business_profile={"raw_query": query, "language": language, "session_id": session_id}),
        "user_request": query,
        "language": language
    }

    try:
        # Inject history context into the user request
        history = await _get_history_context(session_id, db, user_id=user.id if user else None)
        full_query = f"{history}\nCURRENT USER REQUEST: {query}"
        
        # Enforce language in the query for the agent if not English
        if language == "ar":
            initial_state["user_request"] = f"(Answer strictly in Arabic / بالعربية) {full_query}"
        elif language == "tr":
            initial_state["user_request"] = f"(Lütfen Türkçe cevap veriniz) {full_query}"
        else:
            initial_state["user_request"] = full_query
            
        print(f"[_run_with_agents] Invoking orchestrator for session {session_id}")
        config = {"configurable": {"thread_id": session_id}}
        result = await orchestrator.ainvoke(initial_state, config=config)
        state = result["state"]
        print("[_run_with_agents] Orchestrator completed successfully")
    except Exception as e:
        print(f"[_run_with_agents ERROR] Orchestrator failed: {e}")
        raise

    dashboard_data = state.model_dump()
    if "last_updated" in dashboard_data and dashboard_data["last_updated"]:
        if hasattr(dashboard_data["last_updated"], "isoformat"):
            dashboard_data["last_updated"] = dashboard_data["last_updated"].isoformat()
            
    if user and db:
        try:
            db_session = db.query(ChatSession).filter(ChatSession.id == session_id, ChatSession.user_id == user.id).first()
            if db_session:
                print(f"[_run_with_agents] Saving for session {session_id}")
                db_session.dashboard_state = json.dumps(dashboard_data)
                db.commit()
            else:
                user.latest_dashboard_state = json.dumps(dashboard_data)
                db.commit()
        except Exception as e:
            print(f"[Dashboard Update Error] {e}")
    else:
        # Save to guest states
        global guest_dashboard_states
        print(f"[_run_with_agents] Updating guest_dashboard_states for {session_id}")
        guest_dashboard_states[session_id] = json.dumps(dashboard_data)

    if state.clarifying_question:
        return state.clarifying_question

    combined = state.combined_result
    if combined:
        # Override combined.steps with localized enforced steps from execution_plan
        steps_list = [s.title for s in state.execution_plan.steps]
        
        final_answer = (
            f"💬 {combined.summary}\n\n"
            f"📋 **Permits (Agencies):** {', '.join(combined.permits)}\n"
            f"📄 **Required Docs:** {', '.join(combined.documents[:6])}...\n"
            f"✅ **Action Steps:**\n" + "\n".join(f"{i+1}. {s}" for i, s in enumerate(steps_list)) +
            f"\n\n⏱️ **Timeline:** {combined.timeline_days} days"
        )
        
        # Learn for the future
        if user:
            learn_response(query, final_answer, "permit", language, dashboard_state=dashboard_data)
            
        return final_answer
    raise ValueError("Empty agent result")

async def _run_with_student_agents(query: str, user: Optional[DBUser] = None, db: Session = None, language: str = "en", session_id: str = "default-session") -> str:
    """Run the multi-agent langgraph workflow specifically for Students."""
    if not _agents_available:
        return await _run_direct_gemini(query, user, db, language, session_id, assistant_type="student")
        
    try:
        from workflow.student_orchestrator import student_orchestrator
    except ImportError as e:
        print(f"[_run_with_student_agents] Import Error: {e}")
        return await _run_direct_gemini(query, user, db, language, session_id, assistant_type="student")

    from models.schemas import PermitState
    
    initial_state = {
        "state": PermitState(business_profile={"raw_query": query, "language": language, "session_id": session_id}),
        "user_request": query,
        "language": language
    }

    try:
        history = await _get_history_context(session_id, db, user_id=user.id if user else None)
        full_query = f"{history}\nCURRENT USER REQUEST: {query}"
        
        if language == "ar":
            initial_state["user_request"] = f"(Answer strictly in Arabic / بالعربية) {full_query}"
        elif language == "tr":
            initial_state["user_request"] = f"(Lütfen Türkçe cevap veriniz) {full_query}"
        else:
            initial_state["user_request"] = full_query
            
        print(f"[_run_with_student_agents] Invoking Student orchestrator for session {session_id}")
        config = {"configurable": {"thread_id": session_id}}
        result = await student_orchestrator.ainvoke(initial_state, config=config)
        state = result["state"]
        print("[_run_with_student_agents] Orchestrator completed successfully")
    except Exception as e:
        print(f"[_run_with_student_agents ERROR] Orchestrator failed: {e}")
        raise

    import json
    import datetime
    dashboard_data = state.model_dump()
    if "last_updated" in dashboard_data and dashboard_data["last_updated"]:
        if hasattr(dashboard_data["last_updated"], "isoformat"):
            dashboard_data["last_updated"] = dashboard_data["last_updated"].isoformat()
            
    if user and db:
        try:
            db_session = db.query(ChatSession).filter(ChatSession.id == session_id, ChatSession.user_id == user.id).first()
            if db_session:
                print(f"[_run_with_student_agents] Saving for session {session_id}")
                db_session.dashboard_state = json.dumps(dashboard_data)
                db.commit()
            else:
                user.latest_dashboard_state = json.dumps(dashboard_data)
                db.commit()
        except Exception as e:
            print(f"[Dashboard Update Error] {e}")
    else:
        global guest_dashboard_states
        print(f"[_run_with_student_agents] Updating guest_dashboard_states for {session_id}")
        guest_dashboard_states[session_id] = json.dumps(dashboard_data)

    if state.clarifying_question:
        return state.clarifying_question

    combined = state.combined_result
    if combined:
        steps_list = [s.title for s in state.execution_plan.steps]
        
        final_answer = (
            f"💬 {combined.summary}\n\n"
            f"📋 **Institutions/Agencies:** {', '.join(combined.agencies)}\n"
            f"📄 **Required Docs:** {', '.join(combined.documents[:6])}...\n"
            f"✅ **Action Steps:**\n" + "\n".join(f"{i+1}. {s}" for i, s in enumerate(steps_list)) +
            f"\n\n⏱️ **Timeline:** {combined.timeline_days} days"
        )
        
        # Learn for the future
        if user:
            learn_response(query, final_answer, "student", language, dashboard_state=dashboard_data)
            
        return final_answer
    raise ValueError("Empty agent result")

async def _run_with_lawyer_agents(query: str, user: Optional[DBUser] = None, db: Session = None, language: str = "en", session_id: str = "default-session") -> str:
    """Run the multi-agent langgraph workflow specifically for Lawyers."""
    if not _agents_available:
        return await _run_direct_gemini(query, user, db, language, session_id, assistant_type="lawyer")
        
    try:
        from workflow.lawyer_orchestrator import lawyer_orchestrator
    except ImportError as e:
        print(f"[_run_with_lawyer_agents] Import Error: {e}")
        return await _run_direct_gemini(query, user, db, language, session_id, assistant_type="lawyer")

    from models.schemas import PermitState
    
    initial_state = {
        "state": PermitState(business_profile={"raw_query": query, "language": language, "session_id": session_id}),
        "user_request": query,
        "language": language
    }

    try:
        history = await _get_history_context(session_id, db, user_id=user.id if user else None)
        full_query = f"{history}\nCURRENT USER REQUEST: {query}"
        
        if language == "ar":
            initial_state["user_request"] = f"(Answer strictly in Arabic / بالعربية) {full_query}"
        elif language == "tr":
            initial_state["user_request"] = f"(Lütfen Türkçe cevap veriniz) {full_query}"
        else:
            initial_state["user_request"] = full_query
            
        print(f"[_run_with_lawyer_agents] Invoking Lawyer orchestrator for session {session_id}")
        config = {"configurable": {"thread_id": session_id}}
        result = await lawyer_orchestrator.ainvoke(initial_state, config=config)
        state = result["state"]
        print("[_run_with_lawyer_agents] Orchestrator completed successfully")
    except Exception as e:
        print(f"[_run_with_lawyer_agents ERROR] Orchestrator failed: {e}")
        raise

    import json
    import datetime
    dashboard_data = state.model_dump()
    if "last_updated" in dashboard_data and dashboard_data["last_updated"]:
        if hasattr(dashboard_data["last_updated"], "isoformat"):
            dashboard_data["last_updated"] = dashboard_data["last_updated"].isoformat()
            
    if user and db:
        try:
            db_session = db.query(ChatSession).filter(ChatSession.id == session_id, ChatSession.user_id == user.id).first()
            if db_session:
                print(f"[_run_with_lawyer_agents] Saving for session {session_id}")
                db_session.dashboard_state = json.dumps(dashboard_data)
                db.commit()
            else:
                user.latest_dashboard_state = json.dumps(dashboard_data)
                db.commit()
        except Exception as e:
            print(f"[Dashboard Update Error] {e}")
    else:
        global guest_dashboard_states
        print(f"[_run_with_lawyer_agents] Updating guest_dashboard_states for {session_id}")
        guest_dashboard_states[session_id] = json.dumps(dashboard_data)

    if state.clarifying_question:
        return state.clarifying_question

    combined = state.combined_result
    if combined:
        steps_list = [s.title for s in state.execution_plan.steps]
        
        final_answer = (
            f"💬 {combined.summary}\n\n"
            f"📋 **Institutions/Courts:** {', '.join(combined.agencies)}\n"
            f"📄 **Required Docs:** {', '.join(combined.documents[:6])}...\n"
            f"✅ **Action Steps:**\n" + "\n".join(f"{i+1}. {s}" for i, s in enumerate(steps_list)) +
            f"\n\n⏱️ **Timeline:** {combined.timeline_days} days"
        )
        
        # Learn for the future
        if user:
            learn_response(query, final_answer, "lawyer", language, dashboard_state=dashboard_data)
            
        return final_answer
    raise ValueError("Empty agent result")


async def _run_direct_gemini(query: str, user: Optional[DBUser] = None, db: Optional[Session] = None, language: str = "en", session_id: str = "default-session", is_followup: bool = False, file_obj=None, assistant_type: str = "permit") -> str:
    """Direct Gemini call — fast and reliable fallback."""
    global guest_dashboard_states
    history = ""
    if db:
        history = await _get_history_context(session_id, db, current_query=query, strip_boilerplate=is_followup, user_id=user.id if user else None)
        
    full_query = f"{history}\nCURRENT USER REQUEST: {query}"
    
    if is_followup:
        full_query = f"SYSTEM INSTRUCTION: This is a specific follow-up question. YOU MUST NOT append the 'Permits/Institutions', 'Required Docs', or 'Action Steps' lists to your answer. Just answer the user's specific question concisely.\n\n{full_query}"
    
    localized_query = full_query
    if language == "ar":
        localized_query = f"Answer in Arabic: {full_query}"
    elif language == "tr":
        localized_query = f"Answer in Turkish: {full_query}"
        
    prompt_list = [localized_query]
    if file_obj:
        prompt_list.insert(0, file_obj)
        
    if is_followup:
        if assistant_type == "student":
            model_to_use = student_chat_model
        elif assistant_type == "lawyer":
            model_to_use = lawyer_chat_model
        else:
            model_to_use = chat_model
        response = await asyncio.to_thread(model_to_use.generate_content, prompt_list)
    else:
        if assistant_type == "student":
            model_to_use = student_model
        elif assistant_type == "lawyer":
            model_to_use = lawyer_model
        else:
            model_to_use = gemini_model
        response = await asyncio.to_thread(model_to_use.generate_content, prompt_list)
    
    # Only mock state if we don't already have one for this session
    has_state = False
    if user and db:
        db_session = db.query(ChatSession).filter(ChatSession.id == session_id, ChatSession.user_id == user.id).first()
        if db_session and db_session.dashboard_state:
            has_state = True
        elif not db_session and user.latest_dashboard_state:
            has_state = True
    else:
        if session_id in guest_dashboard_states:
            has_state = True

    if not has_state:
        # Mock a workflow state for direct calls so the dashboard isn't empty
        localized_specs = get_localized_steps(language, query)
        mock_steps = [
            {"id": s[0], "title": s[1], "responsible": s[2], "status": "pending", "notes": s[3]}
            for s in localized_specs
        ]
        
        mock_state = {
            "business_profile": {"raw_query": query, "session_id": session_id},
            "execution_plan": {
                "steps": mock_steps,
                "assigned_agents": ["Planner", "Classifier"]
            },
            "last_updated": datetime.datetime.now().isoformat(),
            "direct_answer": response.text
        }
        
        # Custom labels/permits based on agent type
        if assistant_type == "student":
            mock_state["permit_plan"] = {
                "permits": ["Student Certificate (Öğrenci Belgesi)", "Residence Permit"],
                "agencies": ["University Student Affairs", "Göç İdaresi"],
                "documents": ["Passport", "Acceptance Letter", "Health Insurance"]
            }
        elif assistant_type == "lawyer":
            mock_state["permit_plan"] = {
                "permits": ["Legal Consultation"],
                "agencies": ["Law Bureau / Notary"],
                "documents": ["Identity Card", "Relevant Contracts / Evidence"]
            }
        else:
            mock_state["permit_plan"] = {
                "permits": ["İşyeri Açma ve Çalışma Ruhsatı"],
                "agencies": ["Municipality"],
                "documents": ["Tax registration", "Lease agreement", "ID copy"]
            }

        if user and db:
            db_session = db.query(ChatSession).filter(ChatSession.id == session_id, ChatSession.user_id == user.id).first()
            if db_session:
                print(f"[_run_direct_gemini] Saving for session {session_id}")
                db_session.dashboard_state = json.dumps(mock_state)
                db.commit()
            else:
                user.latest_dashboard_state = json.dumps(mock_state)
                db.commit()
        else:
            print(f"[_run_direct_gemini] Updating guest_dashboard_states (in-memory only) for {session_id}")
            guest_dashboard_states[session_id] = json.dumps(mock_state)
        
    if user:
        # Learn for the future (direct calls are often information-rich)
        learn_response(query, response.text, assistant_type, language, dashboard_state=mock_state if not has_state else None)
        
    return response.text


@app.post("/agent/query")
@limiter.limit("5/minute", key_func=user_id_key)
async def agent_query(request: Request, db: Session = Depends(get_db), user: Optional[DBUser] = Depends(get_current_user_optional)):
    content_type = request.headers.get("content-type", "")
    
    file_obj = None
    query_text = ""
    language = "en"
    session_id = "default-session"
    token = None
    
    if "multipart/form-data" in content_type:
        form = await request.form()
        query_text = str(form.get("query", ""))
        language = _safe_language(str(form.get("language", "en")))
        session_id = _safe_session_id(str(form.get("session_id", "default-session")))
        token = form.get("token")
        upload_file = form.get("file")
        assistant_type = _safe_agent_type(str(form.get("assistant_type", "permit")))
        
        # --- DEBUG TRACER ---
        import smart_router
        with open("data/location_check.txt", "w") as f:
            f.write(f"BRAIN_PATH: {smart_router.__file__}")
        print(f"🚀 [BRAIN LOCATION]: {smart_router.__file__}")
        
        if upload_file and upload_file.filename:
            import tempfile
            with tempfile.NamedTemporaryFile(delete=False, suffix=os.path.splitext(upload_file.filename)[1]) as tmp:
                content = await upload_file.read()
                tmp.write(content)
                tmp_path = tmp.name
            file_obj = genai.upload_file(tmp_path)
            query_text = f"📎 [Attached: {upload_file.filename}]\n{query_text}"
            
    else:
        body = await request.json()
        query_text = body.get("query", "")
        language = _safe_language(body.get("language", "en"))
        session_id = _safe_session_id(body.get("context", {}).get("session_id", "default-session"))
        assistant_type = _safe_agent_type(body.get("assistant_type", "permit"))
        print(f"\n[AI Agent] New Request: '{str(query_text)[:40]}...' (Type: {assistant_type}, Lang: {language})")
    
    # --- Dynamic Agent Correction (Safety Layer) ---
    _q_low = query_text.lower()
    if assistant_type == "permit":
        if any(w in _q_low for w in ["university", "campus", "study", "student id", "dorm", "scholarship", "istanbul university", "bau ", "metu", "itü", "boğaziçi"]):
            print(f"[SmartRouter] Dynamic Routing: Detected STUDENT topic. Overriding assistant_type.")
            assistant_type = "student"
        elif any(w in _q_low for w in ["lawsuit", "court", "sue ", "divorce", "legal dispute", "criminal", "arrest"]):
            print(f"[SmartRouter] Dynamic Routing: Detected LAWYER topic. Overriding assistant_type.")
            assistant_type = "lawyer"

    if not user and token:
        try:
            user = await get_current_user_optional(token, db)
        except:
            pass

    try:
        # Get or create session — PRIVACY RULE: Only persist to DB if logged in
        db_session = None
        if user:
            # Token limit check for free users
            # Token limit check for free users with 12-hour refresh
            if user.subscription_status == "free":
                now = datetime.datetime.utcnow()
                
                # 1. Reset check: If they are at 0, see if 12h passed since they hit 0
                if user.token_balance <= 0:
                    if user.last_token_reset and (now - user.last_token_reset).total_seconds() > 12 * 3600:
                        user.token_balance = 5
                        user.last_token_reset = None # Clear timer until they hit 0 again
                        db.commit()
                    else:
                        # Locked out - show when it will open
                        from fastapi import HTTPException
                        next_reset = (user.last_token_reset or now) + datetime.timedelta(hours=12)
                        reset_str = next_reset.strftime("%m/%d/%Y, %I:%M:%S %p")
                        raise HTTPException(status_code=403, detail=f"Model quota reached|{reset_str}")

                # 2. Consume token
                user.token_balance -= 1
                
                # 3. If they JUST hit 0, start the 12h timer from this moment
                if user.token_balance <= 0:
                    user.token_balance = 0
                    user.last_token_reset = now
                
                db.commit()
                
            db_session = db.query(ChatSession).filter(ChatSession.id == session_id, ChatSession.user_id == user.id).first()
            if not db_session:
                db_session = ChatSession(id=session_id, user_id=user.id, title=query_text[:50], assistant_type=assistant_type)
                db.add(db_session)
                db.commit()
            elif db_session and db_session.assistant_type != assistant_type:
                # Switch detected: update type and RESET title so it gets re-generated for the new agent
                print(f"[Agent Switch] {db_session.assistant_type} -> {assistant_type}. Resetting title.")
                db_session.assistant_type = assistant_type
                db_session.title = None 
                db.commit()

            if db_session and not db_session.title:
                # Clean up the query for a nice title
                clean = query_text.split('\n')[-1].strip() # Take last line if file attachment is first
                clean = clean.rstrip('?.! ')
                if len(clean) > 35:
                    clean = clean[:32] + "..."
                db_session.title = clean if clean else "New Consultation"
                db.commit()
        
        # Save user message — PRIVACY RULE: No guest chat saving to DB
        if user:
            user_msg = ChatMessage(session_id=session_id, role="user", content=query_text)
            db.add(user_msg)
            db.commit()
        else:
            print(f"[Guest Privacy] Saving user message to in-memory store for {session_id}")
            if session_id not in guest_chat_histories: guest_chat_histories[session_id] = []
            guest_chat_histories[session_id].append({"role": "user", "content": query_text})

        # ------------------------------------------------------------------
        # Auto-Redirect to correct agent if user is lost
        # ------------------------------------------------------------------
        q_lower = query_text.lower()
        if assistant_type == "permit":
            if any(k in q_lower for k in ["student", "university", "student id", "dorm", "kimlik", "renew id"]) and not any(k in q_lower for k in ["employee", "staff"]):
                msg_content = "🎓 It looks like you're asking about a Student task! Please click the **Switch Assistant** dropdown at the top of the page and select **Student Assistant** so I can correctly map out your academic roadmap."
                if user:
                    assistant_msg = ChatMessage(session_id=session_id, role="assistant", content=msg_content)
                    db.add(assistant_msg)
                    db.commit()
                return {"role": "assistant", "content": msg_content, "session_title": db_session.title if db_session else None}
            elif any(k in q_lower for k in ["sue ", "court", "lawsuit", "divorce", "criminal", "real estate dispute"]):
                msg_content = "⚖️ It looks like you need Legal Assistance! Please click the **Switch Assistant** dropdown at the top of the page and select **Lawyer Assistant** so our legal engine can help you."
                if user:
                    assistant_msg = ChatMessage(session_id=session_id, role="assistant", content=msg_content)
                    db.add(assistant_msg)
                    db.commit()
                return {"role": "assistant", "content": msg_content, "session_title": db_session.title if db_session else None}
        
        elif assistant_type in ("student", "lawyer"):
            # Redirect to Permit Agent for business queries
            if any(k in q_lower for k in ["business", "company", "cafe", "restaurant", "permit", "shop", "open a", "start a", "license", "startup"]):
                msg_content = "💼 It looks like you're planning to start a business! Please click the **Switch Assistant** dropdown at the top of the page and select **Permit Agent** so I can help you with your licensing roadmap and district-specific requirements."
                if user:
                    assistant_msg = ChatMessage(session_id=session_id, role="assistant", content=msg_content)
                    db.add(assistant_msg)
                    db.commit()
                else:
                    if session_id not in guest_chat_histories: guest_chat_histories[session_id] = []
                    guest_chat_histories[session_id].append({"role": "assistant", "content": msg_content})

                return {"role": "assistant", "content": msg_content, "session_title": db_session.title if db_session else None}

        # ------------------------------------------------------------------
        # Smart Router — attempt zero/low-token response before any AI call
        # ------------------------------------------------------------------
        if _smart_router_available and _smart_router_handle is not None and not file_obj:
            try:
                # get history for smart router context to detect isolated answers (e.g. "Kadikoy")
                # Use a larger limit (12) to prevent amnesia if the user makes typos or chats in between questions
                history_text = await _get_history_context(session_id, db, limit=12, strip_boilerplate=True, user_id=user.id if user else None)
                
                smart_answer, offline_state, smart_source = await _smart_router_handle(
                    query=query_text,
                    assistant_type=assistant_type,
                    user_name=user.full_name if user else "",
                    language=language,
                    gemini_model=gemini_model,
                    student_model=student_model,
                    lawyer_model=lawyer_model,
                    history_text=history_text,
                    can_learn=True  # Always learn — saves to local files for all future users
                )
                
                if smart_answer is not None:
                    smart_answer = sanitize_surrogates(smart_answer)
                    if user:
                        assistant_msg = ChatMessage(session_id=session_id, role="assistant", content=smart_answer)
                        db.add(assistant_msg)
                    
                    if offline_state:
                        # Offline dashboard generation without an AI request
                        print("\n" + "="*70)
                        print(f"✅ [ZERO-TOKEN OFFLINE GENERATOR] Offline Dashboard built for {assistant_type.upper()}")
                        print("="*70 + "\n")
                        import json
                        offline_state_json = json.dumps(offline_state)
                        if db_session:
                            db_session.dashboard_state = offline_state_json
                        elif user:
                            user.latest_dashboard_state = offline_state_json
                        else:
                            guest_dashboard_states[session_id] = offline_state_json
                        
                        # --- Update session title to reflect what was chosen ---
                        if db_session:
                            combined = offline_state.get("combined_result") or {}
                            btype = combined.get("business_type", "") or ""
                            loc = combined.get("location", "") or ""
                            # Build a descriptive title from business type + location
                            if assistant_type == "permit" and btype and btype != "Business":
                                new_title = f"{btype} in {loc}" if loc and loc != "Istanbul" else btype
                            elif assistant_type == "student":
                                if "renew" in btype.lower() if btype else False:
                                    new_title = "Student ID Renewal"
                                else:
                                    new_title = "University Registration"
                            elif assistant_type == "lawyer":
                                _LAWYER_TITLES = {
                                    "lawyer_contract": "Contract Review",
                                    "lawyer_company": "Company Formation",
                                    "lawyer_employment": "Employment Dispute",
                                    "lawyer_residency": "Residency / Work Permit",
                                    "lawyer_dispute": "Legal Dispute",
                                    "lawyer_real_estate": "Real Estate",
                                    "lawyer_criminal": "Criminal Case",
                                    "lawyer_debt": "Debt Collection",
                                }
                                new_title = _LAWYER_TITLES.get(btype, "Legal Consultation")
                            else:
                                new_title = None
                            if new_title:
                                if len(new_title) > 35:
                                    new_title = new_title[:32] + "..."
                                db_session.title = new_title
                    else:
                        print("\n" + "="*70)
                        print(f"📖 [ZERO-TOKEN LIBRARY MATCH] Predefined text response served")
                        print("="*70 + "\n")
                    
                    # Update session title if visa content detected
                    if db_session and assistant_type == "student":
                        smart_answer_lower = (smart_answer or "").lower()
                        current_title_lower = (db_session.title or "").lower()
                        
                        if any(kw in smart_answer_lower for kw in ["visa", "consulate", "vize"]):
                            if "visa" not in current_title_lower:
                                db_session.title = "Student Visa Application"
                                print(f"[Title Updated] Changed to: Student Visa Application")
                    
                    if user:
                        db.commit()
                    return {"role": "assistant", "content": smart_answer, "session_title": db_session.title if db_session else None, "source": smart_source}
            except Exception as sr_err:
                print(f"[SmartRouter ERROR] {sr_err} — falling through to orchestrator")
        
        # Default source if fallback to AI occurs
        source = "AI Orchestrator"

        if _agents_available:
            try:
                # Determine if this is an initial permit query or a follow-up
                # If the dashboard state is already built, this is ALWAYS a follow-up conversational question.
                # Running the orchestrator again would maliciously overwrite their dashboard.
                has_state = False
                import json
                if db_session and db_session.dashboard_state:
                    state_obj = json.loads(db_session.dashboard_state)
                    if state_obj.get("combined_result") is not None:
                        has_state = True
                elif session_id in guest_dashboard_states:
                    state_obj = json.loads(guest_dashboard_states[session_id])
                    if state_obj.get("combined_result") is not None:
                        has_state = True
                
                # Also fallback if the query explicitly mentions asking about a specific step
                lower_q = query_text.lower()
                is_explicit_q = "i need more information about step" in lower_q or "can you explain" in lower_q or "step " in lower_q
                
                is_direct = has_state or is_explicit_q or (file_obj is not None)
                is_followup_prompt = has_state or is_explicit_q or (file_obj is not None)
                
                # Topic-switch detection for student mode:
                # If they already have a completed plan and ask about a totally new topic, redirect to new chat
                if has_state and assistant_type == "student":
                    uni_keywords = ["top 10", "top10", "university list", "best uni", "best university", "universities", "top uni", "which university"]
                    renewal_keywords = ["renew", "renewal", "kimlik", "id card", "student id"]
                    existing_type = (state_obj.get("combined_result") or {}).get("business_type", "").lower()
                    q_lower = query_text.lower()
                    is_uni_q = any(k in q_lower for k in uni_keywords)
                    is_renewal_q = any(k in q_lower for k in renewal_keywords)
                    # If they shift topics (e.g. had renewal and now asking uni or vice versa), redirect
                    if is_uni_q and not is_renewal_q:
                        return {"content": "REDIRECT_NEW_CHAT:It looks like you're asking about a completely new topic (university search). I'll open a fresh chat for you so we can start your university roadmap from scratch! 🎓", "session_title": db_session.title if db_session else None}
                
                if is_direct:
                    print("\n" + "="*70)
                    print(f"🤖 [AI DIRECT REPLY] Using Gemini for a follow-up or specific {assistant_type} question")
                    print("="*70 + "\n")
                    source = f"Direct AI Reply ({assistant_type} agent)"
                    answer = await _run_direct_gemini(query_text, user, db, language, session_id, is_followup=is_followup_prompt, file_obj=file_obj, assistant_type=assistant_type)
                else:
                    if assistant_type == "student":
                        print("\n" + "="*70)
                        print(f"🧠 [AI ORCHESTRATOR] Routing to STUDENT LangGraph to generate plan")
                        print("="*70 + "\n")
                        source = "AI Orchestrator (Student Agent)"
                        answer = await _run_with_student_agents(query_text, user, db, language, session_id)
                    elif assistant_type == "lawyer":
                        print("\n" + "="*70)
                        print(f"🧠 [AI ORCHESTRATOR] Routing to LAWYER LangGraph to generate plan")
                        print("="*70 + "\n")
                        source = "AI Orchestrator (Lawyer Agent)"
                        answer = await _run_with_lawyer_agents(query_text, user, db, language, session_id)
                    else:
                        print("\n" + "="*70)
                        print(f"🧠 [AI ORCHESTRATOR] Routing to PERMIT LangGraph to generate plan")
                        print("="*70 + "\n")
                        source = "AI Orchestrator (Permit Agent)"
                        answer = await _run_with_agents(query_text, user, db, language, session_id)
            except Exception as agent_err:
                import traceback
                print(f"[AgentPipeline ERROR] {agent_err}")
                traceback.print_exc()
                # For student queries, always try the student direct model not the permit one
                answer = await _run_direct_gemini(query_text, user, db, language, session_id, is_followup=False, file_obj=file_obj, assistant_type=assistant_type)
                source = "AI Direct Reply (Pipeline Recovery)"
        else:
            print("\n" + "="*70)
            print(f"🤖 [AI DIRECT FALLBACK] Agents down or missing, using direct Gemini API")
            print("="*70 + "\n")
            source = "AI Direct Fallback (Agents Down)"
            answer = await _run_direct_gemini(query_text, user, db, language, session_id, is_followup=True, file_obj=file_obj, assistant_type=assistant_type)
        
        if True: # Always save assistant message now that we have session tracking
            # Run direct gemini
            # Perform a case-insensitive search to catch any bolding/emoji variations
            if is_followup_prompt and getattr(answer, '_is_direct_gemini', False) or (answer and not "✅" in answer and not "💬" in answer):
                # Only strip if it's purely a direct conversational followup that accidentally leaked boilerplate
                lower_answer = answer.lower()
                for marker in ["permits (agencies)", "required docs", "action steps", "📋"]:
                    idx = lower_answer.find(marker.lower())
                    if idx != -1:
                        answer = answer[:idx].strip()
                        lower_answer = answer.lower() # update for next iterations
                        
            answer = sanitize_surrogates(answer)
            # Save assistant message — PRIVACY RULE: Support guest ephemeral chat
            if user:
                assistant_msg = ChatMessage(session_id=session_id, role="assistant", content=answer)
                db.add(assistant_msg)
                db.commit()
            else:
                if session_id not in guest_chat_histories: guest_chat_histories[session_id] = []
                guest_chat_histories[session_id].append({"role": "assistant", "content": answer})

            # --- Adaptive Learning: Capture the high-quality orchestrator output for future reuse ---
            # We only learn if it came from an AI source and wasn't already served by the Smart Router
            if "AI" in source and _smart_router_available:
                try:
                    from smart_router.learning_cache import learn as learn_response
                    # Determine intent hint from business type if available
                    intent_hint = None
                    ds_state = None
                    if db_session and db_session.dashboard_state:
                         ds_state = json.loads(db_session.dashboard_state)
                         if ds_state.get("combined_result"):
                             intent_hint = ds_state["combined_result"].get("business_type")
                    
                    learn_response(
                        query=query_text, 
                        response=answer, 
                        assistant_type=assistant_type, 
                        language=language, 
                        intent_hint=intent_hint,
                        dashboard_state=ds_state
                    )
                except Exception as l_err:
                    print(f"[Adaptive LEARNING ERROR] {l_err}")

            # --- Update session title from dashboard state when orchestrator generated one ---
            if db_session and db_session.dashboard_state and not is_direct:
                try:
                    ds = json.loads(db_session.dashboard_state)
                    combined = ds.get("combined_result") or {}
                    btype = combined.get("business_type", "") or ""
                    loc = combined.get("location", "") or ""
                    new_title = None
                    
                    if assistant_type == "permit" and btype and btype.lower() not in ("business", ""):
                        if language == "tr":
                            new_title = f"{loc}'de {btype}" if loc and loc.lower() not in ("istanbul", "") else btype
                        elif language == "ar":
                            new_title = f"{btype} في {loc}" if loc and loc.lower() not in ("istanbul", "") else btype
                        else:
                            new_title = f"{btype} in {loc}" if loc and loc.lower() not in ("istanbul", "") else btype
                            
                    elif assistant_type == "student":
                        is_renew = "renew" in btype.lower() if btype else False
                        if language == "tr":
                            new_title = "Öğrenci Kimlik Yenileme" if is_renew else "Üniversite Kaydı"
                        elif language == "ar":
                            new_title = "تجديد هوية الطالب" if is_renew else "التسجيل الجامعي"
                        else:
                            new_title = "Student ID Renewal" if is_renew else "University Registration"
                            
                    elif assistant_type == "lawyer" and btype:
                        _LAWYER_TITLES = {
                            "en": {
                                "lawyer_contract": "Contract Review", "lawyer_company": "Company Formation", 
                                "lawyer_employment": "Employment Dispute", "lawyer_residency": "Residency / Work Permit",
                                "lawyer_dispute": "Legal Dispute", "lawyer_real_estate": "Real Estate",
                                "lawyer_criminal": "Criminal Case", "lawyer_debt": "Debt Collection"
                            },
                            "tr": {
                                "lawyer_contract": "Sözleşme İncelemesi", "lawyer_company": "Şirket Kuruluşu", 
                                "lawyer_employment": "İş Hukuku İhtilafı", "lawyer_residency": "İkamet / Çalışma İzni",
                                "lawyer_dispute": "Hukuki Uyuşmazlık", "lawyer_real_estate": "Gayrimenkul",
                                "lawyer_criminal": "Ceza Davası", "lawyer_debt": "İcra Takibi"
                            },
                            "ar": {
                                "lawyer_contract": "مراجعة العقود", "lawyer_company": "تأسيس الشركات", 
                                "lawyer_employment": "نزاع عمالي", "lawyer_residency": "الإقامة / تصريح العمل",
                                "lawyer_dispute": "نزاع قانوني", "lawyer_real_estate": "العقارات",
                                "lawyer_criminal": "قضية جنائية", "lawyer_debt": "تحصيل الديون"
                            }
                        }
                        lang_map = _LAWYER_TITLES.get(language, _LAWYER_TITLES["en"])
                        new_title = lang_map.get(btype)
                        if not new_title:
                            new_title = "Legal Consultation" if language == "en" else ("استشارة قانونية" if language == "ar" else "Hukuki Ajanlık")
                        
                    if new_title:
                        if len(new_title) > 35:
                            new_title = new_title[:32] + "..."
                        if db_session:
                            db_session.title = new_title
                        if user:
                            db.commit()
                except Exception as title_err:
                    print(f"[Title Update Error] {title_err}")

        print(f"[agent_query] Success. Content length: {len(answer)}")
        return {
            "role": "assistant", 
            "content": answer, 
            "session_title": db_session.title if db_session else None, 
            "source": source,
            "token_balance": user.token_balance if user else None
        }

    except Exception as e:
        print(f"[AgentQuery CRITICAL ERROR] {e}")
        import traceback
        traceback.print_exc()
        # Try local fallback if AI fails (e.g. invalid API key)
        try:
            fallback_answer = await _run_local_fallback(query_text, assistant_type, language, user.full_name if user else "")
            
            # Save fallback message with a premium "Local Core" badge
            assistant_msg = ChatMessage(session_id=session_id, role="assistant", content=fallback_answer)
            db.add(assistant_msg)
            db.commit()
            
            return {
                "role": "assistant", 
                "content": fallback_answer, 
                "session_title": db_session.title if db_session else None, 
                "source": "Backup Core Fallback",
                "token_balance": user.token_balance if user else None
            }
        except:
            return {"role": "assistant", "content": f"Critical Error: {str(e)}"}

@app.get("/chat/history/{session_id}")
async def get_chat_history(session_id: str, user: DBUser = Depends(get_current_user), db: Session = Depends(get_db)):
    # Ensure user owns the session
    session = db.query(ChatSession).filter(ChatSession.id == session_id, ChatSession.user_id == user.id).first()
    if not session:
        raise HTTPException(status_code=403, detail="Access denied")
    
    messages = db.query(ChatMessage).filter(ChatMessage.session_id == session_id).order_by(ChatMessage.timestamp.asc()).all()
    return [{"role": m.role, "content": m.content, "id": m.id} for m in messages]

@app.delete("/chat/history/{session_id}")
async def clear_chat_history(session_id: str, token: Optional[str] = None, db: Session = Depends(get_db)):
    # 1. Clear out any purely in-memory guest states that didn't reach the DB
    if session_id in guest_dashboard_states:
        del guest_dashboard_states[session_id]

    user = None
    if token:
        try:
            user = await get_current_user(token, db)
        except Exception:
            pass

    # 2. Check the Database
    session = db.query(ChatSession).filter(ChatSession.id == session_id).first()
    if session:
        # If it DOES exist in DB, verify ownership
        if not user or session.user_id != user.id:
            raise HTTPException(status_code=403, detail="Access denied")
            
        db.query(ChatMessage).filter(ChatMessage.session_id == session_id).delete()
        db.query(ChatSession).filter(ChatSession.id == session_id).delete()
        db.commit()

    return {"status": "success"}


@app.delete("/chat/sessions/clear")
async def clear_all_sessions(user: DBUser = Depends(get_current_user), db: Session = Depends(get_db)):
    # Delete all sessions belonging to this user.
    # We delete sessions, and cascade delete should handle messages.
    # To be absolutely sure in SQLite without relying solely on DB-level cascade:
    session_ids = [s.id for s in db.query(ChatSession.id).filter(ChatSession.user_id == user.id).all()]
    if session_ids:
        db.query(ChatMessage).filter(ChatMessage.session_id.in_(session_ids)).delete(synchronize_session=False)
        db.query(ChatSession).filter(ChatSession.user_id == user.id).delete(synchronize_session=False)
        db.commit()

    return {"status": "success", "message": "All conversations cleared"}


@app.get("/workflow/latest")
async def get_latest(session_id: Optional[str] = None, user: Optional[DBUser] = Depends(get_current_user_optional), db: Session = Depends(get_db)):

    if user:
        if session_id:
            db_session = db.query(ChatSession).filter(ChatSession.id == session_id, ChatSession.user_id == user.id).first()
            if db_session and db_session.dashboard_state:
                state = json.loads(db_session.dashboard_state)
                state['_session_id'] = session_id
                return state
        
        # Fallback to user latest if no session state
        if user.latest_dashboard_state:
            state = json.loads(user.latest_dashboard_state)
            # Try to find which session this belongs to
            latest_session = db.query(ChatSession).filter(
                ChatSession.user_id == user.id,
                ChatSession.dashboard_state.isnot(None)
            ).order_by(ChatSession.updated_at.desc()).first()
            if latest_session:
                state['_session_id'] = latest_session.id
            state['subscription_status'] = user.subscription_status
            return state
    
    # Fallback to guest states
    if session_id and session_id in guest_dashboard_states:
        state = json.loads(guest_dashboard_states[session_id])
        state['_session_id'] = session_id
        return state
            
    print(f"[get_latest] Returning empty state for session {session_id}")
    return {}


async def _get_and_update_state(step_id: int, user: Optional[DBUser], session_id: Optional[str], db: Session, new_status: str):
    state_dict = None
    db_session = None
    
    if user and session_id:
        db_session = db.query(ChatSession).filter(ChatSession.id == session_id, ChatSession.user_id == user.id).first()
        if db_session and db_session.dashboard_state:
            state_dict = json.loads(db_session.dashboard_state)
            
    if not state_dict and user and user.latest_dashboard_state:
        state_dict = json.loads(user.latest_dashboard_state)
        
    if not state_dict and session_id in guest_dashboard_states:
        state_dict = json.loads(guest_dashboard_states[session_id])
        
    if not state_dict:
        raise HTTPException(status_code=404, detail="No active workflow found")
    
    steps = state_dict.get("execution_plan", {}).get("steps", [])
    updated = False
    for step in steps:
        if step.get("id") == step_id:
            step["status"] = new_status
            updated = True
            break
            
    if not updated:
        raise HTTPException(status_code=404, detail="Step not found")
        
    serialized = json.dumps(state_dict)
    if db_session:
        db_session.dashboard_state = serialized
        db.commit()
    elif user:
        user.latest_dashboard_state = serialized
        db.commit()
    elif session_id:
        guest_dashboard_states[session_id] = serialized
        
    return state_dict

@app.post("/workflow/step/complete/{step_id}")
async def complete_step(step_id: int, session_id: Optional[str] = None, user: Optional[DBUser] = Depends(get_current_user_optional), db: Session = Depends(get_db)):
    try:
        await _get_and_update_state(step_id, user, session_id, db, "completed")
        return {"status": "success", "message": f"Step {step_id} marked as completed"}
    except Exception as e:
        if isinstance(e, HTTPException): raise e
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/workflow/step/automate/{step_id}")
async def automate_step(step_id: int, session_id: Optional[str] = None, user: Optional[DBUser] = Depends(get_current_user_optional), db: Session = Depends(get_db)):
    try:
        # Mark step as in-progress
        state_dict = await _get_and_update_state(step_id, user, session_id, db, "in-progress")

        steps = state_dict.get("execution_plan", {}).get("steps", [])
        step_title = ""
        for step in steps:
            if step.get("id") == step_id:
                step_title = step.get("title", "")
                break

        # Check which automation to run based on title
        store_key = str(user.id) if user else (session_id or "default")
        
        if any(kw in step_title for kw in ["MERSİS", "Company", "NACE", "Articles"]):
            creds = user_credentials_store.get(store_key)
            if not creds:
                await _get_and_update_state(step_id, user, session_id, db, "pending")
                return {"status": "error", "message": "No credentials found. Please submit your credentials via the portal modal first."}

            from bot import run_mersis_bot, MERSIS_URL
            result = await asyncio.to_thread(
                asyncio.run,
                run_mersis_bot(
                    tckn=creds["tckn"],
                    password=creds["password"],
                    portal_url=MERSIS_URL,
                    step_id=step_id,
                )
            )

            if result["status"] == "success":
                await _get_and_update_state(step_id, user, session_id, db, "completed")
                return {"status": "success", "message": result["message"]}
            else:
                await _get_and_update_state(step_id, user, session_id, db, "pending")
                return {"status": "error", "message": result["message"]}
        
        elif "Health Insurance" in step_title or "Sigorta" in step_title:
            from bot import run_health_insurance_bot
            creds = user_credentials_store.get(store_key, {})
            
            result = await asyncio.to_thread(asyncio.run, run_health_insurance_bot(
                passport_no=creds.get("passport_no", ""),
                dob=creds.get("dob", ""),
            ))
            if result["status"] == "success":
                await _get_and_update_state(step_id, user, session_id, db, "completed")
                return {"status": "success", "message": result["message"]}
            else:
                await _get_and_update_state(step_id, user, session_id, db, "pending")
                return {"status": "error", "message": result["message"]}

        elif "Kimlik" in step_title or "İkamet" in step_title:
            from bot import run_eikamet_bot
            creds = user_credentials_store.get(store_key, {})

            result = await asyncio.to_thread(asyncio.run, run_eikamet_bot(
                full_name=creds.get("full_name", "Mock Student"),
                passport_no=creds.get("passport_no", "A1234567"),
                passport_type=creds.get("passport_type", "Normal"),
                ikamet_type=creds.get("ikamet_type", "Student"),
                dob=creds.get("dob", "2000-01-01"),
                is_extension=creds.get("is_extension", False),
                father_name=creds.get("father_name", ""),
                mother_name=creds.get("mother_name", ""),
                nationality_id=creds.get("nationality_id", ""),
                nationality=creds.get("nationality", ""),
                gender=creds.get("gender", "Male"),
                email=creds.get("email", ""),
                phone=creds.get("phone", ""),
            ))
            if result["status"] == "success":
                await _get_and_update_state(step_id, user, session_id, db, "completed")
                return {"status": "success", "message": result["message"]}
            else:
                await _get_and_update_state(step_id, user, session_id, db, "pending")
                return {"status": "error", "message": result["message"]}

        # All other steps → simple simulate + complete
        await asyncio.sleep(3)
        await _get_and_update_state(step_id, user, session_id, db, "completed")
        return {"status": "success", "message": f"Step {step_id} automated successfully"}

    except Exception as e:
        if isinstance(e, HTTPException): raise e
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/business/intake")
async def business_intake(query: UserQuery):
    return await agent_query(query)


@app.post("/api/submit-edevlet")
async def submit_edevlet(creds: UserCredentials, session_id: Optional[str] = None, user: Optional[DBUser] = Depends(get_current_user_optional), db: Session = Depends(get_db)):
    try:
        from bot import run_edevlet_bot, run_mersis_bot
        docs_to_upload = ["lease_agreement.pdf", "tax_certificate.pdf"]
        
        # Try to extract the user's location from the session state
        target_session_id = session_id or "default-session"
        db_session = db.query(ChatSession).filter(ChatSession.id == target_session_id).first()
        location = "Beşiktaş" # Fallback
        
        if db_session and db_session.dashboard_state:
            try:
                state_data = json.loads(db_session.dashboard_state)
                # Check for location in nested combined_result
                location = state_data.get("combined_result", {}).get("location", "Beşiktaş")
            except Exception:
                pass

        # Persist credentials so automate_step can reuse them
        store_key = str(user.id) if user else (session_id or "default")
        user_credentials_store[store_key] = {
            "tckn": creds.tckn, 
            "password": creds.password,
            "full_name": creds.full_name,
            "passport_no": creds.passport_no,
            "passport_type": creds.passport_type,
            "ikamet_type": creds.ikamet_type,
            "dob": creds.dob,
            "is_extension": creds.is_extension,
            "father_name": creds.father_name,
            "mother_name": creds.mother_name,
            "nationality_id": creds.nationality_id,
            "nationality": creds.nationality,
            "gender": creds.gender or "Male",
            "email": creds.email,
            "phone": creds.phone,
        }
        print(f"[Credentials] Stored for key={store_key}")

        use_mersis = creds.portal_url and "mersis" in creds.portal_url.lower()
        use_eikamet = creds.portal_url and "e-ikamet" in creds.portal_url.lower()
        use_insurance = creds.portal_url and "sigorta" in creds.portal_url.lower() or "insurance" in creds.portal_url.lower()

        if use_mersis:
            from bot import run_mersis_bot, MERSIS_URL
            result = await asyncio.to_thread(
                asyncio.run,
                run_mersis_bot(creds.tckn, creds.password, creds.portal_url, creds.step_id or 0)
            )
        elif use_eikamet:
            from bot import run_eikamet_bot
            result = await asyncio.to_thread(
                asyncio.run,
                run_eikamet_bot(
                    full_name=creds.full_name or "Applicant",
                    passport_no=creds.passport_no or "",
                    passport_type=creds.passport_type or "Normal",
                    ikamet_type=creds.ikamet_type or "Student",
                    dob=creds.dob or "",
                    is_extension=creds.is_extension,
                    father_name=creds.father_name or "",
                    mother_name=creds.mother_name or "",
                    nationality_id=creds.nationality_id or "",
                    nationality=creds.nationality or "",
                    gender=creds.gender or "Male",
                    email=creds.email or "",
                    phone=creds.phone or "",
                )
            )
        elif use_insurance:
            from bot import run_health_insurance_bot
            result = await asyncio.to_thread(
                asyncio.run,
                run_health_insurance_bot(
                    passport_no=creds.passport_no or "",
                    dob=creds.dob or ""
                )
            )
        else:
            from bot import run_edevlet_bot
            result = await asyncio.to_thread(
                asyncio.run,
                run_edevlet_bot(creds.tckn, creds.password, docs_to_upload, location=location)
            )

        if result["status"] == "success":
            # State is already updated via automate_step if called from there, 
            # otherwise the frontend calls refresh() which gets the latest state.
            pass

        return result
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"status": "error", "message": str(e)}

# --- Iyzico Subscription Endpoints ---
iyzico = IyzicoPayment()

@app.post("/payment/subscribe")
async def initialize_subscription(
    plan_code: Optional[str] = Query(None), # e.g. "monthly-premium"
    user: DBUser = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    print(f"[Payment] Subscribe request for user: {user.email}")
    if not user:
        print("[Payment] Invalid token")
        raise HTTPException(status_code=401, detail="Invalid token")

    # Use plan_code if provided, else fallback to env or default
    plan = plan_code or os.getenv("IYZICO_DEFAULT_PLAN_CODE", "P66275815")
    print(f"[Payment] Initializing form for {user.email} and plan {plan}")
    
    callback_url = f"{os.getenv('APP_URL', 'http://localhost:3001')}/payment/callback"
    
    res = iyzico.initialize_subscription_checkout_form(
        user_email=user.email,
        user_id=str(user.id),
        pricing_plan_code=plan,
        callback_url=callback_url
    )
    
    if res.get('status') == 'success':
        print(f"[Payment] Successfully generated form for {user.email}")
        return {"status": "success", "checkoutFormContent": res.get('checkoutFormContent'), "token": res.get('token')}
    else:
        error_msg = res.get('errorMessage', 'Failed to initialize payment')
        print(f"[Payment] Initialization FAILED: {error_msg}")
        raise HTTPException(status_code=400, detail=error_msg)

@app.post("/payment/callback")
async def payment_callback(request: Request, db: Session = Depends(get_db)):
    # iyzico returns token as a form field
    form = await request.form()
    token = form.get("token")
    if not token:
        raise HTTPException(status_code=400, detail="Missing payment token")
    
    result = iyzico.get_subscription_result(token)
    frontend_url = os.getenv('APP_URL', 'http://localhost:3001')

    if result.get('status') == 'success':
        # Find user by reference or customer token if available
        sub_data = result.get('data', {})
        sub_id = sub_data.get('referenceCode')
        email = sub_data.get('customerEmail')
        
        user = db.query(DBUser).filter(DBUser.email == email).first()
        if user:
            user.subscription_status = "active"
            user.subscription_reference_code = sub_id
            db.commit()
            return RedirectResponse(url=f"{frontend_url}/dashboard?payment=success", status_code=303)
    
    error_msg = result.get('errorMessage', 'Payment failed')
    return RedirectResponse(url=f"{frontend_url}/dashboard?payment=error&message={error_msg}", status_code=303)

@app.post("/payment/webhook")
async def payment_webhook(request: Request, db: Session = Depends(get_db)):
    # Standard iyzico webhook handler
    # Verify signature in production!
    body = await request.json()
    event_type = body.get("iyziEventType")
    sub_id = body.get("subscriptionReferenceCode")
    
    if event_type == "SUBSCRIPTION_PAYMENT_FAILED":
        user = db.query(DBUser).filter(DBUser.subscription_reference_code == sub_id).first()
        if user:
            user.subscription_status = "past_due"
            db.commit()
    elif event_type == "SUBSCRIPTION_CANCELED":
        user = db.query(DBUser).filter(DBUser.subscription_reference_code == sub_id).first()
        if user:
            user.subscription_status = "canceled"
            db.commit()
            
    return {"status": "ok"}

# --- Admin Endpoints ---

@app.get("/admin/subscribers")
async def get_admin_subscribers(db: Session = Depends(get_db), current_user: DBUser = Depends(get_current_user)):
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    users = db.query(DBUser).all()
    return [
        {
            "id": u.id,
            "email": u.email,
            "full_name": u.full_name,
            "subscription_status": u.subscription_status,
            "subscription_reference_code": u.subscription_reference_code,
            "is_admin": u.is_admin
        } for u in users
    ]

if __name__ == "__main__":
    import uvicorn
    # Using 'main:app' string instead of app object to enable reload
    uvicorn.run("main:app", host="0.0.0.0", port=8003, reload=True, reload_dirs=["backend"])
