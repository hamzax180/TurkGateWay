import sys
import os
from sqlalchemy import text
from database import engine

def run():
    print("Adding MFA columns to users table...")
    with engine.begin() as conn:
        try:
            conn.execute(text("ALTER TABLE users ADD COLUMN mfa_secret VARCHAR;"))
        except Exception as e:
            print(f"Error adding mfa_secret: {e}")
            
        try:
            conn.execute(text("ALTER TABLE users ADD COLUMN mfa_enabled BOOLEAN DEFAULT FALSE;"))
        except Exception as e:
            print(f"Error adding mfa_enabled: {e}")
            
    print("Done.")

if __name__ == "__main__":
    run()
