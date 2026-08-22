/**
 * reembed-knowledge.mjs
 * Re-embeds every row in knowledge_chunks with DashScope text-embedding-v3.
 *
 * Vectors produced by a different model are not comparable, so this must be run
 * once after switching off Google embeddings — otherwise cosine similarity is
 * meaningless and retrieval silently returns nothing useful.
 *
 * Chunk text is read from the table itself, so no source files are needed.
 * Run: node scripts/reembed-knowledge.mjs
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

const BASE_URL = process.env.QWEN_BASE_URL || 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';
const EMBED_MODEL = process.env.QWEN_EMBED_MODEL || 'text-embedding-v3';
const DIMENSIONS = 768;

async function embedText(text) {
  const res = await fetch(`${BASE_URL}/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.DASHSCOPE_API_KEY}`,
    },
    body: JSON.stringify({
      model: EMBED_MODEL,
      input: text,
      dimensions: DIMENSIONS,
      encoding_format: 'float',
    }),
  });
  if (!res.ok) {
    throw new Error(`Embedding failed (${res.status}): ${await res.text().catch(() => '')}`);
  }
  const data = await res.json();
  return data?.data?.[0]?.embedding ?? [];
}

async function main() {
  if (!process.env.DASHSCOPE_API_KEY) {
    console.error('❌ DASHSCOPE_API_KEY not set in .env.local');
    process.exit(1);
  }

  const rows = await sql`SELECT id, chunk_text FROM knowledge_chunks ORDER BY id`;
  if (!rows.length) {
    console.log('ℹ️  knowledge_chunks is empty — nothing to re-embed. RAG will be skipped at runtime.');
    return;
  }

  console.log(`🔁 Re-embedding ${rows.length} chunks with ${EMBED_MODEL} (${DIMENSIONS}d)...\n`);

  let done = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      const embedding = await embedText(row.chunk_text);
      if (embedding.length !== DIMENSIONS) {
        throw new Error(`expected ${DIMENSIONS} dimensions, got ${embedding.length}`);
      }
      await sql`
        UPDATE knowledge_chunks
        SET embedding = ${JSON.stringify(embedding)}::vector
        WHERE id = ${row.id}
      `;
      done++;
      if (done % 25 === 0) console.log(`  ... ${done}/${rows.length}`);
    } catch (e) {
      failed++;
      console.error(`  ⚠️  chunk ${row.id}: ${e.message}`);
    }
    // Stay under the DashScope request-rate limit
    await new Promise(r => setTimeout(r, 150));
  }

  console.log(`\n✅ Re-embedded ${done} chunks${failed ? `, ${failed} failed` : ''}.`);
}

main().catch(e => { console.error(e); process.exit(1); });
