import sqlite3
import os

db_path = 'permitops.db'
if os.path.exists(db_path):
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    # Update chat_sessions
    try:
        cursor.execute("ALTER TABLE chat_sessions ADD COLUMN updated_at DATETIME")
        print("Added updated_at to chat_sessions")
    except sqlite3.OperationalError:
        print("updated_at already exists in chat_sessions")

    # Update users for subscription
    try:
        cursor.execute("ALTER TABLE users ADD COLUMN subscription_status VARCHAR")
        print("Added subscription_status to users")
    except sqlite3.OperationalError:
        print("subscription_status already exists in users")

    try:
        cursor.execute("ALTER TABLE users ADD COLUMN subscription_reference_code VARCHAR")
        print("Added subscription_reference_code to users")
    except sqlite3.OperationalError:
        print("subscription_reference_code already exists in users")

    conn.commit()
    conn.close()
else:
    print(f"Database not found at {db_path}")
