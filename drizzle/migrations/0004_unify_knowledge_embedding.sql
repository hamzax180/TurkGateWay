-- The pgvector extension must exist before any vector column is touched.
CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
-- The legacy SQLAlchemy schema (and rag.ts, and scripts/reembed-knowledge.mjs)
-- use a native vector(768) column. Migration 0000's text-JSON embedding_json
-- was never read by anything. ADD IF NOT EXISTS keeps this migration safe on
-- databases that already carry the vector column from the legacy create_all.
ALTER TABLE "knowledge_chunks" ADD COLUMN IF NOT EXISTS "embedding" vector(768);
--> statement-breakpoint
-- Backfill from the JSON text column where present; JSON.stringify output is
-- a valid vector literal ([0.1,0.2,...]), which pgvector parses directly.
UPDATE "knowledge_chunks"
SET "embedding" = "embedding_json"::vector
WHERE "embedding" IS NULL AND "embedding_json" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "knowledge_chunks" DROP COLUMN IF EXISTS "embedding_json";
--> statement-breakpoint
-- Same index setup-pgvector.mjs creates, so either path converges here.
CREATE INDEX IF NOT EXISTS "knowledge_chunks_embedding_idx"
ON "knowledge_chunks" USING ivfflat ("embedding" vector_cosine_ops)
WITH (lists = 100);
