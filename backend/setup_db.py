"""
setup_db.py — Complete database setup for RAG knowledge base.
Steps:
  1. Enable pgvector extension
  2. Create knowledge tables
  3. Verify setup
"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))

from database import engine, Base
from sqlalchemy import text

# Import models so they register with Base.metadata
from models.knowledge_base import KnowledgeArticle, KnowledgeChunk, AgentContext

def setup():
    print("=" * 60)
    print("[Setup] Starting database setup...")
    print("=" * 60)
    
    # Step 1: Enable pgvector
    print("\n[Step 1] Enabling pgvector extension...")
    try:
        with engine.connect() as conn:
            conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
            conn.commit()
        print("[Step 1] SUCCESS: pgvector extension enabled.")
    except Exception as e:
        print(f"[Step 1] FAIL: Failed to enable pgvector: {e}")
        return False

    # Step 2: Create tables
    print("\n[Step 2] Creating knowledge tables...")
    try:
        # Drop and recreate to avoid stale schema issues
        Base.metadata.create_all(bind=engine)
        print("[Step 2] SUCCESS: Knowledge tables created.")
    except Exception as e:
        print(f"[Step 2] FAIL: Failed to create tables: {e}")
        return False

    # Step 3: Verify
    print("\n[Step 3] Verifying setup...")
    with engine.connect() as conn:
        # Check extension
        r = conn.execute(text("SELECT extname FROM pg_extension WHERE extname = 'vector'"))
        if r.fetchone():
            print("  SUCCESS: pgvector extension: installed")
        else:
            print("  FAIL: pgvector extension: NOT found")
            return False

        # Check tables
        r = conn.execute(text("""
            SELECT table_name FROM information_schema.tables 
            WHERE table_schema='public' ORDER BY table_name
        """))
        tables = [row[0] for row in r.fetchall()]
        print(f"  SUCCESS: Tables: {tables}")

        for t in ['knowledge_articles', 'knowledge_chunks', 'agent_context']:
            if t in tables:
                count = conn.execute(text(f"SELECT COUNT(*) FROM {t}")).scalar()
                print(f"    -> {t}: {count} rows")
            else:
                print(f"    FAIL: {t}: MISSING")
                return False

    print("\n" + "=" * 60)
    print("[Setup] SUCCESS: Database setup COMPLETE!")
    print("[Setup] Next step: run 'python seed_knowledge.py' to populate data.")
    print("=" * 60)
    return True


if __name__ == "__main__":
    success = setup()
    sys.exit(0 if success else 1)
