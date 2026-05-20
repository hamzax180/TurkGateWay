from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
import os
from dotenv import load_dotenv

# Define the base directory (backend folder)
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(BASE_DIR, '.env'))

# Keep the database inside a writable directory
# Render automatically sets RENDER=true. The /tmp directory is guaranteed to be writable.
if os.getenv("RENDER"):
    db_path = "/tmp/permitops.db"
else:
    ROOT_DIR = os.path.dirname(BASE_DIR)
    db_dir = os.path.join(ROOT_DIR, 'data')
    os.makedirs(db_dir, exist_ok=True)
    db_path = os.path.join(db_dir, 'permitops.db')

default_sqlite = f"sqlite:///{db_path}"
SQLALCHEMY_DATABASE_URL = os.getenv("DATABASE_URL", default_sqlite)

# Only add check_same_thread=False for SQLite databases
connect_args = {"check_same_thread": False} if SQLALCHEMY_DATABASE_URL.startswith("sqlite") else {}
print(f"[Database] Connecting to database at {SQLALCHEMY_DATABASE_URL}")
engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args=connect_args
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
