from sqlalchemy import Column, Integer, String, Boolean, Text, DateTime
from datetime import datetime
from database import Base

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True)
    hashed_password = Column(String)
    full_name = Column(String, nullable=True)
    is_active = Column(Boolean, default=True)
    latest_dashboard_state = Column(Text, nullable=True) # Serialized JSON
    subscription_status = Column(String, default="free") # free, active, past_due, canceled
    subscription_reference_code = Column(String, nullable=True)
    is_admin = Column(Boolean, default=False)
    token_balance = Column(Integer, default=5) # 5 tokens for free users by default
    last_token_reset = Column(DateTime, default=datetime.utcnow)
    mfa_secret = Column(String, nullable=True)
    mfa_enabled = Column(Boolean, default=False)
    api_key = Column(String, unique=True, index=True, nullable=True)
