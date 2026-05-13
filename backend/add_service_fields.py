"""
add_service_fields.py
---------------------
One-shot migration: adds service_id and service_slots columns to
the chat_sessions table.  Safe to run multiple times — it checks
column existence first.
"""
import sqlite3
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# Resolve the same path logic used in database.py
if os.getenv("RENDER"):
    db_path = "/tmp/permitops.db"
else:
    ROOT_DIR = os.path.dirname(BASE_DIR)
    db_path = os.path.join(ROOT_DIR, "data", "permitops.db")

    # Fallback: local backend db (dev machines sometimes use this path)
    if not os.path.exists(db_path):
        alt = os.path.join(BASE_DIR, "permitops.db")
        if os.path.exists(alt):
            db_path = alt

print(f"[Migration] Targeting database: {db_path}")

conn = sqlite3.connect(db_path)
cur = conn.cursor()

cur.execute("PRAGMA table_info(chat_sessions)")
existing_cols = {row[1] for row in cur.fetchall()}

added = []
if "service_id" not in existing_cols:
    cur.execute("ALTER TABLE chat_sessions ADD COLUMN service_id TEXT")
    added.append("service_id")

if "service_slots" not in existing_cols:
    cur.execute("ALTER TABLE chat_sessions ADD COLUMN service_slots TEXT")
    added.append("service_slots")

if added:
    conn.commit()
    print(f"[Migration] OK Added columns: {added}")
else:
    print("[Migration] OK Columns already exist -- nothing to do.")

conn.close()
