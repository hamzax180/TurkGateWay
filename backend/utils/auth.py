import os
from datetime import datetime, timedelta
from typing import Optional
import jwt

from dotenv import load_dotenv

# Define the base directory (backend folder)
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
# Check for .env in the backend folder (same as main.py)
env_path = os.path.join(BASE_DIR, '..', '.env')
if not os.path.exists(env_path):
    env_path = os.path.join(BASE_DIR, '.env')

load_dotenv(dotenv_path=env_path)

# --- Security Configuration ---
SECRET_KEY = os.getenv("JWT_SECRET_KEY", "your-super-secret-key-change-it")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7 # 1 week

import bcrypt

def verify_password(plain_password, hashed_password):
    return bcrypt.checkpw(plain_password.encode('utf-8'), hashed_password.encode('utf-8'))

def get_password_hash(password):
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

def decode_access_token(token: str):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except jwt.PyJWTError:
        return None
