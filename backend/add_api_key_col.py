import sys
import os
from sqlalchemy import text
from database import engine

def run():
    print("Adding api_key column to users table...")
    with engine.begin() as conn:
        try:
            conn.execute(text("ALTER TABLE users ADD COLUMN api_key VARCHAR UNIQUE;"))
            conn.execute(text("CREATE INDEX idx_users_api_key ON users(api_key);"))
            print("Successfully added api_key column.")
        except Exception as e:
            if "duplicate column name" in str(e).lower() or "already exists" in str(e).lower():
                print("Column api_key already exists.")
            else:
                print(f"Error: {e}")

if __name__ == "__main__":
    run()
