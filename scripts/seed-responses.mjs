/**
 * seed-responses.mjs
 * Seeds ALL response JSON files (src/lib/responses + backend/agents)
 * into the Neon PostgreSQL `learning_responses` table.
 *
 * Run: node scripts/seed-responses.mjs
 */

import { readFileSync, existsSync } from 'fs';
import { neon } from '@neondatabase/serverless';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Manually load .env.local (no dotenv dependency needed)
const __dir0 = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dir0, '..', '.env.local');
if (existsSync(envPath)) {
  readFileSync(envPath, 'utf8').split('\n').forEach((line) => {
    const [key, ...rest] = line.split('=');
    if (key && rest.length) process.env[key.trim()] = rest.join('=').trim();
  });
}

const sql = neon(process.env.DATABASE_URL);
const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..');

// ── Helpers ────────────────────────────────────────────────────────────────

function loadJSON(relPath) {
  const abs = join(ROOT, relPath);
  if (!existsSync(abs)) {
    console.warn(`  ⚠️  Skipped (not found): ${relPath}`);
    return null;
  }
  try {
    // Strip UTF-8 BOM (\uFEFF) if present before parsing
    const raw = readFileSync(abs, 'utf8').replace(/^\uFEFF/, '');
    return JSON.parse(raw);
  } catch (e) {
    console.warn(`  ⚠️  Parse error in ${relPath}: ${e.message}`);
    return null;
  }
}

/**
 * Flatten a JSON object (intent → string[]) into rows.
 * Handles nested billing/support objects as well.
 */
function flattenResponses(data, assistantType, language) {
  const rows = [];

  function processIntent(intent, value) {
    if (Array.isArray(value)) {
      // Each array item = one row; intent is the query key
      value.forEach((response) => {
        if (typeof response === 'string' && response.trim()) {
          rows.push({ intent, assistantType, language, query: intent, response: response.trim() });
        }
      });
    } else if (typeof value === 'object' && value !== null) {
      // Nested object (e.g. billing.price, support.error)
      Object.entries(value).forEach(([subKey, subVal]) => {
        processIntent(`${intent}_${subKey}`, subVal);
      });
    }
  }

  Object.entries(data).forEach(([intent, value]) => processIntent(intent, value));
  return rows;
}

// ── File definitions ───────────────────────────────────────────────────────

const FILES = [
  // ── Next.js lib responses (primary, EN) ─────────────────────────────────
  { path: 'src/lib/responses/general.json',  assistantType: 'general',  language: 'en' },
  { path: 'src/lib/responses/permit.json',   assistantType: 'permit',   language: 'en' },
  { path: 'src/lib/responses/lawyer.json',   assistantType: 'lawyer',   language: 'en' },
  { path: 'src/lib/responses/student.json',  assistantType: 'student',  language: 'en' },

  // ── Backend agent responses (EN) ─────────────────────────────────────────
  { path: 'backend/agents/general/responses.json',  assistantType: 'general',  language: 'en' },
  { path: 'backend/agents/permit/responses.json',   assistantType: 'permit',   language: 'en' },
  { path: 'backend/agents/lawyer/responses.json',   assistantType: 'lawyer',   language: 'en' },
  { path: 'backend/agents/student/responses.json',  assistantType: 'student',  language: 'en' },
  { path: 'backend/agents/student/learned/en.json', assistantType: 'student',  language: 'en' },

  // ── Backend agent responses (AR) ─────────────────────────────────────────
  { path: 'backend/agents/general/responses_ar.json',  assistantType: 'general',  language: 'ar' },
  { path: 'backend/agents/permit/responses_ar.json',   assistantType: 'permit',   language: 'ar' },
  { path: 'backend/agents/lawyer/responses_ar.json',   assistantType: 'lawyer',   language: 'ar' },
  { path: 'backend/agents/student/responses_ar.json',  assistantType: 'student',  language: 'ar' },

  // ── Backend agent responses (TR) ─────────────────────────────────────────
  { path: 'backend/agents/general/responses_tr.json',  assistantType: 'general',  language: 'tr' },
  { path: 'backend/agents/permit/responses_tr.json',   assistantType: 'permit',   language: 'tr' },
  { path: 'backend/agents/lawyer/responses_tr.json',   assistantType: 'lawyer',   language: 'tr' },
  { path: 'backend/agents/student/responses_tr.json',  assistantType: 'student',  language: 'tr' },
];

// ── Insert logic ───────────────────────────────────────────────────────────

async function insertRows(rows) {
  const BATCH = 50;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    // Build a single multi-row INSERT, skip duplicates (ON CONFLICT DO NOTHING)
    const values = batch.map(
      (r, idx) =>
        `($${idx * 5 + 1}, $${idx * 5 + 2}, $${idx * 5 + 3}, $${idx * 5 + 4}, $${idx * 5 + 5})`
    );
    const params = batch.flatMap((r) => [r.query, r.response, r.assistantType, r.intent, r.language]);

    // Use sql.query() for conventional parameterized queries (Neon serverless v1+)
    await sql.query(
      `INSERT INTO learning_responses (query, response, assistant_type, intent, language)
       VALUES ${values.join(', ')}
       ON CONFLICT DO NOTHING`,
      params
    );
    inserted += batch.length;
  }
  return inserted;
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log('🌱  Seeding Neon DB — learning_responses table\n');

  let totalRows = 0;

  for (const { path, assistantType, language } of FILES) {
    process.stdout.write(`  📂  ${path} (${assistantType}/${language}) … `);
    const data = loadJSON(path);
    if (!data) continue;

    const rows = flattenResponses(data, assistantType, language);
    if (rows.length === 0) {
      console.log('0 rows (empty)');
      continue;
    }

    try {
      const n = await insertRows(rows);
      console.log(`✅  ${n} rows`);
      totalRows += n;
    } catch (err) {
      console.log(`❌  DB error: ${err.message}`);
    }
  }

  console.log(`\n✅  Done. Total rows inserted: ${totalRows}`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
