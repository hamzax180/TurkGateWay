/**
 * apply-migration.mjs
 * Applies one Drizzle-generated migration file, statement by statement.
 *
 * `drizzle-kit push` diffs the schema and can drop columns or tables to make
 * the database match. This runs exactly the SQL in the named migration and
 * nothing else, so what happens is what's in the file. It refuses to run a
 * migration containing DROP unless you pass --allow-drop, since an accidental
 * drop against a live database is not recoverable.
 *
 * Run: node scripts/apply-migration.mjs 0003_add_visa_applications
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

const name = process.argv[2];
const allowDrop = process.argv.includes('--allow-drop');
if (!name) {
  console.error('Usage: node scripts/apply-migration.mjs <migration-name> [--allow-drop]');
  process.exit(1);
}

const file = join(__dir, '..', 'drizzle', 'migrations', `${name.replace(/\.sql$/, '')}.sql`);
if (!existsSync(file)) {
  console.error(`❌ Not found: ${file}`);
  process.exit(1);
}

const raw = readFileSync(file, 'utf8');
const statements = raw
  .split('--> statement-breakpoint')
  .map((s) => s.trim())
  .filter(Boolean);

const drops = statements.filter((s) => /\bDROP\b/i.test(s));
if (drops.length && !allowDrop) {
  console.error(`\n❌ ${name} contains ${drops.length} DROP statement(s). Refusing to run.`);
  drops.forEach((s) => console.error(`   ${s.split('\n')[0]}`));
  console.error('\n   Re-run with --allow-drop if this is genuinely intended.\n');
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

console.log(`\n📦 Applying ${name} — ${statements.length} statement(s)\n`);
let applied = 0;
let skipped = 0;

for (const statement of statements) {
  const label = statement.split('\n')[0].slice(0, 80);
  try {
    await sql.query(statement);
    applied++;
    console.log(`  ✅ ${label}`);
  } catch (e) {
    // Re-running a migration that is already partly applied is normal and
    // should not be treated as a failure.
    if (/already exists/i.test(e.message)) {
      skipped++;
      console.log(`  ⏭️  ${label}  (already exists)`);
    } else {
      console.error(`  ❌ ${label}\n     ${e.message}`);
      process.exit(1);
    }
  }
}

console.log(`\n✅ Done — ${applied} applied, ${skipped} already present.\n`);
