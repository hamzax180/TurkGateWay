from sqlalchemy import Column, Integer, String, ForeignKey, DateTime, Text, Boolean
from sqlalchemy.orm import relationship
from datetime import datetime
from database import Base

class ChatSession(Base):
    __tablename__ = "chat_sessions"

    id = Column(String, primary_key=True, index=True) # Unique session ID
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    title = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    messages = relationship("ChatMessage", back_populates="session", cascade="all, delete-orphan")
    dashboard_state = Column(Text, nullable=True) # Serialized JSON for this specific session
    assistant_type = Column(String, default="permit", nullable=True)
    is_favorite = Column(Boolean, default=False)

    # ── Structured service state ────────────────────────────────────────────
    # service_id  : compound key that uniquely identifies the confirmed service
    #               e.g. "permit:cafe:kadikoy" | "student:register_uni:bogazici"
    #               | "lawyer:company_formation" — set once the setup agent
    #               collects enough info to build a roadmap.
    # service_slots: JSON object with the individual slot values extracted from
    #               the conversation, e.g.:
    #               {"business_type": "cafe", "district": "kadikoy",
    #                "university": null, "legal_topic": null}
    # Both are intentionally kept separate from dashboard_state so that the
    # smart router can load them with a single lightweight DB read at the
    # START of every /agent/query call — before any AI or roadmap logic runs.
    service_id    = Column(String, nullable=True, index=True)
    service_slots = Column(Text,   nullable=True)  # JSON string
    language      = Column(String, nullable=True, default="en")  # Fix #4: persist confirmed language


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(String, ForeignKey("chat_sessions.id"))
    role = Column(String) # 'user' or 'assistant'
    content = Column(Text)
    timestamp = Column(DateTime, default=datetime.utcnow)

    session = relationship("ChatSession", back_populates="messages")


class LearningResponse(Base):
    __tablename__ = "learning_responses"

    id = Column(Integer, primary_key=True, index=True)
    query = Column(String, index=True)  # Normalized query
    response = Column(Text)  # Full AI-generated response
    assistant_type = Column(String, index=True)  # 'permit', 'student', 'lawyer'
    intent = Column(String, index=True)  # 'visa', 'renew_id', 'learned', etc.
    language = Column(String, default="en", index=True)  # 'en', 'tr', 'ar'
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    usage_count = Column(Integer, default=0)  # Track if this learned response is reused
