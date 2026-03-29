import sys
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

import os
import asyncio
import datetime
from fastapi import FastAPI, Depends, HTTPException, status, Query, Request
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

from database import engine, Base, get_db
from models.user import User as DBUser
from models.chat import ChatSession, ChatMessage
from models.schemas import UserCreate, UserLogin, Token, UserQuery
from utils.auth import get_password_hash, verify_password, create_access_token, decode_access_token
from utils.protocol import get_localized_steps
from utils.payment import IyzicoPayment

# Create tables
Base.metadata.create_all(bind=engine)

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), '.env'))

# --- Load AI Assistant Models ---
from agents.agent_models import gemini_model, chat_model, student_model, student_chat_model, lawyer_model, lawyer_chat_model


app = FastAPI(title="PermitOps AI Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Try to load the agent pipeline (optional, runs in thread to avoid deadlock) ---
_agents_available = False
try:
    from workflow.orchestrator import orchestrator
    from models.schemas import PermitState
    _agents_available = True
    print("[Startup] Agent pipeline loaded successfully")
except Exception as e:
    print(f"[Startup] Agent pipeline unavailable: {e}. Using direct Gemini fallback.")
# Global states for guests (non-persistent across restarts, keyed by session_id)
guest_dashboard_states = {}

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
    tckn: str
    password: str
    portal_url: Optional[str] = None
    step_id: Optional[int] = None

# --- Auth Dependency ---
async def get_current_user(token: str, db: Session = Depends(get_db)):
    payload = decode_access_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token")
    email: str = payload.get("sub")
    if email is None:
        raise HTTPException(status_code=401, detail="Invalid token")
    user = db.query(DBUser).filter(DBUser.email == email).first()
    if user is None:
        raise HTTPException(status_code=401, detail="User not found")
    return user

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
    return {"access_token": access_token, "token_type": "bearer", "email": new_user.email, "full_name": new_user.full_name, "is_admin": new_user.is_admin}

@app.post("/auth/login", response_model=Token)
@limiter.limit("10/minute", key_func=user_id_key)
async def login(request: Request, user: UserLogin, db: Session = Depends(get_db)):
    db_user = db.query(DBUser).filter(DBUser.email == user.email).first()
    if not db_user or not verify_password(user.password, db_user.hashed_password):
        raise HTTPException(status_code=401, detail="Incorrect email or password")
    
    access_token = create_access_token(data={"sub": db_user.email})
    return {"access_token": access_token, "token_type": "bearer", "email": db_user.email, "full_name": db_user.full_name, "is_admin": db_user.is_admin}

@app.get("/auth/me")
async def get_me(token: str, db: Session = Depends(get_db)):
    user = await get_current_user(token, db)
    return {
        "email": user.email,
        "full_name": user.full_name,
        "is_admin": user.is_admin,
        "subscription_status": user.subscription_status
    }

import uuid

@app.get("/chat/sessions")
@limiter.limit("20/minute", key_func=user_id_key)
async def get_chat_sessions(request: Request, token: str, db: Session = Depends(get_db)):
    user = await get_current_user(token, db)
    sessions = db.query(ChatSession).filter(ChatSession.user_id == user.id).order_by(ChatSession.created_at.desc()).all()
    return [{"id": s.id, "title": s.title or "New Chat", "created_at": s.created_at, "assistant_type": s.assistant_type or "permit"} for s in sessions]

@app.post("/chat/sessions")
@limiter.limit("20/minute", key_func=user_id_key)
async def create_chat_session(request: Request, token: str, assistant_type: str = "permit", db: Session = Depends(get_db)):
    user = await get_current_user(token, db)
    session_id = str(uuid.uuid4())
    new_session = ChatSession(id=session_id, user_id=user.id, title="New Chat", assistant_type=assistant_type)
    db.add(new_session)
    db.commit()
    return {"id": session_id, "title": "New Chat", "assistant_type": assistant_type}


async def _get_history_context(session_id: str, db: Session, limit: int = 10, current_query: Optional[str] = None, strip_boilerplate: bool = False) -> str:
    """Fetch recent chat history to provide context for the AI."""
    try:
        # Fetch more to allow for filtering
        msgs = db.query(ChatMessage).filter(ChatMessage.session_id == session_id)\
                 .order_by(ChatMessage.timestamp.desc()).limit(limit + 1).all()
        if not msgs:
            return ""
        
        # If the most recent message is the current query, skip it to avoid duplication
        if current_query and msgs and msgs[0].role == "user" and msgs[0].content.strip() == current_query.strip():
            msgs = msgs[1:]
        
        # Take only the intended limit
        msgs = msgs[:limit]
        
        if not msgs:
            return ""

        context = "\n--- PREVIOUS CONVERSATION HISTORY ---\n"
        # Reverse to get chronological order
        for m in reversed(msgs):
            role = "User" if m.role == "user" else "Assistant"
            content = m.content
            if strip_boilerplate and role == "Assistant":
                lower_content = content.lower()
                for marker in ["permits (agencies)", "required docs", "action steps", "📋"]:
                    idx = lower_content.find(marker.lower())
                    if idx != -1:
                        content = content[:idx].strip()
                        lower_content = content.lower() # update for next iterations
            context += f"[{role}]: {content}\n"
        context += "-------------------------------------\n"
        return context
    except Exception as e:
        print(f"[_get_history_context error] {e}")
        return ""

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
        history = await _get_history_context(session_id, db)
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
        
        return (
            f"💬 {combined.summary}\n\n"
            f"📋 **Permits (Agencies):** {', '.join(combined.permits)}\n"
            f"📄 **Required Docs:** {', '.join(combined.documents[:6])}...\n"
            f"✅ **Action Steps:**\n" + "\n".join(f"{i+1}. {s}" for i, s in enumerate(steps_list)) +
            f"\n\n⏱️ **Timeline:** {combined.timeline_days} days"
        )
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
        history = await _get_history_context(session_id, db)
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
        
        return (
            f"💬 {combined.summary}\n\n"
            f"📋 **Institutions/Agencies:** {', '.join(combined.agencies)}\n"
            f"📄 **Required Docs:** {', '.join(combined.documents[:6])}...\n"
            f"✅ **Action Steps:**\n" + "\n".join(f"{i+1}. {s}" for i, s in enumerate(steps_list)) +
            f"\n\n⏱️ **Timeline:** {combined.timeline_days} days"
        )
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
        history = await _get_history_context(session_id, db)
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
        
        return (
            f"💬 {combined.summary}\n\n"
            f"📋 **Institutions/Courts:** {', '.join(combined.agencies)}\n"
            f"📄 **Required Docs:** {', '.join(combined.documents[:6])}...\n"
            f"✅ **Action Steps:**\n" + "\n".join(f"{i+1}. {s}" for i, s in enumerate(steps_list)) +
            f"\n\n⏱️ **Timeline:** {combined.timeline_days} days"
        )
    raise ValueError("Empty agent result")


async def _run_direct_gemini(query: str, user: Optional[DBUser] = None, db: Optional[Session] = None, language: str = "en", session_id: str = "default-session", is_followup: bool = False, file_obj=None, assistant_type: str = "permit") -> str:
    """Direct Gemini call — fast and reliable fallback."""
    global guest_dashboard_states
    history = ""
    if db:
        history = await _get_history_context(session_id, db, current_query=query, strip_boilerplate=is_followup)
        
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
            "permit_plan": {
                "permits": ["İşyeri Açma ve Çalışma Ruhsatı"],
                "agencies": ["Municipality"],
                "documents": ["Tax registration", "Lease agreement", "ID copy"]
            },
            "last_updated": datetime.datetime.now().isoformat(),
            "direct_answer": response.text
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
            print(f"[_run_direct_gemini] Saving to guest_dashboard_states for {session_id}")
            guest_dashboard_states[session_id] = json.dumps(mock_state)
        
    return response.text


@app.post("/agent/query")
@limiter.limit("5/minute", key_func=user_id_key)
async def agent_query(request: Request, db: Session = Depends(get_db)):
    content_type = request.headers.get("content-type", "")
    
    file_obj = None
    query_text = ""
    language = "en"
    session_id = "default-session"
    token = None
    
    if "multipart/form-data" in content_type:
        form = await request.form()
        query_text = form.get("query", "")
        language = form.get("language", "en")
        session_id = form.get("session_id", "default-session")
        token = form.get("token")
        upload_file = form.get("file")
        assistant_type = form.get("assistant_type", "permit")
        
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
        language = body.get("language", "en")
        session_id = body.get("context", {}).get("session_id", "default-session")
        assistant_type = body.get("assistant_type", "permit")
        print(f"\n[AI Advisor] New Request: '{query_text[:40]}...' (Type: {assistant_type}, Lang: {language})")
    
    if request.query_params.get("token"):
        token = request.query_params.get("token")
    user = None
    if token:
        try:
            user = await get_current_user(token, db)
        except:
            pass

    try:
        # Get or create session
        db_session = db.query(ChatSession).filter(ChatSession.id == session_id).first()
        if not db_session:
            db_session = ChatSession(id=session_id, user_id=user.id if user else None, title=query_text[:50], assistant_type=assistant_type)
            db.add(db_session)
            db.commit()
        elif user and not db_session.user_id:
            # Upgrade guest session to user session if they log in
            db_session.user_id = user.id
            db.commit()
        elif db_session and db_session.assistant_type != assistant_type:
            # Auto-update if missing or they force change via UI
            db_session.assistant_type = assistant_type
            db.commit()
        if db_session and not db_session.title:
            # Clean up the query for a nice title
            clean = query_text.split('\n')[-1].strip() # Take last line if file attachment is first
            clean = clean.rstrip('?.! ')
            if len(clean) > 35:
                clean = clean[:32] + "..."
            db_session.title = clean if clean else "New Consultation"
            db.commit()
        
        # Save user message
        user_msg = ChatMessage(session_id=session_id, role="user", content=query_text)
        db.add(user_msg)
        db.commit()

        # ------------------------------------------------------------------
        # Smart Router — attempt zero/low-token response before any AI call
        # ------------------------------------------------------------------
        if _smart_router_available and _smart_router_handle is not None and not file_obj:
            try:
                smart_result = await _smart_router_handle(
                    query=query_text,
                    assistant_type=assistant_type,
                    user_name=user.full_name if user else "",
                    language=language,  # passes language for localized offline replies
                    gemini_model=gemini_model,
                    student_model=student_model,
                    lawyer_model=lawyer_model,
                )
                
                smart_answer = None
                offline_state = None
                
                if isinstance(smart_result, tuple):
                    smart_answer, offline_state = smart_result
                elif isinstance(smart_result, str):
                    smart_answer = smart_result
                
                if smart_answer is not None:
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
                    else:
                        print("\n" + "="*70)
                        print(f"📖 [ZERO-TOKEN LIBRARY MATCH] Predefined text response served")
                        print("="*70 + "\n")
                            
                    db.commit()
                    return {"role": "assistant", "content": smart_answer, "session_title": db_session.title if db_session else None}
            except Exception as sr_err:
                print(f"[SmartRouter ERROR] {sr_err} — falling through to orchestrator")
        # ------------------------------------------------------------------

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
                    answer = await _run_direct_gemini(query_text, user, db, language, session_id, is_followup=is_followup_prompt, file_obj=file_obj, assistant_type=assistant_type)
                else:
                    if assistant_type == "student":
                        print("\n" + "="*70)
                        print(f"🧠 [AI ORCHESTRATOR] Routing to STUDENT LangGraph to generate plan")
                        print("="*70 + "\n")
                        answer = await _run_with_student_agents(query_text, user, db, language, session_id)
                    elif assistant_type == "lawyer":
                        print("\n" + "="*70)
                        print(f"🧠 [AI ORCHESTRATOR] Routing to LAWYER LangGraph to generate plan")
                        print("="*70 + "\n")
                        answer = await _run_with_lawyer_agents(query_text, user, db, language, session_id)
                    else:
                        print("\n" + "="*70)
                        print(f"🧠 [AI ORCHESTRATOR] Routing to PERMIT LangGraph to generate plan")
                        print("="*70 + "\n")
                        answer = await _run_with_agents(query_text, user, db, language, session_id)
            except Exception as agent_err:
                import traceback
                print(f"[AgentPipeline ERROR] {agent_err}")
                traceback.print_exc()
                # For student queries, always try the student direct model not the permit one
                answer = await _run_direct_gemini(query_text, user, db, language, session_id, is_followup=False, file_obj=file_obj, assistant_type=assistant_type)
        else:
            print("\n" + "="*70)
            print(f"🤖 [AI DIRECT FALLBACK] Agents down or missing, using direct Gemini API")
            print("="*70 + "\n")
            answer = await _run_direct_gemini(query_text, user, db, language, session_id, is_followup=True, file_obj=file_obj, assistant_type=assistant_type)
        
        if True: # Always save assistant message now that we have session tracking
            # Bruteforce strip any leftover permit boilerplate just in case the LLM stubbornly generated it
            # Perform a case-insensitive search to catch any bolding/emoji variations
            if is_followup_prompt:
                lower_answer = answer.lower()
                for marker in ["permits (agencies)", "required docs", "action steps", "📋"]:
                    idx = lower_answer.find(marker.lower())
                    if idx != -1:
                        answer = answer[:idx].strip()
                        lower_answer = answer.lower() # update for next iterations
                        
            # Save assistant message
            assistant_msg = ChatMessage(session_id=session_id, role="assistant", content=answer)
            db.add(assistant_msg)
            db.commit()

        print(f"[agent_query] Success. Content length: {len(answer)}")
        return {"role": "assistant", "content": answer, "session_title": db_session.title if db_session else None}

    except Exception as e:
        print(f"[AgentQuery ERROR] {e}")
        return {"role": "assistant", "content": f"Error: {str(e)}"}

@app.get("/chat/history/{session_id}")
async def get_chat_history(session_id: str, token: str, db: Session = Depends(get_db)):
    user = await get_current_user(token, db)
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


@app.get("/workflow/latest")
async def get_latest(token: Optional[str] = None, session_id: Optional[str] = None, db: Session = Depends(get_db)):
    user = None
    if token:
        try:
            user = await get_current_user(token, db)
        except:
            pass

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


async def _get_and_update_state(step_id: int, token: Optional[str], session_id: Optional[str], db: Session, new_status: str):
    user = None
    if token:
        try:
            user = await get_current_user(token, db)
        except:
            pass

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
async def complete_step(step_id: int, token: Optional[str] = None, session_id: Optional[str] = None, db: Session = Depends(get_db)):
    try:
        await _get_and_update_state(step_id, token, session_id, db, "completed")
        return {"status": "success", "message": f"Step {step_id} marked as completed"}
    except Exception as e:
        if isinstance(e, HTTPException): raise e
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/workflow/step/automate/{step_id}")
async def automate_step(step_id: int, token: Optional[str] = None, session_id: Optional[str] = None, db: Session = Depends(get_db)):
    try:
        # Mark step as in-progress
        await _get_and_update_state(step_id, token, session_id, db, "in-progress")

        # Steps 3, 4, 5 → MERSİS automation using stored credentials
        if step_id in (3, 4, 5):
            store_key = token or session_id
            creds = user_credentials_store.get(store_key)
            if not creds:
                await _get_and_update_state(step_id, token, session_id, db, "pending")
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
                await _get_and_update_state(step_id, token, session_id, db, "completed")
                return {"status": "success", "message": result["message"]}
            else:
                await _get_and_update_state(step_id, token, session_id, db, "pending")
                return {"status": "error", "message": result["message"]}

        # All other steps → simple simulate + complete
        await asyncio.sleep(3)
        await _get_and_update_state(step_id, token, session_id, db, "completed")
        return {"status": "success", "message": f"Step {step_id} automated successfully"}

    except Exception as e:
        if isinstance(e, HTTPException): raise e
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/business/intake")
async def business_intake(query: UserQuery):
    return await agent_query(query)


@app.post("/api/submit-edevlet")
async def submit_edevlet(creds: UserCredentials, token: Optional[str] = None, session_id: Optional[str] = None, db: Session = Depends(get_db)):
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

        # Persist credentials so automate_step can reuse them for steps 3/4/5
        store_key = token or session_id or "default"
        user_credentials_store[store_key] = {"tckn": creds.tckn, "password": creds.password}
        print(f"[Credentials] Stored for key={store_key}")

        use_mersis = creds.portal_url and "mersis" in creds.portal_url.lower()

        if use_mersis:
            result = await asyncio.to_thread(
                asyncio.run,
                run_mersis_bot(creds.tckn, creds.password, creds.portal_url, creds.step_id or 0)
            )
        else:
            result = await asyncio.to_thread(
                asyncio.run,
                run_edevlet_bot(creds.tckn, creds.password, docs_to_upload, location=location)
            )

        if result["status"] == "success":
            if "execution_plan" in latest_workflow:
                if len(latest_workflow["execution_plan"]["steps"]) > 1:
                    latest_workflow["execution_plan"]["steps"][1] = "Completed: " + latest_workflow["execution_plan"]["steps"][1]
            latest_workflow["last_updated"] = "Just now"

        return result
    except Exception as e:
        return {"status": "error", "message": str(e)}

# --- Iyzico Subscription Endpoints ---
iyzico = IyzicoPayment()

@app.post("/payment/subscribe")
async def initialize_subscription(
    token: str, 
    plan_code: Optional[str] = Query(None), # e.g. "monthly-premium"
    db: Session = Depends(get_db)
):
    print(f"[Payment] Subscribe request with token: {token[:10]}...")
    user = await get_current_user(token, db)
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
    uvicorn.run(app, host="0.0.0.0", port=8003)
