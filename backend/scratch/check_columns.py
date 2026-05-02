import sqlite3
import os

db_path = "backend/permitops.db"
conn = sqlite3.connect(db_path)
cursor = conn.cursor()

cursor.execute("PRAGMA table_info(users)")
columns = cursor.fetchall()

print("Columns in 'users' table:")
for col in columns:
    print(f"ID: {col[0]}, Name: {col[1]}, Type: {col[2]}")

conn.close()
