/**
 * seed-knowledge.mjs
 * Seeds knowledge_chunks from response JSON files using Google embeddings.
 * Run: node scripts/seed-knowledge.mjs
 */
import { readFileSync, existsSync } from 'fs';
import { neon } from '@neondatabase/serverless';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..');
const envPath = join(ROOT, '.env.local');
if (existsSync(envPath)) {
  readFileSync(envPath, 'utf8').split('\n').forEach((line) => {
    const [key, ...rest] = line.split('=');
    if (key && rest.length) process.env[key.trim()] = rest.join('=').trim();
  });
}

const sql = neon(process.env.DATABASE_URL);
const EMBED_MODEL = 'models/text-embedding-004';

async function embedText(text) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/${EMBED_MODEL}:embedContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: EMBED_MODEL,
        content: { parts: [{ text }] },
        taskType: 'RETRIEVAL_DOCUMENT',
      }),
    }
  );
  const data = await res.json();
  return data?.embedding?.values ?? [];
}

function loadJSON(relPath) {
  const abs = join(ROOT, relPath);
  if (!existsSync(abs)) return null;
  const raw = readFileSync(abs, 'utf8').replace(/^\uFEFF/, '');
  return JSON.parse(raw);
}

const FILES = [
  { path: 'src/lib/responses/general.json',  agentType: 'general' },
  { path: 'src/lib/responses/permit.json',   agentType: 'permit' },
  { path: 'src/lib/responses/lawyer.json',   agentType: 'lawyer' },
  { path: 'src/lib/responses/student.json',  agentType: 'student' },
  { path: 'backend/agents/permit/responses.json',  agentType: 'permit' },
  { path: 'backend/agents/lawyer/responses.json',  agentType: 'lawyer' },
  { path: 'backend/agents/student/responses.json', agentType: 'student' },
];

async function main() {
  console.log('🌱 Seeding knowledge chunks with embeddings...\n');

  if (!process.env.GEMINI_API_KEY) {
    console.error('❌ GEMINI_API_KEY not set in .env.local');
    process.exit(1);
  }

  let totalChunks = 0;

  for (const { path, agentType } of FILES) {
    const data = loadJSON(path);
    if (!data) { console.log(`  ⚠️  Skipped: ${path}`); continue; }

    process.stdout.write(`  📂  ${path} ... `);
    let fileChunks = 0;

    for (const [intent, responses] of Object.entries(data)) {
      if (!Array.isArray(responses)) continue;

      for (const responseText of responses) {
        if (typeof responseText !== 'string' || responseText.length < 20) continue;

        // Check if already seeded
        const [existing] = await sql`
          SELECT id FROM knowledge_chunks kc
          JOIN knowledge_articles ka ON kc.article_id = ka.id
          WHERE ka.agent_type = ${agentType} AND ka.title = ${intent}
          AND kc.chunk_text = ${responseText.slice(0, 200)}
          LIMIT 1
        `;
        if (existing) continue;

        // Create or get article
        const [article] = await sql`
          INSERT INTO knowledge_articles (title, category, agent_type, tags)
          VALUES (${intent}, ${agentType}, ${agentType}, ${intent})
          ON CONFLICT DO NOTHING
          RETURNING id
        `;
        const articleId = article?.id ?? (
          await sql`SELECT id FROM knowledge_articles WHERE title = ${intent} AND agent_type = ${agentType} LIMIT 1`
        )[0]?.id;
        if (!articleId) continue;

        // Embed and store
        const embedding = await embedText(responseText);
        if (!embedding.length) continue;

        await sql`
          INSERT INTO knowledge_chunks (article_id, chunk_text, embedding)
          VALUES (${articleId}, ${responseText}, ${JSON.stringify(embedding)}::vector)
        `;
        fileChunks++;
        totalChunks++;

        // Rate limit: avoid hitting API quota
        await new Promise(r => setTimeout(r, 200));
      }
    }

    console.log(`✅ ${fileChunks} chunks`);
  }

  console.log(`\n✅ Done. Total chunks embedded: ${totalChunks}`);
}

main().catch(e => { console.error(e); process.exit(1); });
