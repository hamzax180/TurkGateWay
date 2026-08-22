/**
 * e-İkamet residence-permit assistant.
 *
 * A human-in-the-loop helper for e-ikamet.goc.gov.tr. It fills the form and
 * attaches your documents. **It never submits anything.**
 *
 * The filling engine is imported from the visa assistant rather than copied:
 * the never-operate guard, the label reading and the Qwen field resolution are
 * the parts that must not drift between the two flows, so there is exactly one
 * of each. What is İkamet-specific lives here — the portal URLs, the multi
 * document matching, and the checklist.
 *
 *   npm run ikamet:fill
 */

import { chromium } from 'playwright';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { fillCurrentPage, readEmptyFields, resetFieldCache, clearMangledFields } from '../visa-booking-assistant/find-slot.mjs';
import { hasQwenKey } from '../visa-booking-assistant/qwen-field-fill.mjs';
import { installCursor, pointAt, restCursor } from '../visa-booking-assistant/cursor-overlay.mjs';
import {
  auditDocuments,
  isYoursByDesign,
  matchDocument,
  usableDocuments,
  IKAMET_FIELD_MATCHERS,
  IKAMET_NEVER_FILL,
} from './documents.mjs';
import { KENDO_WIDGETS } from './kendo.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const APPLICANT_PATH = join(HERE, 'applicant.json');

export const FIRST_URL = 'https://e-ikamet.goc.gov.tr/Ikamet/Basvuru/IlkBasvuru';
export const EXTENSION_URL = 'https://e-ikamet.goc.gov.tr/Ikamet/Basvuru/UzatmaBasvuru';
const POLL_INTERVAL_MS = 1500;

/**
 * How the shared engine should treat this portal. One object, because every
 * caller — the fill pass and the still-empty report — has to see the form the
 * same way, and a report that does not know about the widgets is a report that
 * cannot mention the fields most likely to be missing.
 */
export const IKAMET_ENGINE_OPTS = {
  skipUploads: true,
  extraMatchers: IKAMET_FIELD_MATCHERS,
  neverFill: IKAMET_NEVER_FILL,
  widgets: KENDO_WIDGETS,
};

/**
 * How many times to go over a page before calling it done.
 *
 * One pass is not enough on this portal. Its dropdowns are backed by remote
 * data sources that are still in flight when the page first settles, and a
 * choosing a value from a list that has not arrived yet is not possible —
 * so the first pass legitimately cannot fill them. Passes are cheap (they
 * skip every field that already has a value, and every field somebody is
 * typing in), and the loop stops as soon as a pass changes nothing, so this
 * is a ceiling rather than a schedule.
 */
const FILL_PASSES = 5;

/**
 * Anything that advances, submits, pays or attests.
 *
 * The imported filler carries its own guard covering every write it makes;
 * this list holds the document pass here to the same rule, and states the
 * promise in one visible place rather than leaving it implied.
 */
const NEVER_OPERATE =
  'input[type=checkbox], button, input[type=submit], input[type=button], a[role=button]';

export function loadApplicant() {
  if (!existsSync(APPLICANT_PATH)) {
    console.error(
      [
        '',
        '❌ No applicant.json found.',
        '',
        '   cp scripts/ikamet-assistant/applicant.example.json scripts/ikamet-assistant/applicant.json',
        '',
        '   Then fill it in. That file is gitignored — it holds passport-level data.',
        '',
      ].join('\n'),
    );
    process.exit(1);
  }

  const raw = JSON.parse(readFileSync(APPLICANT_PATH, 'utf8'));
  // Strip the template's explanatory keys so they never reach the model or a
  // form field.
  const applicant = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k.startsWith('_')) continue;
    applicant[k] = v;
  }
  if (!applicant.fullName && applicant.firstName && applicant.lastName) {
    applicant.fullName = `${applicant.firstName} ${applicant.lastName}`.trim();
  }
  return applicant;
}

/** What the portal is going to ask for, checked before anything opens. */
export function printChecklist(applicant) {
  const audit = auditDocuments(applicant);

  console.log('\n📋 Documents');
  for (const d of audit.present) console.log(`   ✓ ${d.label} — ${d.file}`);
  for (const d of audit.broken) console.log(`   ✗ ${d.label} — FILE NOT FOUND at ${d.path}`);
  for (const d of audit.missing) console.log(`   · ${d.label} — not provided, attach it yourself`);

  if (audit.broken.length) {
    console.log('\n   Fix the paths above before running, or those slots stay empty.');
  }
  return audit;
}

/**
 * Attach each document to the upload field whose label identifies it.
 *
 * Runs before the text pass so the imported filler sees those inputs as
 * already populated and leaves them alone. Every attach is guarded twice: the
 * element must really be a file input, and it must not match NEVER_OPERATE.
 */
export async function attachDocuments(page, applicant) {
  const docs = usableDocuments(applicant);
  const attached = [];
  const unmatched = [];

  for (const input of await page.$$('input[type=file]')) {
    if (!(await input.isVisible().catch(() => false))) continue;

    const already = await input
      .evaluate((el) => el.files && el.files.length > 0)
      .catch(() => false);
    if (already) continue;

    const check = await input
      .evaluate(
        (el, forbidden) => ({
          forbidden: el.matches(forbidden),
          type: (el.getAttribute('type') || '').toLowerCase(),
          label:
            el.labels?.[0]?.textContent?.trim() ||
            el.closest('label')?.textContent?.trim() ||
            el.getAttribute('aria-label') ||
            el.getAttribute('title') ||
            el.closest('tr,li,.form-group,.row')?.textContent?.trim()?.slice(0, 120) ||
            '',
        }),
        NEVER_OPERATE,
      )
      .catch(() => null);

    if (!check || check.forbidden || check.type !== 'file') continue;

    const label = check.label.replace(/\s+/g, ' ').trim();
    const match = matchDocument(label);
    if (!match) {
      if (label) unmatched.push(label);
      continue;
    }

    const path = docs[match.key];
    if (!path) {
      unmatched.push(`${label} (no "${match.key}" path in applicant.json)`);
      continue;
    }
    if (!existsSync(path)) {
      unmatched.push(`${label} (file missing: ${path})`);
      continue;
    }

    try {
      await pointAt(page, input, `${match.label}: ${basename(path)}`);
      await input.setInputFiles(path);
      attached.push(`${label} → ${basename(path)}`);
    } catch {
      unmatched.push(`${label} (could not attach automatically)`);
    }
  }

  return { attached, unmatched };
}

/**
 * Which application this run is for.
 *
 * A command-line flag wins over applicant.json, because the two flows use
 * different portal URLs and ask for different documents — getting it wrong
 * sends you to the wrong form entirely. The flag makes it explicit per run
 * without editing the file, which matters when the same person extends this
 * year and re-applies later.
 */
export function resolveApplicationType(applicant, argv = process.argv.slice(2)) {
  const flags = argv.map((a) => a.toLowerCase());
  const wantsExtension = flags.includes('--extension') || flags.includes('--uzatma');
  const wantsFirst = flags.includes('--new') || flags.includes('--first') || flags.includes('--ilk');

  if (wantsExtension && wantsFirst) {
    console.error('');
    console.error('Pass either --extension or --new, not both.');
    console.error('');
    process.exit(1);
  }
  if (wantsExtension) return { isExtension: true, source: 'flag' };
  if (wantsFirst) return { isExtension: false, source: 'flag' };

  const fromFile = String(applicant.applicationType ?? '').toLowerCase();
  if (fromFile === 'extension' || fromFile === 'uzatma') return { isExtension: true, source: 'applicant.json' };
  if (fromFile === 'first' || fromFile === 'new' || fromFile === 'ilk') return { isExtension: false, source: 'applicant.json' };

  return { isExtension: false, source: 'default' };
}


const DEBUG = process.argv.slice(2).includes('--debug');

/**
 * Describe every control still unset, in enough detail to fix a matcher.
 *
 * Enhanced dropdowns and masked boxes do not look like what they are from the
 * outside, and guessing at them from a screenshot costs a round trip each
 * time. `--debug` prints what the page actually contains — tag, type,
 * visibility, option counts, mask hints — so one run answers the question.
 * It prints structure only, never the applicant's values.
 */
async function dumpUnfilled(page) {
  const rows = await page.evaluate(() => {
    const sel =
      'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=radio]):not([type=checkbox]):not([type=file]), select, textarea';
    return [...document.querySelectorAll(sel)]
      .map((el) => {
        const value = 'value' in el ? String(el.value ?? '') : '';
        const filled = value.trim() && value.trim() !== '0';
        if (filled) return null;
        const cs = getComputedStyle(el);
        const label =
          (el.id && document.querySelector(`label[for="${el.id}"]`)?.textContent) ||
          el.getAttribute('aria-label') ||
          el.closest('label')?.textContent ||
          el.getAttribute('placeholder') ||
          el.getAttribute('name') ||
          '';

        // What kind of widget, if any, is standing in front of this element.
        // A bare "HIDDEN" was actively misleading on this portal: every real
        // dropdown is a hidden input, so the one line that was supposed to
        // explain the failure looked like a page full of decoys.
        const $ = window.jQuery || window.$;
        const role = (el.getAttribute('data-role') || '').toLowerCase();
        const data = $ && $.fn ? $(el).data() : null;
        const widget = data
          ? Object.keys(data)
              .filter((k) => k.startsWith('kendo'))
              .map((k) => data[k])[0]
          : null;

        return {
          label: label.replace(/\s+/g, ' ').trim().slice(0, 60),
          tag: el.tagName.toLowerCase(),
          type: el.getAttribute('type') || '',
          hidden: cs.display === 'none' || cs.visibility === 'hidden',
          options: el.tagName.toLowerCase() === 'select' ? el.querySelectorAll('option').length : 0,
          placeholder: (el.getAttribute('placeholder') || '').slice(0, 24),
          classes: (el.className || '').toString().slice(0, 50),
          maskAttr: el.getAttributeNames().filter((a) => /mask/i.test(a)).join(','),
          role,
          bound: Boolean(widget),
          // For a remote list: how much of it has actually arrived. A value
          // that is not in the loaded page cannot be chosen from it, and this
          // is the number that says so.
          loaded:
            widget && widget.dataSource && typeof widget.dataSource.data === 'function'
              ? `${widget.dataSource.data().length}/${widget.dataSource.total()}`
              : '',
          widgetText: widget && typeof widget.text === 'function' ? String(widget.text()).slice(0, 30) : '',
        };
      })
      .filter(Boolean);
  });

  if (!rows.length) return;
  console.log('  ── still unset (--debug) ──');
  for (const r of rows) {
    console.log(
      `     ${r.tag}${r.type ? '[' + r.type + ']' : ''}` +
        `${r.role ? ' role=' + r.role + (r.bound ? '' : ' NOT-BOUND') : r.hidden ? ' HIDDEN' : ''}` +
        `${r.loaded ? ' loaded=' + r.loaded : ''}` +
        `${r.options ? ' options=' + r.options : ''}` +
        `${r.maskAttr ? ' mask=' + r.maskAttr : ''}` +
        `${r.placeholder ? ' ph="' + r.placeholder + '"' : ''}` +
        `${r.widgetText ? ' shows="' + r.widgetText + '"' : ''}` +
        `  ${JSON.stringify(r.label)}` +
        `${r.classes ? '  .' + r.classes : ''}`,
    );
  }
}

export async function main() {
  const applicant = loadApplicant();
  const { isExtension, source } = resolveApplicationType(applicant);
  const target = isExtension ? EXTENSION_URL : FIRST_URL;

  console.log('\n🇹🇷 e-İkamet assistant');
  console.log(
    `   ${isExtension ? 'EXTENSION (Uzatma)' : 'NEW application (İlk Başvuru)'}` +
      `  — from ${source}${source === 'default' ? ', pass --extension or --new to be explicit' : ''}`,
  );
  console.log(`   ${target}`);
  console.log(
    hasQwenKey()
      ? '   Field recognition: Qwen — reads each field label as a person would'
      : '   Field recognition: OFF (no DASHSCOPE_API_KEY) — only exact-match fields are filled',
  );

  printChecklist(applicant);

  console.log('\n⚠️  This script NEVER clicks İleri, Kaydet, Başvuru Yap or Randevu Al,');
  console.log('   and NEVER ticks a confirmation checkbox. Every one of those is yours.');
  console.log('   Close the browser window to finish.\n');

  resetFieldCache(applicant);

  const browser = await chromium.launch({ headless: false, args: ['--start-maximized'] });
  const context = await browser.newContext({ viewport: null, acceptDownloads: true });
  const page = await context.newPage();
  await installCursor(page).catch(() => {});

  await page.goto(target, { waitUntil: 'domcontentloaded' }).catch(() => {
    console.log('   (Could not open the portal directly — navigate there yourself in the window.)');
  });

  console.log('👉 Sign in and start your application in the window. I fill each form as it appears.\n');

  let lastSignature = '';
  let passesLeft = 0;
  let lastGaps = null;
  let announced = true;

  while (!page.isClosed()) {
    try {
      // Identify the page by its FORM, not by its text length.
      //
      // innerText.length shifts whenever a mask template appears, a tooltip
      // opens or a validation note renders — none of which mean a new step.
      // Every such flicker was read as "new page", so the filler ran again,
      // clicked back into a field and stole the cursor from under whoever was
      // typing. The set of field names is stable within a step and different
      // between steps, which is exactly the signal wanted.
      const signature = await page.evaluate(() => {
        const sel =
          'input:not([type=hidden]):not([type=submit]):not([type=button]), select, textarea';
        const names = [...document.querySelectorAll(sel)]
          .map((el) => el.getAttribute('name') || el.id || el.tagName)
          .join(',');
        return document.title + '|' + location.href + '|' + names;
      });

      if (signature !== lastSignature) {
        lastSignature = signature;

        const { attached, unmatched } = await attachDocuments(page, applicant);
        for (const a of attached) console.log(`  📎 ${a}`);
        for (const u of unmatched) console.log(`  ⚠️  Upload left for you: ${u}`);

        // A new form gets a fresh budget of passes. The first one runs on this
        // same tick so nothing waits on the poll interval unnecessarily.
        passesLeft = FILL_PASSES;
        lastGaps = null;
        announced = false;
      }

      if (passesLeft > 0) {
        passesLeft -= 1;

        // Documents are handled above by attachDocuments, so the imported
        // filler skips its own single-document pass entirely.
        const filled = await fillCurrentPage(page, applicant, IKAMET_ENGINE_OPTS);
        for (const f of filled) console.log(`  ✍️  ${f}`);

        // Masks that reformat on blur mangle a value after it was checked, so
        // the final state gets one more look before you are asked to review.
        const cleared = await clearMangledFields(page);
        for (const c of cleared) {
          console.log(`  ⚠️  ${c}: the box reformatted what was typed — cleared it, please enter it yourself`);
        }

        const empty = await readEmptyFields(page, IKAMET_ENGINE_OPTS).catch(() => []);
        const gaps = empty.join('|');

        // Settled: this pass wrote nothing and left exactly the same gaps as
        // the one before it. Another identical pass would only repeat itself,
        // so the remaining budget is handed back rather than spent.
        if (!filled.length && !cleared.length && gaps === lastGaps) passesLeft = 0;
        lastGaps = gaps;

        if (DEBUG && passesLeft === 0) await dumpUnfilled(page);

        if (passesLeft === 0 && !announced) {
          announced = true;
          await restCursor(page).catch(() => {});

          // Two different things, reported separately. A box that is the
          // applicant's by design is not a failure, and burying the boxes the
          // assistant could not fill in the same list as the CAPTCHA is how a
          // genuinely missed dropdown goes unnoticed.
          const yours = empty.filter(isYoursByDesign);
          const missed = empty.filter((label) => !isYoursByDesign(label));

          if (missed.length) {
            console.log(`  ⚠️  Could not fill (please check these): ${missed.join(', ')}`);
          } else {
            console.log('  ✅ Every field I can fill on this page is filled.');
          }
          if (yours.length) {
            console.log(`  ✋ Yours to enter: ${yours.join(', ')}`);
          }
          console.log('  ⏸  Page ready for review — click İleri / Kaydet yourself when ready.');
          console.log('     (The confirmation checkbox is yours to tick — this script never will.)\n');
        }
      }
    } catch {
      // Mid-navigation or briefly detached — try again next tick.
    }

    if (page.isClosed()) break;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  console.log('\n👋 Browser closed. Nothing was submitted by this script.');
  await browser.close().catch(() => {});
}

const IS_DIRECT_RUN = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (IS_DIRECT_RUN) {
  main().catch((e) => {
    console.error('\n❌ Error:', e.message);
    process.exit(1);
  });
}
