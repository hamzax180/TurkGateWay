from sqlalchemy import Column, Integer, String, ForeignKey, DateTime, Text
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
