import sqlite3
import os

def migrate():
    # Use absolute path to ensure we're targeting the right file
    db_path = os.path.join(os.getcwd(), 'permitops.db')
    print(f"Targeting database at: {db_path}")
    
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    try:
        # Check if column already exists
        cursor.execute("PRAGMA table_info(users)")
        columns = [column[1] for column in cursor.fetchall()]
        
        if 'is_admin' not in columns:
            cursor.execute("ALTER TABLE users ADD COLUMN is_admin BOOLEAN DEFAULT 0")
            print("Added is_admin column.")
        else:
            print("is_admin column already exists.")
            
        # Make the user with 'hamza' in email an admin
        cursor.execute("UPDATE users SET is_admin = 1 WHERE email LIKE '%hamza%'")
        if cursor.rowcount > 0:
            print(f"Designated {cursor.rowcount} user(s) as admin.")
        else:
            # If no hamza, make everyone admin for dev purposes (safety first, maybe just the first user)
            cursor.execute("UPDATE users SET is_admin = 1 WHERE id = (SELECT MIN(id) FROM users)")
            print("Designated the first user as admin.")
            
        conn.commit()
        print("Migration and admin designation complete!")
    except Exception as e:
        print(f"Error during migration: {e}")
    finally:
        conn.close()

if __name__ == "__main__":
    migrate()
