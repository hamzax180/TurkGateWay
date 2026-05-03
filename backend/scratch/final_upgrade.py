import sqlite3
import os

db_path = "backend/permitops.db"
conn = sqlite3.connect(db_path)
cursor = conn.cursor()

# Update subscription_status to 'active' and make him admin too
cursor.execute("UPDATE users SET subscription_status = 'active', is_admin = 1 WHERE email = 'hamza@test.com'")
conn.commit()

print("User hamza@test.com has been upgraded to Premium and Admin!")

conn.close()
