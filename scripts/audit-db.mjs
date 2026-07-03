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

const counts = await sql`SELECT assistant_type, COUNT(*) as cnt FROM learning_responses GROUP BY assistant_type ORDER BY cnt DESC`;
console.log('=== ROWS BY AGENT TYPE ===');
counts.forEach(r => console.log(`  ${r.assistant_type}: ${r.cnt} rows`));

const apostille = await sql`SELECT id, assistant_type, intent, query, LEFT(response, 100) as preview FROM learning_responses WHERE response ILIKE '%apostille%' LIMIT 10`;
console.log('\n=== APOSTILLE RESPONSES ===');
apostille.forEach(r => console.log(JSON.stringify(r)));

// Check for any student responses tagged as other types
const wrongTag = await sql`SELECT assistant_type, intent, LEFT(response, 80) as preview FROM learning_responses WHERE (response ILIKE '%apostille%' OR response ILIKE '%denklik%' OR response ILIKE '%ikamet%') AND assistant_type != 'student' LIMIT 20`;
console.log('\n=== STUDENT CONTENT IN WRONG AGENT ===');
wrongTag.forEach(r => console.log(JSON.stringify(r)));
