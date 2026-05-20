import sys
import os
from sqlalchemy import text
# Add backend to path so we can import database
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from database import engine

def run():
    print("Adding is_favorite column to chat_sessions table...")
    with engine.begin() as conn:
        try:
            conn.execute(text("ALTER TABLE chat_sessions ADD COLUMN is_favorite BOOLEAN DEFAULT FALSE;"))
            print("Successfully added is_favorite column.")
        except Exception as e:
            if "duplicate column name" in str(e).lower() or "already exists" in str(e).lower():
                print("Column is_favorite already exists.")
            else:
                print(f"Error: {e}")

if __name__ == "__main__":
    run()
