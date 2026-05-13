import sqlite3, os

paths = [
    os.path.join('..', 'data', 'permitops.db'),
    'permitops.db',
]

for db_path in paths:
    if not os.path.exists(db_path):
        print(f'SKIP (not found): {db_path}')
        continue
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()
    cur.execute('PRAGMA table_info(chat_sessions)')
    existing = {r[1] for r in cur.fetchall()}
    added = []
    if 'service_id' not in existing:
        cur.execute('ALTER TABLE chat_sessions ADD COLUMN service_id TEXT')
        added.append('service_id')
    if 'service_slots' not in existing:
        cur.execute('ALTER TABLE chat_sessions ADD COLUMN service_slots TEXT')
        added.append('service_slots')
    if 'is_favorite' not in existing:
        cur.execute('ALTER TABLE chat_sessions ADD COLUMN is_favorite INTEGER DEFAULT 0')
        added.append('is_favorite')
    if 'language' not in existing:
        cur.execute("ALTER TABLE chat_sessions ADD COLUMN language TEXT DEFAULT 'en'")
        added.append('language')
    conn.commit()
    conn.close()
    msg = str(added) if added else 'none (already present)'
    print('DB: ' + db_path + ' | added: ' + msg)
