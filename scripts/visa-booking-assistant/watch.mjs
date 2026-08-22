/**
 * watch.mjs
 * Booking watcher — the operator-side half of the chat intake flow.
 *
 * A client fills in their details and uploads their acceptance letter in the
 * web chat. The chat runs serverless and cannot drive a browser, so this
 * process does it: it polls your own API, and the moment an application is
 * complete it opens a real browser, finds the earliest appointment date, and
 * fills the whole form from that client's answers.
 *
 * What it still refuses to do, exactly as find-slot.mjs does:
 *   - Never clicks Next, Continue, or Apply, on any page.
 *   - Never ticks the "I confirm that all the information provided is
 *     correct" checkbox. That is the applicant asserting their information is
 *     true, and it is not this script's to assert.
 *   - Never touches or forges the site's Altcha widget; it only reports state.
 *
 * The polling here is against YOUR OWN API, not Mosaic's. It does not contact
 * the visa site at all until a real client has completed an intake and an
 * operator is sitting in front of the browser.
 *
 * Run: npm run visa:watch
 */
import { chromium } from 'playwright';
import { readFileSync, existsSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { tmpdir } from 'os';
import { printChecklist } from './checklist.mjs';
import { installCursor, restCursor } from './cursor-overlay.mjs';
import {
  findEarliestOpenDate,
  clickDate,
  fillCurrentPage,
  readAltchaState,
  readEmptyFields,
  BASE,
  CALENDAR_ID,
  MAX_MONTHS_AHEAD,
  POLL_INTERVAL_MS,
} from './find-slot.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dir, '..', '..', '.env.local');
if (existsSync(envPath)) {
  readFileSync(envPath, 'utf8').split('\n').forEach((line) => {
    const [key, ...rest] = line.split('=');
    if (key && rest.length) process.env[key.trim()] = rest.join('=').trim();
  });
}

const API_BASE = (process.env.VISA_WATCH_API_BASE || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '');
const API_TOKEN = process.env.VISA_WATCH_TOKEN;
const CHECK_EVERY_MS = Number(process.env.VISA_WATCH_INTERVAL_MS || 15000);

if (!API_TOKEN) {
  console.error(
    '\n❌ VISA_WATCH_TOKEN is not set.\n' +
      '   The watcher reads applications through an admin-only endpoint, so it\n' +
      '   needs an admin auth token. Add VISA_WATCH_TOKEN to .env.local.\n',
  );
  process.exit(1);
}

const authHeaders = { Authorization: `Bearer ${API_TOKEN}` };

async function claimNextApplication() {
  const res = await fetch(`${API_BASE}/api/visa-application/next`, { headers: authHeaders });
  if (res.status === 401 || res.status === 403) {
    throw new Error(
      `API rejected the watcher token (${res.status}). VISA_WATCH_TOKEN must belong to an admin account.`,
    );
  }
  if (!res.ok) throw new Error(`API returned ${res.status}`);
  const body = await res.json();
  return body.application ?? null;
}

/** Hand an application back to the queue when we stop without booking it. */
async function releaseApplication(id) {
  await fetch(`${API_BASE}/api/visa-application/next`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  }).catch(() => {});
}

/** Delete the application and its document once the appointment is booked. */
async function purgeApplication(sessionId) {
  const res = await fetch(`${API_BASE}/api/visa-application/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
    headers: authHeaders,
  }).catch(() => null);
  return Boolean(res && res.ok);
}

/**
 * Write the acceptance letter somewhere the browser can attach it. The
 * filename came from a client upload, so it is rebuilt from scratch here
 * rather than trusted — the server sanitises it too, but this process writes
 * to a real filesystem and should not depend on that.
 */
function writeDocument(doc, workDir) {
  if (!doc) return '';
  const ext = doc.mimeType === 'application/pdf' ? '.pdf' : doc.mimeType === 'image/png' ? '.png' : '.jpg';
  const target = join(workDir, `acceptance-letter${ext}`);
  writeFileSync(target, Buffer.from(doc.base64, 'base64'));
  return target;
}

async function handleApplication(app) {
  const workDir = join(tmpdir(), `visa-booking-${app.id}`);
  mkdirSync(workDir, { recursive: true });

  const applicant = { ...app.applicant };
  const docPath = writeDocument(app.document, workDir);
  if (docPath) applicant.mainSupportingDocumentPath = docPath;

  const who = [applicant.firstName, applicant.lastName].filter(Boolean).join(' ') || `application #${app.id}`;
  console.log(`\n📨 New application ready: ${who}`);
  if (!docPath) console.log('   ⚠️  No supporting document attached — you will need to add it by hand.');

  printChecklist();

  console.log('🔍 Scanning for the earliest open appointment date (live, not cached)...\n');
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  await installCursor(page);

  let booked = false;
  try {
    const found = await findEarliestOpenDate(page);
    if (!found) {
      console.log(`\n❌ No day with open capacity in the next ${MAX_MONTHS_AHEAD} months.`);
      return { booked: false };
    }
    console.log(`\n✅ Earliest date with open capacity: ${found.dateText} (${found.remaining} slots left)\n`);

    await page.goto(`${BASE}/calendar/${CALENDAR_ID}?month=${found.monthParam}`, { waitUntil: 'domcontentloaded' });
    const clicked = await clickDate(page, found.iso, found.dateText);
    console.log(
      clicked
        ? '✅ Date selected. The applicant form should now be open.'
        : `⚠️  Could not click "${found.dateText}" automatically — please click it yourself.`,
    );

    console.log(`\n👀 Filling ${who}'s details. I will NEVER click Next / Continue / Apply.`);
    console.log('   Review each page and click through yourself. Close the window when done.\n');

    const filledSoFar = new Set();
    let lastSignature = '';
    let lastAltchaStatus = 'absent';
    let reportPending = false;

    while (!page.isClosed()) {
      try {
        for (const f of await fillCurrentPage(page, applicant)) {
          if (!filledSoFar.has(f)) {
            filledSoFar.add(f);
            console.log(`  ✏️  Filled: ${f}`);
          }
        }

        const altcha = await readAltchaState(page);
        const status = altcha.present ? (altcha.solved ? 'solved' : 'solving') : 'absent';
        if (status !== lastAltchaStatus) {
          lastAltchaStatus = status;
          if (status === 'solving') {
            console.log('  🧩 Altcha proof-of-work is solving — wait before clicking Next Step.');
          } else if (status === 'solved') {
            console.log('  🧩 Altcha solved ✓ — it is safe to click Next Step now.');
          }
        }

        const signature = await page.evaluate(
          () => document.title + '|' + location.href + '|' + document.body.innerText.length,
        );
        if (signature !== lastSignature) {
          lastSignature = signature;
          reportPending = true;
        } else if (reportPending) {
          reportPending = false;
          await restCursor(page);
          const empty = await readEmptyFields(page);
          if (empty.length) console.log(`  ⚠️  Still empty (fill these yourself): ${empty.join(', ')}`);
          console.log('  ⏸  Page ready for review — click Next / Apply yourself when ready.');
          console.log('     (The confirmation checkbox is yours to tick — this script never will.)');
        }
      } catch {
        // Mid-navigation or briefly detached — retry next tick.
      }
      if (page.isClosed()) break;
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }

    booked = await askBooked(who);
  } finally {
    await browser.close().catch(() => {});
    // The letter is real applicant paperwork — do not leave it on disk.
    rmSync(workDir, { recursive: true, force: true });
  }

  return { booked };
}

/**
 * After the window closes, ask whether the appointment was actually booked.
 * Deleting on window-close alone would throw away a client's details any time
 * the operator closed the browser to retry, so this asks rather than assumes.
 */
function askBooked(who) {
  return new Promise((resolve) => {
    process.stdout.write(`\n❓ Did you complete the booking for ${who}? [y/N] `);
    const onData = (chunk) => {
      process.stdin.pause();
      process.stdin.off('data', onData);
      resolve(/^y/i.test(String(chunk).trim()));
    };
    process.stdin.resume();
    process.stdin.once('data', onData);
  });
}

async function main() {
  console.log('\n🛎️  Visa booking watcher');
  console.log(`   API:      ${API_BASE}`);
  console.log(`   Checking: every ${Math.round(CHECK_EVERY_MS / 1000)}s`);
  console.log('   Waiting for a client to finish their application in chat.');
  console.log('   Nothing on the visa site is contacted until one is ready.\n');

  let idleLogged = false;

  for (;;) {
    let app = null;
    try {
      app = await claimNextApplication();
    } catch (e) {
      console.error(`  ⚠️  ${e.message}`);
      await new Promise((r) => setTimeout(r, CHECK_EVERY_MS));
      continue;
    }

    if (!app) {
      if (!idleLogged) {
        console.log('  … no applications ready yet.');
        idleLogged = true;
      }
      await new Promise((r) => setTimeout(r, CHECK_EVERY_MS));
      continue;
    }

    idleLogged = false;
    let booked = false;
    try {
      ({ booked } = await handleApplication(app));
    } catch (e) {
      console.error(`  ❌ ${e.message}`);
    }

    if (booked) {
      const purged = await purgeApplication(app.sessionId);
      console.log(
        purged
          ? '  🧹 Booked — application details and document deleted.\n'
          : '  ⚠️  Booked, but the purge request failed. Delete it manually.\n',
      );
    } else {
      await releaseApplication(app.id);
      console.log('  ↩️  Not booked — returned to the queue, nothing deleted.\n');
    }

    console.log('   Waiting for the next application.\n');
  }
}

main().catch((e) => {
  console.error('\n❌ Watcher stopped:', e.message);
  process.exit(1);
});
