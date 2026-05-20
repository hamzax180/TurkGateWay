import sqlite3
import os

db_path = "backend/permitops.db"
if not os.path.exists(db_path):
    print(f"Database not found at {db_path}")
    exit(1)

conn = sqlite3.connect(db_path)
cursor = conn.cursor()

# Update subscription_status to 'active' and tokens to something high
cursor.execute("UPDATE users SET subscription_status = 'active', token_balance = 999999 WHERE email = 'hamza@test.com'")
conn.commit()

print("User hamza@test.com has been upgraded to Premium!")

conn.close()
