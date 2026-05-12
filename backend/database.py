from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
import os
from dotenv import load_dotenv

# Define the base directory (backend folder)
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(BASE_DIR, '.env'))

# Keep the database inside the backend directory to avoid path/permission issues on Render
db_path = os.path.join(BASE_DIR, 'permitops.db')
default_sqlite = f"sqlite:///{db_path}"
SQLALCHEMY_DATABASE_URL = os.getenv("DATABASE_URL", default_sqlite)

# Only add check_same_thread=False for SQLite databases
connect_args = {"check_same_thread": False} if SQLALCHEMY_DATABASE_URL.startswith("sqlite") else {}

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
