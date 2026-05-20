import sqlite3
import os

db_path = "backend/permitops.db"
if not os.path.exists(db_path):
    print(f"Database not found at {db_path}")
    exit(1)

conn = sqlite3.connect(db_path)
cursor = conn.cursor()

cursor.execute("SELECT id, email, full_name, subscription_status FROM users")
users = cursor.fetchall()

print("Current Users:")
for u in users:
    print(f"ID: {u[0]}, Email: {u[1]}, Name: {u[2]}, Sub: {u[3]}")

conn.close()
