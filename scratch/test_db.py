import sys
import os
sys.path.append(os.getcwd())
from backend.database import engine
try:
    with engine.connect() as conn:
        print("Database connection successful")
except Exception as e:
    print(f"Database connection failed: {e}")
