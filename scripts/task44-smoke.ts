/**
 * task44-smoke.ts — temporary live smoke test for the university intake.
 * Verifies connectivity, that the applications migration is applied, and
 * round-trips saveUniversityIntake / readUniversityIntake against the real
 * database, then deletes everything it created.
 */
import { sql } from 'drizzle-orm';
import { db } from '../src/lib/db';
import { chatSessions, applications } from '../src/lib/schema';
import { eq } from 'drizzle-orm';
import { saveUniversityIntake, readUniversityIntake } from '../src/lib/university-intake';
import { UNIVERSITY_FIELDS } from '../src/lib/university-fields';

const sessionId = `task44-smoke-${Date.now()}`;
const results: string[] = [];
let failed = false;

function check(name: string, ok: boolean, detail = '') {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed = true;
}

async function main() {
  const one = await db.execute(sql`SELECT 1 AS one`);
  check('db connectivity', Boolean((one as any).rows?.[0]?.one === 1));

  const reg = await db.execute(sql`SELECT to_regclass('public.applications') AS t`);
  const tableExists = (reg as any).rows?.[0]?.t !== null;
  check('applications table exists (migration 0003 applied)', tableExists);
  if (!tableExists) return;

  await db.insert(chatSessions).values({ id: sessionId, title: 'task44 smoke' });

  const partial = await saveUniversityIntake({
    sessionId,
    userId: null,
    answers: {
      firstName: 'Ali',
      lastName: 'Asgar',
      email: 'ali@example.com',
      fieldOfStudy: 'Computer Engineering',
      budgetUsd: '5000',
    },
  });
  check('partial save — status collecting', partial.status === 'collecting', partial.status);
  check(
    'partial save — missing excludes saved fields',
    !partial.missing.some((f) => f.key === 'firstName' || f.key === 'fieldOfStudy'),
  );
  check('partial save — still missing academic fields', partial.missing.length === UNIVERSITY_FIELDS.length - 5);

  const full = await saveUniversityIntake({
    sessionId,
    userId: null,
    answers: {
      dateOfBirth: '2004-05-11',
      nationality: 'Turkmenistan',
      phone: '+99361234567',
      educationHistory: 'Ashgabat High School 12 (2022)',
      grades: 'GPA 3.8 / 4.0',
      languageLevel: 'Turkish A2, English B2',
      preferredCities: 'Istanbul, Ankara',
    },
  });
  check('full save — status ready', full.status === 'ready', full.status);
  check('full save — no missing fields', full.missing.length === 0, `missing=${full.missing.length}`);

  const read = await readUniversityIntake(sessionId);
  check('read back — merged data intact', read?.data.firstName === 'Ali' && read?.data.grades === 'GPA 3.8 / 4.0');
  check('read back — status ready', read?.application.status === 'ready');
  check('read back — no credit consumed yet', read?.application.credit_id == null);

  const wipe = await saveUniversityIntake({
    sessionId,
    userId: null,
    answers: { lastName: '' },
  });
  check('blank answer cannot wipe saved value', wipe.data.lastName === 'Asgar');

  await db.delete(applications).where(eq(applications.session_id, sessionId));
  await db.delete(chatSessions).where(eq(chatSessions.id, sessionId));
  results.push('cleanup — test rows deleted');
}

main()
  .catch((e) => {
    failed = true;
    results.push(`FAIL  unexpected error — ${(e as Error).message}`);
    const cause = (e as any)?.cause;
    if (cause) results.push(`      cause — ${cause?.message ?? JSON.stringify(cause).slice(0, 300)}`);
  })
  .finally(async () => {
    console.log(results.join('\n'));
    process.exit(failed ? 1 : 0);
  });
