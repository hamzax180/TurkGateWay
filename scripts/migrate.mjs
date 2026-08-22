/**
 * migrate.mjs
 * Applies pending SQL migrations to whichever database DATABASE_URL points at.
 *
 * This exists because nothing did. The repo had `drizzle-kit push`, which
 * diffs the schema and rewrites the database to match — fine for a scratch
 * database, wrong for one holding real applications. Nothing tracked which
 * migrations had actually run, and the result was a database missing five
 * tables (`applications`, `application_documents`, `credit_ledger`,
 * `university_partners`, `application_submissions`) while the app happily
 * built and deployed on top of them.
 *
 * What this does instead:
 *   - runs the .sql files in drizzle/migrations in filename order
 *   - records each one in `_migrations`, so a second run is a no-op
 *   - stops at the first genuine failure rather than limping onward
 *   - treats "already exists" as success, so a database that was patched by
 *     hand converges instead of jamming
 *
 * Usage:
 *   node scripts/migrate.mjs              apply pending migrations
 *   node scripts/migrate.mjs --dry-run    list what would run, change nothing
 *   node scripts/migrate.mjs --status     show applied vs pending
 *
 * Point it at production by setting DATABASE_URL for the command:
 *   DATABASE_URL="postgres://…" node scripts/migrate.mjs --status
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { neon } from '@neondatabase/serverless';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..');
const MIGRATIONS_DIR = join(ROOT, 'drizzle', 'migrations');

// Only load .env.local when DATABASE_URL was not supplied — otherwise pointing
// this at production would silently be overridden by the local file.
if (!process.env.DATABASE_URL) {
  const envPath = join(ROOT, '.env.local');
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const [key, ...rest] = line.split('=');
      if (key && rest.length) process.env[key.trim()] = rest.join('=').trim();
    }
  }
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is not set. Pass it inline or put it in .env.local.');
  process.exit(1);
}

const dryRun = process.argv.includes('--dry-run');
const statusOnly = process.argv.includes('--status');

/**
 * --skip <substring>  leave a migration unapplied and unrecorded.
 *
 * Needed because 0001 drops two tables outright, and on a database where it
 * never ran those tables still hold data. A migration that destroys rows is
 * the operator's decision, not something a runner should take on the way past.
 */
const skips = process.argv.reduce((acc, arg, i) => {
  if (arg === '--skip' && process.argv[i + 1]) acc.push(process.argv[i + 1]);
  return acc;
}, []);
const isSkipped = (name) => skips.some((s) => name.includes(s));

/**
 * --mark <substring>  record a migration as applied WITHOUT running it.
 *
 * For a database that was already brought to that state by hand. Re-running
 * such a migration can fail on a step whose input no longer exists — 0004
 * backfills from a column it then drops, so on an already-migrated database
 * the backfill errors even though the end state is correct.
 *
 * Verify the schema really is in the finished state before using this; it is
 * a claim that the work is done, and nothing checks that claim.
 */
const marks = process.argv.reduce((acc, arg, i) => {
  if (arg === '--mark' && process.argv[i + 1]) acc.push(process.argv[i + 1]);
  return acc;
}, []);
const isMarked = (name) => marks.some((m) => name.includes(m));
const sql = neon(DATABASE_URL);

/** Which database is this? Printed so nobody migrates the wrong one by accident. */
function describeTarget(url) {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}`;
  } catch {
    return '(unparseable DATABASE_URL)';
  }
}

/** Postgres codes meaning "this object is already there". */
const ALREADY_EXISTS = new Set([
  '42P07', // duplicate_table
  '42710', // duplicate_object (constraint, index)
  '42701', // duplicate_column
  '42P16', // invalid_table_definition — re-adding a primary key
  '42723', // duplicate_function
]);

async function ensureLedger() {
  await sql`
    CREATE TABLE IF NOT EXISTS _migrations (
      name        text PRIMARY KEY,
      applied_at  timestamptz NOT NULL DEFAULT now()
    )
  `;
}

async function appliedSet() {
  const rows = await sql`SELECT name FROM _migrations`;
  return new Set(rows.map((r) => r.name));
}

function migrationFiles() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort(); // 0000_, 0001_, … filename order is the intended order
}

async function applyOne(name) {
  const body = readFileSync(join(MIGRATIONS_DIR, name), 'utf8');
  // drizzle separates statements with this marker; a plain split on ';' would
  // break every function body and DO $$ … $$ block in the file.
  const statements = body
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter(Boolean);

  let applied = 0;
  let skipped = 0;

  for (const statement of statements) {
    try {
      await sql.query(statement);
      applied += 1;
    } catch (err) {
      if (ALREADY_EXISTS.has(err.code)) {
        skipped += 1;
        continue;
      }
      throw new Error(
        `${name}: ${err.message}\n  in statement: ${statement.slice(0, 120).replace(/\s+/g, ' ')}…`,
      );
    }
  }

  await sql`INSERT INTO _migrations (name) VALUES (${name}) ON CONFLICT (name) DO NOTHING`;
  return { applied, skipped, total: statements.length };
}

// ── main ────────────────────────────────────────────────────────────────────
console.log(`database : ${describeTarget(DATABASE_URL)}`);
await ensureLedger();

const done = await appliedSet();
const files = migrationFiles();
const pending = files.filter((f) => !done.has(f) && !isSkipped(f));
const skippedPending = files.filter((f) => !done.has(f) && isSkipped(f));

if (statusOnly) {
  console.log('\nmigrations:');
  for (const f of files) console.log(`  ${done.has(f) ? 'applied ' : 'PENDING '} ${f}`);
  console.log(`\n${done.size} applied, ${pending.length} pending`);
  process.exit(0);
}

if (pending.length === 0) {
  console.log(
    skippedPending.length
      ? `\nNothing to apply. ${skippedPending.length} skipped and still pending.`
      : `\nUp to date — all ${files.length} migrations applied.`,
  );
  process.exit(0);
}

console.log(`\n${pending.length} pending:`);
for (const f of pending) console.log(`  ${f}`);
if (skippedPending.length) {
  console.log(`\nskipped by --skip (still pending, NOT recorded as applied):`);
  for (const f of skippedPending) console.log(`  ${f}`);
}

if (dryRun) {
  console.log('\n--dry-run: nothing was changed.');
  process.exit(0);
}

console.log('');
for (const name of pending) {
  if (isMarked(name)) {
    await sql`INSERT INTO _migrations (name) VALUES (${name}) ON CONFLICT (name) DO NOTHING`;
    console.log(`  MARK ${name}  (recorded as applied, not executed)`);
    continue;
  }
  try {
    const { applied, skipped, total } = await applyOne(name);
    const note = skipped ? `${applied} applied, ${skipped} already present` : `${applied}/${total}`;
    console.log(`  OK   ${name}  (${note})`);
  } catch (err) {
    console.error(`  FAIL ${name}`);
    console.error(`       ${err.message}`);
    console.error('\nStopped. Nothing after this point was applied.');
    process.exit(1);
  }
}

console.log('\nDone.');
