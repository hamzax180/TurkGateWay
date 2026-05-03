import sqlite3
import os

db_path = "permitops.db" # Standard name, let's verify in database.py
if not os.path.exists(db_path):
    print(f"Database {db_path} not found in current directory.")
else:
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        cursor.execute("ALTER TABLE chat_sessions ADD COLUMN dashboard_state TEXT")
        conn.commit()
        conn.close()
        print("Successfully added dashboard_state column to chat_sessions table.")
    except sqlite3.OperationalError as e:
        print(f"Error: {e}")
    except Exception as e:
        print(f"An unexpected error occurred: {e}")
