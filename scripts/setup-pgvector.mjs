/**
 * setup-pgvector.mjs
 * Enables pgvector extension and creates knowledge tables in Neon.
 * Run: node scripts/setup-pgvector.mjs
 */
import { readFileSync, existsSync } from 'fs';
import { neon } from '@neondatabase/serverless';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dir, '..', '.env.local');
if (existsSync(envPath)) {
  readFileSync(envPath, 'utf8').split('\n').forEach((line) => {
    const [key, ...rest] = line.split('=');
    if (key && rest.length) process.env[key.trim()] = rest.join('=').trim();
  });
}

const sql = neon(process.env.DATABASE_URL);

async function main() {
  console.log('🔧 Setting up pgvector...');

  // Enable pgvector
  await sql`CREATE EXTENSION IF NOT EXISTS vector`;
  console.log('✅ pgvector extension enabled');

  // Create tables
  await sql`
    CREATE TABLE IF NOT EXISTS knowledge_articles (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      category VARCHAR(50),
      agent_type VARCHAR(20) NOT NULL,
      tags TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `;
  console.log('✅ knowledge_articles table created');

  await sql`
    CREATE TABLE IF NOT EXISTS knowledge_chunks (
      id SERIAL PRIMARY KEY,
      article_id INTEGER REFERENCES knowledge_articles(id) ON DELETE CASCADE,
      chunk_text TEXT NOT NULL,
      embedding vector(768),
      created_at TIMESTAMP DEFAULT NOW()
    )
  `;
  console.log('✅ knowledge_chunks table created');

  // Create vector index for fast similarity search
  await sql`
    CREATE INDEX IF NOT EXISTS knowledge_chunks_embedding_idx
    ON knowledge_chunks USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100)
  `;
  console.log('✅ Vector index created');

  console.log('\n🎉 pgvector setup complete!');
  console.log('   If knowledge_chunks already holds rows embedded with another model,');
  console.log('   re-embed them with: node scripts/reembed-knowledge.mjs');
}

main().catch(e => { console.error(e); process.exit(1); });
