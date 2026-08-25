/**
 * find-slot.mjs
 * Mosaic Visa (Türkiye Student Visa, Ashgabat) appointment assistant.
 *
 * What this does:
 *   1. Scans the live calendar, month by month, for the earliest weekday with
 *      actual remaining capacity (the site's own `data-remaining` counter —
 *      days with 0 remaining ignore clicks, so they are never chosen).
 *   2. Opens that date in a visible browser window with a real click.
 *   3. Fills in whatever fields it recognises on the current page from
 *      applicant.json.
 *   4. Watches the site's Altcha proof-of-work widget (it solves itself
 *      in-page — nothing here is bypassed) and tells you when it has
 *      finished so you don't click Next too early.
 *   5. Stops and waits. It never clicks Next, Continue, or Apply — on ANY
 *      page, including the last one. You review and click those yourself.
 *   6. Once you click Next/advance a step, it notices the new page/section
 *      and fills that one too, then waits again. Repeats until you close
 *      the browser.
 *
 * What this does NOT do:
 *   - Never submits anything.
 *   - Never runs unattended in the background — you watch it, it's a visible
 *     browser window the whole time.
 *   - Never tries to evade bot detection. The Altcha widget runs exactly as
 *     the site designed it; this script only observes its state. If the site
 *     blocks the browser, it stops and tells you.
 *
 * Run: node scripts/visa-booking-assistant/find-slot.mjs
 */
import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join, basename } from 'path';
import { printChecklist } from './checklist.mjs';
import { askFieldValue, hasQwenKey, resetFieldCache } from './qwen-field-fill.mjs';

// Re-exported for the server, which drives this module for many applicants in
// one process and must be able to forget one applicant's answers.
export { resetFieldCache };
import { installCursor, pointAt, pointAtRect, restCursor } from './cursor-overlay.mjs';

export const IS_DIRECT_RUN = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

const __dir = dirname(fileURLToPath(import.meta.url));
// Exported so watch.mjs drives the same site, calendar and cadence — two
// copies of these would drift the moment one is corrected.
export const BASE = 'https://appointment.mosaicvisa.com';
export const CALENDAR_ID = 20; // Ashgabat Student Visa (Tömer & Student Visa)
export const MAX_MONTHS_AHEAD = 6;
export const POLL_INTERVAL_MS = 1500;

// ── Load applicant data ─────────────────────────────────────────────────────

export function loadApplicant() {
  const path = join(__dir, 'applicant.json');
  if (!existsSync(path)) {
    console.error(
      `\n❌ scripts/visa-booking-assistant/applicant.json not found.\n` +
        `   Copy applicant.example.json to applicant.json in the same folder and fill it in.\n`,
    );
    process.exit(1);
  }
  const data = JSON.parse(readFileSync(path, 'utf8'));
  // Strip the "_"-prefixed comment/help keys from the template so they never
  // reach the model as if they were applicant data.
  const clean = Object.fromEntries(
    Object.entries(data).filter(([k, v]) => !k.startsWith('_') && v !== '' && v != null),
  );
  return withDerivedNames(clean);
}

/**
 * Static matchers — kept ONLY for labels unambiguous enough that no other
 * field on any page of this form could plausibly share them. This used to
 * also list "passport" (matching both "Passport No" and "Passport Issued
 * Place") and a bare "name" (which can't tell "full name" from "first name
 * only, there's a separate Surname field" apart) — both caused real
 * mis-fills on the live form. Anything with that kind of ambiguity now goes
 * through Qwen instead, which reads the actual label rather than pattern-
 * matching a keyword out of context. See qwen-field-fill.mjs.
 */
const FIELD_MATCHERS = [
  { key: 'phone', patterns: [/^mobile$/i, /^phone$/i, /contact number/i] },
  { key: 'email', patterns: [/e-?mail/i] },
  { key: 'applicantCount', patterns: [/number of applicant/i, /how many applicant/i] },
];

/**
 * Older applicant.json files have a single `fullName`. The form has separate
 * Name and Surname fields, so derive them when the split fields are absent —
 * but only for the simple two-part case. Anything more (middle names, compound
 * surnames) is left to Qwen, which can at least reason about the label; a
 * naive split-on-space would confidently get those wrong.
 */
function withDerivedNames(applicant) {
  if (applicant.firstName || applicant.lastName || !applicant.fullName) return applicant;
  const parts = String(applicant.fullName).trim().split(/\s+/);
  if (parts.length !== 2) return applicant;
  return { ...applicant, firstName: parts[0], lastName: parts[1] };
}

// ── Month-by-month live scan for the earliest day with real capacity ───────

function monthParam(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Reads the calendar page already loaded in `page` and returns every day that
 * actually has remaining capacity. The site marks each bookable row with
 * data-remaining="N" (shown as "Available N" when open, "Reserved 0" when
 * full); rows with 0 ignore clicks entirely, and rows without a data-date
 * are weekends/days that are not bookable at all.
 */
export async function readOpenDatesOnPage(page) {
  return page.evaluate(() => {
    const rows = [...document.querySelectorAll('tr.calendar-dates')];
    const results = [];
    for (const row of rows) {
      const iso = (row.getAttribute('data-date') || '').trim();
      const remaining = parseInt(row.getAttribute('data-remaining') || '0', 10);
      if (!iso || !(remaining > 0)) continue;
      const dateText = ((row.textContent || '').match(/^\s*\d{1,2}\s+\w+\s+\d{4}/) || [''])[0].trim();
      if (!dateText) continue;
      results.push({ dateText, iso, remaining });
    }
    return results;
  });
}

/**
 * Scans forward from today, live, up to MAX_MONTHS_AHEAD. Returns the first
 * date with remaining capacity (chronologically — months are visited in
 * order and each month's rows are already in document order).
 */
export async function findEarliestOpenDate(page) {
  const today = new Date();
  for (let i = 0; i < MAX_MONTHS_AHEAD; i++) {
    const target = new Date(today.getFullYear(), today.getMonth() + i, 1);
    const url = `${BASE}/calendar/${CALENDAR_ID}?month=${monthParam(target)}`;
    const open = await readOpenDatesOnPageAfterGoto(page, url);
    console.log(
      open.length > 0
        ? `  scanning ${monthParam(target)}... ${open.length} day(s) with open capacity`
        : `  scanning ${monthParam(target)}... no open capacity`,
    );
    if (open.length > 0) {
      return { ...open[0], monthParam: monthParam(target) };
    }
  }
  return null;
}

async function readOpenDatesOnPageAfterGoto(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const open = await readOpenDatesOnPage(page);
  // If the calendar markup drifted (no .calendar-dates rows at all), fall
  // back to the text-based scan so the tool still reports something useful.
  const hasMarkup = await page.evaluate(() => document.querySelectorAll('tr.calendar-dates').length > 0);
  if (!hasMarkup) {
    return page.evaluate(() => {
      const DATE_RE = /^\d{1,2}\s+\w+\s+\d{4}$/;
      const results = [];
      const seen = new Set();
      for (const el of document.querySelectorAll('body *')) {
        const text = (el.textContent || '').trim();
        if (!DATE_RE.test(text)) continue;
        if (el.children.length > 0) continue;
        if (seen.has(text)) continue;
        let row = el.closest('tr');
        if (!row) {
          let node = el.parentElement;
          for (let i = 0; i < 6 && node; i++) {
            if (/Reserved/i.test(node.textContent)) { row = node; break; }
            node = node.parentElement;
          }
        }
        const m = (row ? row.textContent : '').match(/(?:Reserved|Available)\s+(\d+)/i);
        const remaining = m ? parseInt(m[1], 10) : 0;
        if (remaining > 0) {
          seen.add(text);
          results.push({ dateText: text, iso: '', remaining });
        }
      }
      return results;
    });
  }
  return open;
}

/** Click the row for the given date on whatever month is currently loaded. */
export async function clickDate(page, iso, dateText) {
  if (iso) {
    try {
      // A real browser-level click (trusted event), the same as a human.
      await page.locator(`tr.calendar-dates[data-date="${iso}"]`).click({ timeout: 5000 });
      return true;
    } catch {
      // Fall through to the text-based fallback below.
    }
  }
  const clicked = await page.evaluate((dateText) => {
    const el = [...document.querySelectorAll('body *')].find(
      (e) => e.children.length === 0 && e.textContent.trim() === dateText,
    );
    if (!el) return false;
    let row = el.closest('tr') || el.parentElement;
    (row || el).click();
    return true;
  }, dateText);
  return clicked;
}

// ── Generic form-fill: never advances, only fills recognised empty fields ──

/**
 * Native <input type=date> only accepts ISO "YYYY-MM-DD" via Playwright's
 * .fill() — that's independent of the mm/dd/yyyy the browser displays. The
 * applicant file's dateOfBirth is DD/MM/YYYY (or already ISO), so it has to
 * be converted before filling; otherwise .fill() silently no-ops and the
 * field is left focused mid-segment, which is what "stuck" looks like.
 * Returns null (never a guess) if the string can't be parsed safely.
 */
function toISODate(value) {
  if (!value) return null;
  const v = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const m = v.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
}

/**
 * Controls this script must never operate, no matter what a matcher says.
 *
 * The confirm page ends with "I confirm that all the information provided in
 * my appointment form is correct" — a legal attestation by the applicant, not
 * a form field. Ticking it on someone's behalf would be asserting something
 * only they can assert. Today the field selectors happen to exclude
 * checkboxes, but that is a side effect of how they're written; this makes it
 * a stated rule so a future selector change can't quietly start ticking it.
 *
 * Buttons are here for the same reason: Next / Continue / Apply are never
 * clicked by this script, on any page.
 */
const NEVER_OPERATE = 'input[type=checkbox], button, input[type=submit], input[type=button]';

/**
 * Text-ish fields this script may fill. Radios, files and everything in
 * NEVER_OPERATE are deliberately excluded and handled (or refused) separately.
 */
const TEXTUAL_FIELD_SELECTOR =
  'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=radio]):not([type=checkbox]):not([type=file]), select, textarea';

/**
 * Fold Turkish letters onto ASCII.
 *
 * JavaScript's /i flag does NOT fold the dotted capital İ (U+0130) or the
 * dotless ı (U+0131) onto ASCII "i" — Unicode simple case folding leaves them
 * alone. So /ilk iki harf/i silently fails against "İlk İki Harfi", which is
 * how the portal writes it, and the field falls through to the model or to
 * nobody. On a live run that quietly cost the Country of Nationality dropdown.
 */
function foldTurkish(s) {
  return String(s)
    .replace(/İ/g, 'i').replace(/I/g, 'i').replace(/ı/g, 'i')
    .replace(/Ş/g, 's').replace(/ş/g, 's')
    .replace(/Ğ/g, 'g').replace(/ğ/g, 'g')
    .replace(/Ü/g, 'u').replace(/ü/g, 'u')
    .replace(/Ö/g, 'o').replace(/ö/g, 'o')
    .replace(/Ç/g, 'c').replace(/ç/g, 'c')
    .toLowerCase();
}

/**
 * Does this pattern describe this label, in either script?
 *
 * The label is folded and re-tested rather than the PATTERN being folded.
 * Rewriting a pattern's source is the tempting version and it is unsafe: fold
 * lower-cases everything, which turns `\B` into `\b` and inverts the rule.
 * Folding only the text it is matched against cannot change what a pattern
 * means.
 */
function labelMatches(re, label) {
  return re.test(label) || re.test(foldTurkish(label));
}

/** Print a warning at most once per run, so the 1.5s poll loop can't spam it. */
const warnedOnce = new Set();
function warnOnce(message) {
  if (warnedOnce.has(message)) return;
  warnedOnce.add(message);
  console.log(`  ⚠️  ${message}`);
}

/**
 * Gate every write this script makes. Throws if the element is something we
 * must never operate, or isn't the control type the caller thinks it is.
 * Callers treat a throw as "leave it for the human", which is the safe default.
 */
async function assertType(el, expected) {
  const check = await el.evaluate(
    (n, forbidden) => ({
      forbidden: n.matches(forbidden),
      actual: (n.getAttribute('type') || n.tagName).toLowerCase(),
    }),
    NEVER_OPERATE,
  );
  if (check.forbidden) {
    throw new Error(`refusing to operate <${check.actual}> — it is on the never-operate list`);
  }
  if (expected && check.actual !== expected) {
    throw new Error(`refusing to operate a <${check.actual}> as a ${expected} control`);
  }
}

/**
 * Read a field's label the way a person reading the page would.
 *
 * Returns `{ text, human }`. `human` is false when the only thing available
 * was the element's `name` attribute — a machine identifier the applicant
 * never sees, like `document[TM0000000]` or `hp_d2aa1eb7c1a3`. That
 * distinction matters for the "still empty" report: telling someone to fill
 * in a field they cannot see is worse than saying nothing.
 */
async function readLabelInfo(page, field) {
  return page
    .evaluate(([el, hintSrc]) => {
      const isHint = eval(hintSrc);
      // Is this actually rendered for a person to see and fill? Playwright's
      // isVisible() only catches display:none / visibility:hidden. Honeypot
      // fields are typically present and "visible" by that definition but
      // pushed off-screen, collapsed to zero size, or made transparent.
      // A field a human cannot see is one this script must not type into.
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      //
      // Position is measured against the DOCUMENT, not the viewport.
      // getBoundingClientRect is viewport-relative, so a viewport test also
      // rejects every field that merely happens to be scrolled out of view
      // right now. Attaching documents scrolls to the upload fields near the
      // bottom, which silently disqualified the fields at the top — three
      // mandatory boxes came back empty on a real page for exactly that
      // reason. Scroll position is not a property of the field.
      const docLeft = rect.left + window.scrollX;
      const docTop = rect.top + window.scrollY;
      const rendered =
        rect.width >= 2 &&
        rect.height >= 2 &&
        style.opacity !== '0' &&
        style.visibility !== 'hidden' &&
        docLeft > -1000 &&
        docTop > -1000 &&
        docLeft < (document.documentElement.scrollWidth || 10000);

      const label = (text, human) => ({ text: (text || '').trim(), human, rendered });

      if (el.id) {
        const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (l && l.textContent.trim()) return label(l.textContent, true);
      }
      const aria = el.getAttribute('aria-label');
      if (aria) return label(aria, true);
      // A placeholder usually describes the field, but on a masked input it is
      // the mask template — "(___) ___-__-__" — which describes nothing. Using
      // it as the label meant the model was asked what belongs in a field
      // called "(___) ___-__-__", correctly answered "no idea", and the box
      // stayed empty. Skip those and keep looking for a real label.
      const ph = el.getAttribute('placeholder');
      if (ph && !isHint(ph)) return label(ph, true);
      const closestLabel = el.closest('label');
      if (closestLabel && closestLabel.textContent.trim()) return label(closestLabel.textContent, true);

      // Some real fields on this form have no label association at all — the
      // Travel Document select is one. Its heading lives in the enclosing
      // table row, which is exactly what a person reads. Look there before
      // giving up and using the machine name.
      let node = el.parentElement;
      for (let depth = 0; node && depth < 4; depth++, node = node.parentElement) {
        for (const heading of node.querySelectorAll('label, th, legend')) {
          if (heading.contains(el)) continue;
          const text = (heading.textContent || '').trim();
          if (text) return label(text, true);
        }
      }

      const name = el.getAttribute('name');
      if (name) return label(name, false);
      return label('', false);
    }, [field, FORMAT_HINT_SOURCE])
    .catch(() => ({ text: '', human: false, rendered: false }));
}

/** Just the label text, for callers that don't care where it came from. */
async function readLabel(page, field) {
  return (await readLabelInfo(page, field)).text;
}

/**
 * Find the heading label for a radio group — the "Gender" or "Marital Status"
 * text a person reads, not the `name` attribute the markup happens to use.
 *
 * readLabel() on an individual radio returns its *option* text ("Male"), which
 * is useless as a question. So walk up from the radio through its ancestors
 * and take the first label that isn't one of the option texts — on this form
 * that's the row heading in the left column.
 */
async function readGroupLabel(page, radioEl, optionLabels) {
  const found = await radioEl
    .evaluate((el, opts) => {
      const seen = new Set(opts.map((o) => o.trim().toLowerCase()));
      let node = el.parentElement;
      for (let depth = 0; node && depth < 5; depth++, node = node.parentElement) {
        for (const label of node.querySelectorAll('label, th, legend')) {
          const text = (label.textContent || '').trim();
          if (text && !seen.has(text.toLowerCase())) return text;
        }
      }
      return '';
    }, optionLabels)
    .catch(() => '');
  return found;
}

/**
 * Fills any currently-empty, recognisable field on the page. Never touches a
 * field that already has a value (so it never overwrites something you or a
 * previous pass already set) and never clicks any button.
 *
 * Order per field: (1) the small static list above for genuinely unambiguous
 * labels, (2) Qwen, given the field's real label/type/options plus the
 * applicant data, reading it the way a person would rather than pattern-
 * matching a keyword out of context. Radios are handled as a group — a
 * single Gender radio can't be "filled" on its own, the whole Female/Male
 * choice has to be resolved together.
 *
 * Returns the list of field labels it filled, for logging.
 */
export async function fillCurrentPage(page, applicant, opts = {}) {
  const filled = [];

  // ── Plain text/select/textarea fields ─────────────────────────────────
  const fields = await page.$$(TEXTUAL_FIELD_SELECTOR);

  // Every label on the page, gathered up front. A label only means something
  // relative to its neighbours — "Name" beside a "Surname" field means the
  // given name, whereas "Name" on its own means the whole name. The model
  // can't make that distinction without seeing the neighbours.
  const siblingLabels = [];
  for (const field of fields) {
    if (!(await field.isVisible().catch(() => false))) continue;
    const { text, human, rendered } = await readLabelInfo(page, field);
    if (text && human && rendered && !siblingLabels.includes(text)) siblingLabels.push(text);
  }

  for (const field of fields) {
    // A control that is not the element holding it is exempt from both
    // visibility gates below.
    //
    // Two shapes of this exist. A <select> behind an enhanced dropdown is
    // hidden with display:none while a searchable list is painted on top. A
    // Kendo widget goes further: e-İkamet has no <select> elements at all —
    // its dropdowns are hidden <input>s with a `.k-widget` wrapper drawn over
    // them. Either way the hidden element is the one that holds the answer and
    // the one the form submits, so skipping it meant those dropdowns were
    // never filled AND never reported as empty — invisible in both senses.
    //
    // The visibility rule exists to avoid honeypot traps, and those are plain
    // text inputs, never a control carrying two hundred country options — so
    // the exemption costs nothing.
    const isSelectTag = await field.evaluate((el) => el.tagName.toLowerCase() === 'select').catch(() => false);
    const widget = opts.widgets ? await opts.widgets.describe(field) : null;
    const widgetOwns = Boolean(widget && widget.owns && !widget.disabled);
    const standsIn = isSelectTag || Boolean(widgetOwns && widget.visible);

    const isVisible = await field.isVisible().catch(() => false);
    if (!isVisible && !standsIn) continue;

    // Never touch the control the person is in the middle of using. Focus is
    // the clearest signal that a human is working on a field, and typing into
    // it — or clicking it to type — pulls the caret out from under them. For a
    // widget the focus can be anywhere inside its wrapper, which is a
    // different element from the one being tested here.
    const hasFocus = await field.evaluate((el) => el === document.activeElement).catch(() => false);
    if (hasFocus || (widget && widget.focused)) continue;

    // What the control holds is the widget's answer when there is one. The raw
    // input is not a reliable witness: Kendo reports "Please select..." as its
    // text while the underlying value is still blank, and — the case that
    // matters — the correct answer to the İkamet province question has the
    // code 0, which the placeholder rule below would read as unanswered.
    const currentValue = widgetOwns ? widget.value : await field.inputValue().catch(() => '');
    // A "0" in a plain select means "choose one" placeholder — treat as empty.
    if (currentValue && currentValue.trim() && (widgetOwns || currentValue.trim() !== '0')) continue;

    // A mask template like "(___) ___-__-__" is the box being empty, but it is
    // also proof the field defeated an earlier attempt. Retrying it on a later
    // pass just steals the caret again, so it is left alone and reported.
    // A widget-owned mask is exempt: it is written through the widget's own
    // API rather than by typing, so the template is not evidence of anything.
    if (!widgetOwns && /_{2,}/.test(currentValue)) continue;

    const { text: label, rendered } = await readLabelInfo(page, field);
    if (!label) continue;

    // Fields the caller has declared off-limits. Not everything the assistant
    // COULD fill is something it SHOULD: some boxes are the applicant's to
    // enter themselves. Checked before any resolution so neither a matcher nor
    // the model can reach them.
    if ((opts.neverFill ?? []).some((re) => labelMatches(re, label))) continue;

    // Never type into a field the applicant cannot see. Filling a form by hand
    // means filling the fields actually presented to you — an off-screen or
    // zero-size input is not one of them, and on this form at least one such
    // field is a honeypot meant to stay empty. Skipping it outright is safer
    // than relying on the model to return SKIP every single time.
    if (!rendered && !standsIn) continue;

    const tag = await field.evaluate((el) => el.tagName.toLowerCase());
    const isSelect = tag === 'select';
    const inputType = tag === 'input' ? await field.getAttribute('type').catch(() => null) : null;
    const isDate = inputType === 'date' || (widgetOwns && widget.kind === 'date');

    // The options a person would see in the list. For a widget these come out
    // of its data source rather than the DOM, because there are no <option>
    // elements to read.
    const options = widgetOwns
      ? opts.widgets.optionTexts(widget)
      : isSelect
        ? await field.evaluate((el) =>
            [...el.querySelectorAll('option')]
              .map((o) => o.textContent.trim())
              .filter((t) => t && !/^choose$/i.test(t)),
          )
        : null;

    // Is the list in front of us the WHOLE list?
    //
    // A remote dropdown hands over one page at a time. Country of Nationality
    // loads thirty of two hundred, alphabetically, so the applicant's own
    // country is usually not among them. Showing the model those thirty and
    // demanding it answer with one of them forces a SKIP for everybody outside
    // the A's — which is exactly how that dropdown came back empty on a live
    // run while every other field filled. When the list is partial the model
    // is asked as an open question instead, and the adapter then looks the
    // answer up against the server rather than against the page.
    const partialList = Boolean(widgetOwns && widget.kind === 'list' && !widget.complete);

    let value = null;
    // Caller-supplied matchers win over the shared list and over the model.
    // The İkamet form asks for things whose label admits exactly one answer —
    // "Foreigners ID No", "Residence Permit Card Serial Number" — and those
    // should never be a judgement call: a model that returns SKIP on a
    // mandatory identity field leaves the applicant stuck with no explanation.
    const matchers = [...(opts.extraMatchers ?? []), ...FIELD_MATCHERS];
    const staticMatch = matchers.find((m) => m.patterns.some((re) => labelMatches(re, label)));
    if (staticMatch) {
      // `derive` covers the fields that hold a PART of something the applicant
      // gave us — the İkamet entry page asks for the first two letters of each
      // name, which is not a key anybody would sensibly store on its own.
      value = staticMatch.derive
        ? staticMatch.derive(applicant)
        : applicant[staticMatch.key] ?? (staticMatch.key === 'applicantCount' ? '1' : null);
    } else if (hasQwenKey()) {
      value = await askFieldValue({
        label,
        // A widget-backed list is a dropdown to whoever is filling the form,
        // so the model is asked the same question it would be asked about a
        // <select> — pick one of these exact options, or SKIP. Unless the list
        // is only partly loaded, in which case a closed question has no
        // truthful answer and it is asked as an open one.
        type: options && !partialList ? 'select' : isDate ? 'date' : 'text',
        options: partialList ? null : options,
        applicant,
        siblingLabels,
      });
    }
    if (!value) continue;

    // A date WIDGET takes a real date object, so it is handed the value as
    // written and does its own parsing; only a native date input needs the
    // ISO string this normaliser produces.
    if (isDate && !widgetOwns) {
      const iso = toISODate(value);
      if (!iso) continue; // can't safely parse — leave it for you to fill by hand
      value = iso;
    }

    // A value identical to the field's own placeholder is the hint echoed back,
    // not an answer — "(333) 333-33-33" is the format example, and writing it
    // produces a phone number of ten 3s that looks entirely plausible.
    const ownPlaceholder = await field.getAttribute('placeholder').catch(() => null);
    if (ownPlaceholder && String(value).trim() === ownPlaceholder.trim()) continue;

    try {
      await assertType(field, null); // never-operate list applies to every write

      if (widgetOwns) {
        // The cursor has to be aimed at the wrapper: the element being written
        // is display:none, so asking it for a box returns nothing.
        const rect = opts.widgets.pointTarget ? await opts.widgets.pointTarget(field) : null;
        if (rect) await pointAtRect(page, rect, `${label}: ${value}`);
        else await pointAt(page, field, `${label}: ${value}`);

        const written = await opts.widgets.setValue(field, widget, String(value));
        if (!written) continue; // the widget would not take it — left for you
      } else {
        await pointAt(page, field, `${label}: ${value}`);

        if (isSelect) {
          const chosen = await selectOptionLoosely(field, String(value));
          if (!chosen) continue; // no option really means this — leave it
        } else {
          const written = await writeTextSafely(field, String(value));
          if (!written) continue; // a mask mangled it — reported as still-empty
        }
      }

      filled.push(`${label} → \"${value}\"`);
    } catch {
      // Field exists but couldn't be set this way (custom widget, etc.) — skip,
      // it stays empty for you to fill by hand.
    }
  }

  // ── Radio groups ───────────────────────────────────────────────────────
  // Handled together, not one input at a time — "Female" alone means nothing
  // without knowing the other option was "Male".
  const radios = await page.$$('input[type=radio]:not([disabled])');
  const groups = new Map(); // name -> [{el, value, label}]
  for (const radio of radios) {
    const isVisible = await radio.isVisible().catch(() => false);
    if (!isVisible) continue;
    const name = await radio.getAttribute('name').catch(() => null);
    if (!name) continue;
    const optionLabel = await readLabel(page, radio);
    const value = await radio.getAttribute('value').catch(() => '');
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push({ el: radio, value, label: optionLabel || value });
  }

  for (const [name, options] of groups) {
    const alreadyChecked = await Promise.all(options.map((o) => o.el.isChecked().catch(() => false)));
    if (alreadyChecked.some(Boolean)) continue; // don't overwrite an existing choice

    const optionLabels = options.map((o) => o.label);
    // Ask using the visible heading ("Gender"), not the raw name attribute —
    // the model should read what a person reads.
    const groupLabel = (await readGroupLabel(page, options[0].el, optionLabels)) || name;
    const value = hasQwenKey()
      ? await askFieldValue({
          label: groupLabel,
          type: 'radio-group',
          options: optionLabels,
          applicant,
          siblingLabels,
        })
      : null;
    if (!value) continue;

    const chosen = options.find((o) => o.label === value);
    if (!chosen) continue;

    try {
      await assertType(chosen.el, 'radio'); // never let a checkbox reach .check()
      await pointAt(page, chosen.el, `${groupLabel}: ${value}`);
      await chosen.el.check();
      filled.push(`${groupLabel} → "${value}"`);
    } catch {
      // Leave unchecked for you to pick by hand.
    }
  }

  // ── Supporting document upload ─────────────────────────────────────────
  // Attaching a file to a field is the same class of action as filling a text
  // field. It does not tick the attestation checkbox and does not click Next.
  // Callers that attach their own documents (the İkamet assistant matches
  // several files to several slots) pass skipUploads, so this pass does not
  // warn about mainSupportingDocumentPath — a setting that does not exist in
  // their flow.
  const docPath = applicant.mainSupportingDocumentPath;
  for (const fileInput of opts.skipUploads ? [] : await page.$$('input[type=file]')) {
    if (!(await fileInput.isVisible().catch(() => false))) continue;
    const alreadyAttached = await fileInput.evaluate((el) => el.files && el.files.length > 0).catch(() => false);
    if (alreadyAttached) continue;

    const label = (await readLabel(page, fileInput)) || 'Document';
    if (!docPath) {
      warnOnce(`📎 ${label}: no mainSupportingDocumentPath set in applicant.json — attach it yourself.`);
      continue;
    }
    if (!existsSync(docPath)) {
      warnOnce(`📎 ${label}: file not found at ${docPath} — attach it yourself.`);
      continue;
    }
    try {
      await assertType(fileInput, 'file');
      await pointAt(page, fileInput, `${label}: ${basename(docPath)}`);
      await fileInput.setInputFiles(docPath);
      filled.push(`${label} → attached ${basename(docPath)}`);
    } catch {
      warnOnce(`📎 ${label}: could not attach automatically — attach it yourself.`);
    }
  }

  return filled;
}

/**
 * Did the field end up holding what we meant?
 *
 * Punctuation a mask adds is fine — `(555) 000-00-00` is the same phone as
 * `5550000000`. A leftover placeholder character is NOT fine: it means the
 * mask template survived and our text was spliced into it rather than typed
 * through it. The live portal produced `(___) ___-__-__05550000000` that way,
 * and stripping underscores before comparing would call that a match, which is
 * precisely the bug this guard exists to catch.
 */
function sameValue(actual, intended) {
  const raw = String(actual ?? '');
  if (/[_]/.test(raw)) return false;
  const strip = (v) => String(v ?? '').replace(/[^0-9a-z]/gi, '').toLowerCase();
  return strip(raw) === strip(intended);
}

/**
 * Write text and make sure what landed is what we meant.
 *
 * Input masks are the reason this exists. `fill()` sets the value directly,
 * which a JS mask on a phone or card field does not always see, so the result
 * can end up spliced into the mask template — a real run produced
 * `(___) ___-__-__05550000000` from a clean phone number. Typing key by key
 * lets the mask do its job, so that is the second attempt.
 *
 * If neither produces the intended value the field is CLEARED and reported as
 * still-empty. A half-mangled phone number is worse than a blank one: blank is
 * obvious and gets fixed, mangled looks filled and gets submitted.
 */
/**
 * Send `value` as real key events.
 *
 * These fields come from page.$$(), which yields ElementHandles, and
 * pressSequentially() is a Locator method — calling it on a handle throws
 * "not a function". The throw was swallowed by the surrounding catch, so the
 * masked-field path looked like it ran and silently typed nothing. Both names
 * are tried so this keeps working whichever kind of object it is given.
 */
/**
 * Is this placeholder a FORMAT HINT rather than a description?
 *
 * Hints are written from a tiny alphabet of stand-in characters — X, d, m, y,
 * 9, underscore — arranged with punctuation: "(___) ___-__-__",
 * "(333) 333-33-33", "(5XX) XXX-XX-XX", "dd/mm/yyyy". Strip the punctuation
 * and digits and nothing but those stand-ins is left. Real descriptions
 * ("e-mail address") leave ordinary words behind.
 *
 * Two things depend on telling them apart: a hint must never be used as a
 * field's label (the model was being asked what belongs in a field called
 * "(___) ___-__-__"), and a field carrying one is masked, so it has to be
 * typed into rather than filled.
 */
const FORMAT_HINT_SOURCE = `(ph) => {
  const s = String(ph || '').trim();
  if (s.length < 3) return false;
  const letters = s.replace(/[^a-z]/gi, '');
  if (letters && !/^[xdmy]+$/i.test(letters)) return false;
  return /[()\-_./]/.test(s) || /_{2,}/.test(s) || /^[0-9]+$/.test(s.replace(/[^0-9]/g, ''));
}`;

async function typeLikeAPerson(field, value) {
  if (typeof field.pressSequentially === 'function') {
    return field.pressSequentially(value, { delay: 30 }).catch(() => {});
  }
  if (typeof field.type === 'function') {
    return field.type(value, { delay: 30 }).catch(() => {});
  }
  return undefined;
}

async function writeTextSafely(field, value) {
  // Is this box masked? A mask advertises itself in the placeholder it shows
  // when empty — `(___) ___-__-__` — or in the data-* attribute the common
  // libraries set. Detecting it BEFORE writing matters, because many masks
  // reformat on blur or change: fill() then leaves a clean value that verifies
  // fine and is mangled a moment later, once focus moves to the next field.
  // Verification alone cannot catch that, so masked boxes are typed into from
  // the start.
  const masked = await field
    .evaluate((el, hintSrc) => {
      const isHint = eval(hintSrc);
      const ph = el.getAttribute('placeholder') || '';
      const attrs = el.getAttributeNames().join(' ');
      // A mask advertises itself either as a template of placeholder
      // characters — "(___) ___-__-__" — or as a worked EXAMPLE of the format,
      // "(333) 333-33-33". Both are punctuation and digits with no real words
      // in them. Only checking for underscores missed the example form, and
      // the field was then written to with fill(), which these masks ignore.
      return isHint(ph) || /mask/i.test(attrs);
    }, FORMAT_HINT_SOURCE)
    .catch(() => false);

  if (!masked) {
    await field.fill(value);
    if (sameValue(await field.inputValue().catch(() => ''), value)) return true;
  }

  // Type it the way a person would, then blur so any on-blur formatter runs
  // before we judge the result.
  //
  // Focus is set through the element rather than by clicking it. A click runs
  // hit-testing, and these forms park a tooltip and an icon button right on
  // top of the input — the click lands on the overlay, throws, and the typing
  // then goes nowhere because the field never took focus.
  await field.fill('').catch(() => {});
  await field.evaluate((el) => el.focus()).catch(() => {});
  await typeLikeAPerson(field, value);
  await field.evaluate((el) => el.blur()).catch(() => {});

  if (sameValue(await field.inputValue().catch(() => ''), value)) return true;

  await field.fill('').catch(() => {});
  await field.evaluate((el) => {
    el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }).catch(() => {});
  return false;
}

/**
 * Last look before the page is handed back.
 *
 * A mask that reformats on blur does its damage after the field that caused
 * the blur has already been checked and recorded as filled. This sweep runs
 * once the whole page is written, so it sees the final state: anything still
 * carrying a mask placeholder is emptied and reported, rather than left
 * looking filled. Returns the labels it had to clear.
 */
export async function clearMangledFields(page) {
  const cleared = [];
  for (const field of await page.$$(TEXTUAL_FIELD_SELECTOR)) {
    const tag = await field.evaluate((el) => el.tagName.toLowerCase()).catch(() => '');
    if (tag === 'select') continue;

    const hasFocus = await field.evaluate((el) => el === document.activeElement).catch(() => false);
    if (hasFocus) continue; // they are typing in it right now

    const value = await field.inputValue().catch(() => '');
    if (!value) continue;

    // Only the SPLICE is cleared, not any value containing a placeholder.
    //
    // The splice signature is the mask template surviving with the raw text
    // stuck after it — placeholder characters, then digits:
    // "(___) ___-__-__5550000000". A partially typed number reads the other
    // way round, "(555) 000-0_-__", and that is someone's half-finished work,
    // not corruption. Clearing on any underscore deleted good phone numbers.
    const spliced = /_[^0-9]*\d/.test(value);
    if (!spliced) continue;

    const label = (await readLabel(page, field)) || 'field';
    await field.fill('').catch(() => {});
    await field.evaluate((el) => {
      el.value = '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }).catch(() => {});
    cleared.push(label);
  }
  return cleared;
}

/**
 * Choose a <select> option by what it says, not by an exact string match.
 *
 * Portals label options in ways a model will not reproduce character for
 * character — "YEMEN", "Yemen (YEM)", " Yemen". An exact-match-only attempt
 * fails silently and leaves a mandatory dropdown on "Please select...", which
 * is how Country of Nationality came back empty on a real run.
 */
async function selectOptionLoosely(field, value) {
  const fold = (v) =>
    String(v ?? '')
      .replace(/İ/g, 'i').replace(/I/g, 'i').replace(/ı/g, 'i')
      .replace(/Ş/g, 's').replace(/ş/g, 's')
      .replace(/Ğ/g, 'g').replace(/ğ/g, 'g')
      .replace(/Ü/g, 'u').replace(/ü/g, 'u')
      .replace(/Ö/g, 'o').replace(/ö/g, 'o')
      .replace(/Ç/g, 'c').replace(/ç/g, 'c')
      .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  const target = fold(value);
  if (!target) return false;

  const options = await field.evaluate((el) =>
    [...el.querySelectorAll('option')].map((o) => ({ value: o.value, text: (o.textContent || '').trim() })),
  );

  const usable = options.filter((o) => o.value && o.value !== '0' && o.text);
  let match = usable.find((o) => fold(o.text) === target);
  if (!match) {
    const partial = usable.filter((o) => fold(o.text).includes(target) || target.includes(fold(o.text)));
    // Only accept a partial hit when exactly one option matches. Two
    // candidates means we cannot tell them apart, and picking either is a
    // guess on someone's legal paperwork.
    if (partial.length === 1) match = partial[0];
  }
  if (!match) return false;

  // selectOption() runs Playwright's actionability checks, which refuse a
  // display:none element — and a <select> behind an enhanced dropdown is
  // exactly that. So it is the preferred path, with a direct assignment as the
  // fallback for the hidden case. The value being set is always one of the
  // element's own options, resolved above; nothing is invented either way.
  const clicked = await field.selectOption(match.value).then(() => true).catch(() => false);

  if (!clicked) {
    await field
      .evaluate((el, value) => {
        el.value = value;
      }, match.value)
      .catch(() => {});
  }

  // An enhanced widget shows "Please select..." until the hidden element it
  // mirrors fires change. Dispatching explicitly keeps what the applicant sees
  // in step with what the form will submit — a mismatch there is worse than an
  // empty field, because it looks correct. Harmless on a plain <select>.
  await field
    .evaluate((el) => {
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    })
    .catch(() => {});

  return sameValue(await field.inputValue().catch(() => ''), match.value);
}

/**
 * List every visible field still empty, so you know exactly what's left to
 * fill by hand instead of scrolling the form hunting for gaps.
 *
 * Only fields actually rendered on screen are listed. This form carries at
 * least one honeypot input with a randomised name, kept off-screen and
 * expected to stay empty. Listing it under "fill these yourself" would push
 * the operator into filling a trap on their own application. Omitting it is
 * not evasion — a person filling the form by hand never sees it either, and
 * the script does not touch it in any way.
 */
export async function readEmptyFields(page, opts = {}) {
  const empty = [];

  for (const field of await page.$$(TEXTUAL_FIELD_SELECTOR)) {
    // Same exemption as the fill pass, and for the same reason: a control
    // hidden behind an enhanced dropdown or a Kendo wrapper is still a real,
    // visible, mandatory field to the applicant. Without this, an unfilled
    // country dropdown was never even mentioned — the run reported nothing
    // missing while three mandatory boxes sat on "Please select...".
    const isSelectTag = await field.evaluate((el) => el.tagName.toLowerCase() === 'select').catch(() => false);
    const widget = opts.widgets ? await opts.widgets.describe(field) : null;
    const widgetOwns = Boolean(widget && widget.owns);
    const standsIn = isSelectTag || Boolean(widgetOwns && widget.visible);

    if (!(await field.isVisible().catch(() => false)) && !standsIn) continue;
    if (await field.isDisabled().catch(() => false)) continue;
    if (widgetOwns && widget.disabled) continue;

    const value = widgetOwns ? widget.value : await field.inputValue().catch(() => '');
    if (value && value.trim() && (widgetOwns || value.trim() !== '0')) continue;
    const { text, rendered } = await readLabelInfo(page, field);
    if (text && (rendered || standsIn)) empty.push(text);
  }

  // Radio groups with nothing selected.
  const groups = new Map();
  for (const radio of await page.$$('input[type=radio]:not([disabled])')) {
    if (!(await radio.isVisible().catch(() => false))) continue;
    const name = await radio.getAttribute('name').catch(() => null);
    if (!name) continue;
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(radio);
  }
  for (const [name, radios] of groups) {
    const checked = await Promise.all(radios.map((r) => r.isChecked().catch(() => false)));
    if (checked.some(Boolean)) continue;
    const optionLabels = await Promise.all(radios.map((r) => readLabel(page, r)));
    empty.push((await readGroupLabel(page, radios[0], optionLabels)) || name);
  }

  for (const fileInput of await page.$$('input[type=file]')) {
    if (!(await fileInput.isVisible().catch(() => false))) continue;
    const has = await fileInput.evaluate((el) => el.files && el.files.length > 0).catch(() => false);
    if (!has) empty.push((await readLabel(page, fileInput)) || 'Document upload');
  }

  return empty;
}

// ── Altcha proof-of-work watcher (observe only, never interfere) ───────────

/**
 * The site embeds an <altcha-widget> that fetches a challenge from
 * /altcha/challenge and solves the proof-of-work entirely in-page, then
 * stores the solution in a hidden input named "altcha". Submitting before it
 * finishes gets rejected, so we report its state: 'absent' | 'solving' |
 * 'solved'. This never touches or bypasses the widget.
 */
export async function readAltchaState(page) {
  return page
    .evaluate(() => {
      const widget = document.querySelector('altcha-widget');
      if (!widget) return { present: false, solved: false };
      const input = document.querySelector('input[name="altcha"]');
      const checkbox = document.querySelector('input[id^="altcha_checkbox_"]');
      const solved = (input && (input.value || '').length > 20) || (checkbox && checkbox.checked);
      return { present: true, solved: !!solved };
    })
    .catch(() => ({ present: false, solved: false }));
}

// ── Main ─────────────────────────────────────────────────────────────────

export async function main() {
  const applicant = loadApplicant();
  printChecklist();

  console.log('🔍 Scanning for the earliest open appointment date (live, not cached)...\n');
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  // Draw the pointer before any navigation so it survives every page load.
  await installCursor(page);

  const found = await findEarliestOpenDate(page);
  if (!found) {
    console.log(`\n❌ No day with open capacity found in the next ${MAX_MONTHS_AHEAD} months. Try again later.`);
    await browser.close();
    return;
  }
  console.log(`\n✅ Earliest date with open capacity: ${found.dateText} (${found.remaining} slots left)\n`);

  // Re-load that date's month fresh (findEarliestOpenDate may have moved on)
  // and click it — this is browsing, not submitting anything.
  await page.goto(`${BASE}/calendar/${CALENDAR_ID}?month=${found.monthParam}`, { waitUntil: 'domcontentloaded' });
  const clicked = await clickDate(page, found.iso, found.dateText);
  if (!clicked) {
    console.log(`⚠️  Could not click "${found.dateText}" automatically. The browser is open — please click it yourself.`);
  } else {
    console.log('✅ Date selected. The applicant form tab should now be open.');
  }

  console.log('\n👀 Watching the page. I will fill recognised fields as they appear.');
  console.log('   I will NEVER click Next / Continue / Apply — that\'s always your click.');
  console.log('   Close the browser window when you\'re done.\n');

  // Watch loop: on every tick, fill any newly-visible empty fields we
  // recognise and report the Altcha widget state. Never clicks anything.
  // Runs until the browser is closed.
  let lastSignature = '';
  let lastAltchaStatus = 'absent';
  let reportPending = false;
  const filledSoFar = new Set();

  while (!page.isClosed()) {
    try {
      const filled = await fillCurrentPage(page, applicant);
      for (const f of filled) {
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
          console.log('  🧩 Altcha proof-of-work is solving — wait for it to finish before clicking Next Step.');
        } else if (status === 'solved') {
          console.log('  🧩 Altcha solved ✓ — it is safe to click Next Step now.');
        }
      }

      // Print a "waiting for you" line only when the page actually changed,
      // so this isn't spamming the same message every 1.5s.
      const signature = await page.evaluate(() => document.title + '|' + location.href + '|' + document.body.innerText.length);
      if (signature !== lastSignature) {
        lastSignature = signature;
        // Report on the *next* tick, not this one. Filling a page takes a full
        // pass (text fields, then radio groups, then the upload), so auditing
        // it now would list fields that are about to be filled a moment later.
        reportPending = true;
      } else if (reportPending) {
        reportPending = false;
        await restCursor(page); // page is done — drop the highlight
        const empty = await readEmptyFields(page);
        if (empty.length) {
          console.log(`  ⚠️  Still empty (fill these yourself): ${empty.join(', ')}`);
        }
        console.log('  ⏸  Page ready for review — click Next / Apply yourself when ready.');
        console.log('     (The confirmation checkbox is yours to tick — this script never will.)');
      }
    } catch {
      // Page mid-navigation or briefly detached — just try again next tick.
    }
    // Closing the window is how you end this script, so a close landing
    // mid-wait is a normal exit, not a crash. Sleeping off-page keeps it that
    // way; the loop condition then sees the closed page and stops cleanly.
    if (page.isClosed()) break;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  console.log('\n👋 Browser closed. Nothing was submitted by this script.');
  await browser.close().catch(() => {});
}

if (IS_DIRECT_RUN) {
  main().catch((e) => {
    console.error('\n❌ Error:', e.message);
    process.exit(1);
  });
}
