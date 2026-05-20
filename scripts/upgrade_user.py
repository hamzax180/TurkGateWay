import sqlite3
import sys

DB = 'data/permitops.db'

def list_users():
    conn = sqlite3.connect(DB)
    cur = conn.cursor()
    try:
        cur.execute('SELECT id, email, subscription_status, token_balance FROM users')
        rows = cur.fetchall()
        if not rows:
            print('No users found in DB')
            return
        for r in rows:
            print(f'{r[0]}\t{r[1]}\t{r[2]}\ttokens={r[3]}')
    finally:
        conn.close()

def upgrade_user(user_id):
    conn = sqlite3.connect(DB)
    cur = conn.cursor()
    try:
        cur.execute('SELECT id, email, subscription_status FROM users WHERE id=?', (user_id,))
        row = cur.fetchone()
        if not row:
            print('No user with id', user_id)
            return
        cur.execute("UPDATE users SET subscription_status=?, subscription_reference_code=?, token_balance=? WHERE id=?", ('active', 'admin_manual_upgrade', 1000, user_id))
        conn.commit()
        print('Upgraded user', row[1], '-> subscription_status=active')
    finally:
        conn.close()

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('Usage: python scripts/upgrade_user.py list|upgrade <user_id>')
        sys.exit(1)
    cmd = sys.argv[1]
    if cmd == 'list':
        list_users()
    elif cmd == 'upgrade':
        if len(sys.argv) < 3:
            print('Usage: python scripts/upgrade_user.py upgrade <user_id>')
            sys.exit(1)
        try:
            uid = int(sys.argv[2])
        except ValueError:
            print('user_id must be an integer')
            sys.exit(1)
        upgrade_user(uid)
    else:
        print('Unknown command', cmd)
