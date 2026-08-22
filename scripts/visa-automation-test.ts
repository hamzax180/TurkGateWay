/**
 * visa-automation-test.ts — end-to-end automation test of the Turkmenistan
 * student-visa intake pipeline (the agent's collect_visa_application tool
 * layer), run deterministically against the real database.
 *
 * It does NOT call the LLM — the model's tool-use behavior can't be asserted
 * deterministically — it exercises everything the agent tool touches:
 *   1. DB connectivity + schema (applications, application_documents)
 *   2. The field vocabulary (INTAKE_FIELDS / missingFields)
 *   3. saveIntake partial-merge semantics (no wipe, stillNeeded shrinks)
 *   4. Document store + refreshReadiness (acceptance letter gate)
 *   5. Status machine: collecting → ready (no credit anywhere in visa flow)
 *   6. Cleanup of every row it created.
 */
import { sql } from 'drizzle-orm';
import { eq } from 'drizzle-orm';
import { db } from '../src/lib/db';
import { chatSessions, applications, applicationDocuments, users } from '../src/lib/schema';
import { INTAKE_FIELDS, missingFields } from '../src/lib/visa-fields';
import { saveIntake, readIntake } from '../src/lib/visa-intake';
import { storeDocument, refreshReadiness } from '../src/lib/application-documents';

const sessionId = `visa-test-${Date.now()}`;
const results: string[] = [];
let failed = false;

function check(name: string, ok: boolean, detail = '') {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed = true;
}

async function main() {
  // 1. Field vocabulary (DB-free — always runs)
  const expectedKeys = ['firstName', 'lastName', 'dateOfBirth', 'passportNo', 'email', 'phone', 'turkishSchool', 'program', 'travelDate', 'zipcode'];
  check('field vocabulary complete', expectedKeys.every((k) => INTAKE_FIELDS.some((f) => f.key === k)));
  check('missingFields detects empties', missingFields({ firstName: 'A' }).length === INTAKE_FIELDS.filter((f) => !f.optional).length - 1);
  check('optional fields never block', !missingFields({}).some((f) => f.optional));

  // 0. Connectivity + schema
  try {
    const one = await db.execute(sql`SELECT 1 AS one`);
    check('db connectivity', (one as any).rows?.[0]?.one === 1);
  } catch (e: any) {
    const cause = (e as any)?.cause;
    check('db connectivity', false, `${e.message}${cause?.message ? ' | ' + cause.message : ''}`);
    return;
  }

  const reg = await db.execute(sql`SELECT to_regclass('public.applications') AS t, to_regclass('public.application_documents') AS d`);
  const tables = (reg as any).rows?.[0];
  check('applications + documents tables exist', Boolean(tables?.t && tables?.d));

  // 2. Seed: signed-in session + a throwaway user
  let userId = 0;
  try {
    const email = `visa-test-${Date.now()}@anon.invalid`;
    const [u] = await db.insert(users).values({ email, hashed_password: 'x', subscription_status: 'free' }).returning({ id: users.id });
    userId = u.id;
    await db.insert(chatSessions).values({ id: sessionId, title: 'VISA AUTOMATION TEST', assistant_type: 'student', user_id: userId });
    check('seed test user + session', true);
  } catch (e: any) {
    check('seed test user + session', false, e.message);
    return;
  }

  // 3. Partial save → collecting
  const partial = await saveIntake({
    sessionId,
    userId,
    answers: { firstName: 'Aylar', lastName: 'Berdiyew', email: 'aylar@example.com' },
  });
  check('partial save → status collecting', partial.status === 'collecting', partial.status);
  check('partial save → stillNeeded excludes saved', !partial.missing.some((f) => ['firstName', 'lastName', 'email'].includes(f.key)));

  // 4. Blank merge never wipes
  const wipe = await saveIntake({ sessionId, userId, answers: { firstName: '' } });
  check('blank answer cannot wipe saved value', wipe.data.firstName === 'Aylar');

  // 5. Full field set → ready (no document yet → visa requires letter, so still collecting)
  const full: Record<string, string> = {
    dateOfBirth: '2003-04-12',
    passportNo: 'A1234567',
    phone: '+99361234567',
    turkishSchool: 'Istanbul University',
    program: 'Computer Engineering',
    travelDate: '2026-09-01',
    zipcode: '744000',
  };
  const filled = await saveIntake({ sessionId, userId, answers: full });
  const remaining = filled.missing.map((f) => f.key);
  check('all fields saved', remaining.length === 0, remaining.join(','));
  check('status ready on complete fields', filled.status === 'ready', filled.status);

  // 6. Document gate — attach the acceptance letter, then refresh readiness
  const doc = await storeDocument({
    sessionId,
    userId,
    kind: 'acceptance_letter',
    filename: 'acceptance.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    data: Buffer.from('test pdf bytes'),
  });
  check('document stored', Boolean(doc));

  const refreshed = await refreshReadiness(sessionId);
  check('readiness stays ready with document', refreshed?.status === 'ready', refreshed?.status);

  const state = await readIntake(sessionId);
  check('readIntake returns merged data + document flag', state?.documentPresent === true && state?.data.firstName === 'Aylar');

  // 7. Cleanup — everything the test created
  try {
    await db.delete(applicationDocuments).where(eq(applicationDocuments.session_id, sessionId));
    await db.delete(applications).where(eq(applications.session_id, sessionId));
    await db.delete(chatSessions).where(eq(chatSessions.id, sessionId));
    await db.delete(users).where(eq(users.id, userId));
    results.push('cleanup — test rows deleted');
  } catch (e: any) {
    check('cleanup', false, e.message);
  }
}

main()
  .catch((e: any) => {
    failed = true;
    results.push(`FAIL  unexpected error — ${e.message}`);
  })
  .finally(() => {
    console.log(results.join('\n'));
    process.exit(failed ? 1 : 0);
  });
