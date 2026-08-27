/**
 * browser-automation.ts
 * Runs the visa-appointment browser here, and streams it to the applicant.
 *
 * The Playwright assistant in scripts/visa-booking-assistant was written to
 * open a window on the operator's own machine. A web page cannot do that on a
 * visitor's device — nothing in a browser can spawn another browser — so this
 * runs Chromium on the server and sends the applicant a live picture of it.
 *
 * The safety model from the original script is kept, and made stricter by the
 * transport rather than weaker:
 *
 *   - The automation only ever FILLS TEXT. It has no code path that clicks
 *     anything, ticks anything, or submits anything.
 *   - Every click comes from the applicant clicking on the streamed image;
 *     the coordinate they clicked is forwarded verbatim. Nothing decides on
 *     their behalf which button to press — they press it, through a pipe.
 *   - The Mosaic-specific logic (calendar scan, field mapping, the
 *     never-operate guard) is imported from the existing script so there is
 *     one source of truth, not a second copy that can drift.
 *
 * Sessions live on globalThis so they survive HMR in development, and are
 * capped and idle-swept because each one holds a real Chromium.
 */

import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Browser, Page } from 'playwright';

/** Which site a run is driving. They share this transport and nothing else. */
export type Portal = 'visa' | 'ikamet';

/**
 * The applicant object the assistants read.
 *
 * Values are strings — passport numbers, dates, an address — with the one
 * exception that gives this its loose type: İkamet carries a `documents` map of
 * slot name to file path, exactly as the CLI's `applicant.json` does.
 */
export type ApplicantData = Record<string, unknown>;

export type RunStatus =
  | 'starting'
  | 'searching'
  | 'filling'
  | 'waiting_for_you'
  /**
   * e-İkamet has mailed a one-time verification link and will not open the
   * application until it is followed. Distinct from `waiting_for_you` because
   * the two ask for completely different things: one says press the button in
   * front of you, this one says fetch something from your inbox and hand it
   * over. Reporting a gate as `waiting_for_you` tells the applicant to press a
   * button that cannot advance — which is what the run did before.
   */
  | 'waiting_for_email_link'
  | 'finished'
  | 'failed';

export type RunEvent = { at: number; text: string };

type Run = {
  id: string;
  userId: number;
  applicationId: number;
  portal: Portal;
  status: RunStatus;
  events: RunEvent[];
  /** Latest JPEG frame, base64, refreshed by the capture loop. */
  frame: string | null;
  frameAt: number;
  viewport: { width: number; height: number };
  filled: string[];
  error: string | null;
  browser: Browser | null;
  page: Page | null;
  /** Chrome DevTools session driving the screencast. */
  cdp: { detach: () => Promise<void> } | null;
  /** Set when the screencast is running, so no polling loop is started. */
  liveCapture: boolean;
  /** The address e-İkamet says it mailed the link to, so the prompt names it. */
  emailSentTo: string | null;
  /** Bounded, so a pasted link can never become an unlimited fetch primitive. */
  linkNavigations: number;
  /** Scratch directory holding the applicant's scans for this run only. */
  tempDir: string | null;
  lastTouched: number;
  stopping: boolean;
};

type State = { runs: Map<string, Run> };

const g = globalThis as unknown as { __automationRuns?: State };
if (!g.__automationRuns) g.__automationRuns = { runs: new Map() };
const state = g.__automationRuns;

const VIEWPORT = { width: 1280, height: 800 };
/**
 * Fallback capture rate, used only if the screencast cannot be started.
 * The screencast itself is event-driven and pushes a frame whenever Chrome
 * repaints, which is what makes the view feel live rather than a slideshow.
 */
const FALLBACK_FRAME_MS = 500;
const IDLE_TIMEOUT_MS = 10 * 60_000;
/**
 * The same sweep, relaxed while a run is waiting on somebody's inbox.
 *
 * Ten minutes is a fair definition of abandoned for a form nobody is typing
 * into. It is not a fair one for a person who has been told to go and find an
 * e-mail: they close the panel, open their mail on a phone, and come back to a
 * browser that has been reaped along with the session their half-filled
 * application lives in. Losing that costs them the whole entry page and a
 * verification token.
 */
const EMAIL_GATE_TIMEOUT_MS = 30 * 60_000;
/** Beyond this, a paste box has stopped being a resume and become a fetcher. */
const MAX_LINK_NAVIGATIONS = 10;
const MAX_CONCURRENT = 3;
const MAX_EVENTS = 60;
/**
 * How many times to go over an İkamet page before calling it done. Mirrors the
 * CLI's own ceiling and for the same reason: the portal's dropdowns are backed
 * by remote data that is still in flight when the page first settles, so one
 * pass legitimately cannot fill them. Passes skip anything already filled, and
 * the loop stops as soon as one changes nothing.
 */
const IKAMET_FILL_PASSES = 5;

/**
 * Import the existing assistant at runtime.
 *
 * `new Function` keeps the bundler from following the path: the script lives
 * outside src/, is plain ESM, and must stay the single definition of how the
 * Mosaic form is read and filled.
 */
const runtimeImport = new Function('p', 'return import(p)') as (p: string) => Promise<any>;

function script(...parts: string[]) {
  return runtimeImport(pathToFileURL(join(process.cwd(), 'scripts', ...parts)).href);
}

/** The visa assistant, which is also the shared filling engine. */
async function loadAssistant() {
  return script('visa-booking-assistant', 'find-slot.mjs');
}

/**
 * The İkamet assistant, in the pieces this needs.
 *
 * `run.mjs` is the CLI entry point, but importing it runs nothing: its `main()`
 * is behind an `IS_DIRECT_RUN` guard, so what arrives here is the portal URLs,
 * the engine options and the document matcher — the İkamet-specific half — with
 * the filling engine itself still coming from the visa assistant. One
 * definition of each, exactly as the CLI has it.
 */
async function loadIkametAssistant() {
  const [ikamet, documents, verification, cursor, engine] = await Promise.all([
    script('ikamet-assistant', 'run.mjs'),
    script('ikamet-assistant', 'documents.mjs'),
    script('ikamet-assistant', 'verification.mjs'),
    script('visa-booking-assistant', 'cursor-overlay.mjs'),
    loadAssistant(),
  ]);
  return { ikamet, documents, verification, cursor, engine };
}

/** Just the link half, for a resume — no need to pull in the whole assistant. */
async function loadVerification() {
  return script('ikamet-assistant', 'verification.mjs');
}

function log(run: Run, text: string) {
  run.events.push({ at: Date.now(), text });
  if (run.events.length > MAX_EVENTS) run.events.shift();
}

export function getRun(id: string, userId: number): Run | null {
  const run = state.runs.get(id);
  if (!run || run.userId !== userId) return null;
  return run;
}

/** Public shape — never leaks the Browser/Page handles to a route. */
export function describeRun(run: Run) {
  return {
    id: run.id,
    portal: run.portal,
    status: run.status,
    events: run.events,
    filled: run.filled,
    error: run.error,
    viewport: run.viewport,
    frameAt: run.frameAt,
    emailSentTo: run.emailSentTo,
    /** True when Chrome's screencast is driving frames rather than the
        fallback screenshot timer — worth surfacing, because the difference
        between the two is the difference between live and a slideshow. */
    liveCapture: run.liveCapture,
  };
}

export function latestFrame(run: Run) {
  return run.frame;
}

async function closeRun(run: Run) {
  run.stopping = true;
  try {
    await run.cdp?.detach().catch(() => {});
    await run.page?.close().catch(() => {});
    await run.browser?.close().catch(() => {});
  } finally {
    run.cdp = null;
    run.page = null;
    run.browser = null;
    // The scans are the applicant's passport, their insurance policy and their
    // address — written to disk only because Playwright hands over a path, not
    // bytes. They go when the run does. An İkamet run writes up to six of them
    // where the visa run wrote one, so leaving them is no longer a rounding
    // error either.
    if (run.tempDir) {
      const dir = run.tempDir;
      run.tempDir = null;
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

export async function stopRun(id: string, userId: number) {
  const run = getRun(id, userId);
  if (!run) return false;
  log(run, 'Stopped by you.');
  run.status = 'finished';
  await closeRun(run);
  state.runs.delete(id);
  return true;
}

/** Reap runs nobody is watching any more — each one is a live Chromium. */
function sweep() {
  const now = Date.now();
  for (const [id, run] of state.runs) {
    const limit =
      run.status === 'waiting_for_email_link' ? EMAIL_GATE_TIMEOUT_MS : IDLE_TIMEOUT_MS;
    if (now - run.lastTouched > limit) {
      closeRun(run);
      state.runs.delete(id);
    }
  }
}

export function touchRun(run: Run) {
  run.lastTouched = Date.now();
}

/**
 * Forward one click from the applicant to the real page.
 *
 * This is the ONLY thing in this module that operates a control, and it does
 * nothing of its own accord — the coordinate comes from the applicant clicking
 * the picture. `Next`, `Apply` and the confirmation checkbox are therefore
 * pressed by the person, exactly as they would be on their own screen.
 */
export async function forwardClick(run: Run, x: number, y: number) {
  if (!run.page || run.page.isClosed()) return;
  const cx = Math.max(0, Math.min(run.viewport.width, Math.round(x)));
  const cy = Math.max(0, Math.min(run.viewport.height, Math.round(y)));
  await run.page.mouse.click(cx, cy).catch(() => {});
  touchRun(run);
}

/** Forward typing, for anything the applicant wants to correct themselves. */
export async function forwardType(run: Run, text: string) {
  if (!run.page || run.page.isClosed()) return;
  await run.page.keyboard.type(text.slice(0, 200), { delay: 25 }).catch(() => {});
  touchRun(run);
}

export async function forwardKey(run: Run, key: string) {
  if (!run.page || run.page.isClosed()) return;
  const allowed = new Set(['Enter', 'Tab', 'Backspace', 'ArrowLeft', 'ArrowRight', 'Escape']);
  if (!allowed.has(key)) return;
  await run.page.keyboard.press(key).catch(() => {});
  touchRun(run);
}

/**
 * Follow the verification link the applicant pasted.
 *
 * The link is opened on the page this run already holds, which is the whole
 * point: the token e-İkamet mailed is bound to the session cookie created when
 * the e-mail was typed, and that cookie lives here. Opened anywhere else — the
 * applicant's phone, their own browser — it lands in a session that does not
 * have it, and a one-time token is gone.
 *
 * Validation happens HERE, on the server, never in the panel that posted it.
 * The client's opinion of a safe URL is the attacker's opinion of a safe URL:
 * unchecked, this is a request forgery primitive aimed at whatever the paster
 * likes, running inside our own network. `isPortalLink` is the whole defence,
 * and the navigation cap keeps a valid-looking host from becoming a crawler.
 */
export async function resumeWithLink(
  run: Run,
  raw: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!run.page || run.page.isClosed()) {
    return { ok: false, reason: 'This automation is no longer running.' };
  }
  if (run.linkNavigations >= MAX_LINK_NAVIGATIONS) {
    return { ok: false, reason: 'Too many link attempts on this run. Start it again.' };
  }

  let verification: any;
  try {
    verification = await loadVerification();
  } catch {
    return { ok: false, reason: 'Could not check that link on the server.' };
  }

  run.linkNavigations += 1;
  const result = await verification.resumeFromVerificationLink(run.page, raw);
  if (!result.ok) return { ok: false, reason: result.reason };

  // `where` is host and path only — the token sits in the query string, where
  // it stays. An event feed is shown, logged and screenshotted.
  log(run, `Opened the verification link (${result.where}). Continuing your application…`);
  run.status = 'filling';
  run.emailSentTo = null;
  touchRun(run);
  return { ok: true };
}

/**
 * Start a run: open the portal and keep the applicant's details typed into
 * whatever page is on screen.
 *
 * Two sites, one transport. The visa run hunts a calendar for an open date;
 * the İkamet run walks a multi-page form and attaches documents. Everything
 * between them and the applicant — the browser, the screencast, the forwarded
 * clicks, the never-operate promise — is the same, which is the point: the
 * applicant presses every button on either site, through the same picture.
 *
 * Returns as soon as the browser is up; the rest continues in the background
 * and is observed through the frame stream.
 */
export async function startRun(opts: {
  userId: number;
  applicationId: number;
  portal: Portal;
  applicant: ApplicantData;
  /** Where the run opens. The İkamet form differs for a first vs an extension. */
  targetUrl?: string;
  documentPath?: string | null;
  /** Scratch directory holding this run's scans, removed when it closes. */
  tempDir?: string | null;
}): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  sweep();
  if (state.runs.size >= MAX_CONCURRENT) {
    return { ok: false, reason: 'Too many automations are running right now. Try again in a few minutes.' };
  }

  const id = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const run: Run = {
    id,
    userId: opts.userId,
    applicationId: opts.applicationId,
    portal: opts.portal,
    status: 'starting',
    events: [],
    frame: null,
    frameAt: 0,
    viewport: VIEWPORT,
    filled: [],
    error: null,
    browser: null,
    page: null,
    cdp: null,
    liveCapture: false,
    emailSentTo: null,
    linkNavigations: 0,
    tempDir: opts.tempDir ?? null,
    lastTouched: Date.now(),
    stopping: false,
  };
  state.runs.set(id, run);

  let assistant: any;
  let ikametKit: Awaited<ReturnType<typeof loadIkametAssistant>> | null = null;
  let chromium: typeof import('playwright').chromium;
  try {
    if (opts.portal === 'ikamet') {
      ikametKit = await loadIkametAssistant();
      assistant = ikametKit.engine;
    } else {
      assistant = await loadAssistant();
    }
    ({ chromium } = await import('playwright'));
  } catch {
    run.status = 'failed';
    run.error = 'The automation could not be loaded on the server.';
    await closeRun(run);
    state.runs.delete(id);
    return { ok: false, reason: run.error };
  }

  log(run, opts.portal === 'ikamet' ? 'Opening e-İkamet…' : 'Opening the appointment site…');

  try {
    // Headless on the server: the applicant sees the stream, not a window.
    // Headless Chrome treats itself as a background tab and throttles both
    // timers and compositing, which starves the screencast of frames — these
    // switches keep it rendering as if it were the foreground window.
    run.browser = await chromium.launch({
      headless: true,
      args: [
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
      ],
    });
    const context = await run.browser.newContext({ viewport: VIEWPORT });
    run.page = await context.newPage();
  } catch {
    run.status = 'failed';
    run.error = 'Could not start a browser on the server.';
    await closeRun(run);
    state.runs.delete(id);
    return { ok: false, reason: run.error };
  }

  /**
   * Frames, the smooth way.
   *
   * Taking a full screenshot on a timer produced about one frame a second and
   * looked like a slideshow — typing and scrolling arrived in visible jumps.
   * Chrome's screencast pushes a frame whenever the page actually repaints, so
   * an idle page costs nothing and an active one streams at video-ish rates.
   */
  let capture: ReturnType<typeof setInterval> | null = null;

  try {
    const cdp = await run.page.context().newCDPSession(run.page);
    run.cdp = cdp as unknown as { detach: () => Promise<void> };

    cdp.on('Page.screencastFrame', async (payload: { data: string; sessionId: number }) => {
      run.frame = payload.data;
      run.frameAt = Date.now();
      // Chrome pauses the stream until each frame is acknowledged.
      await cdp.send('Page.screencastFrameAck', { sessionId: payload.sessionId }).catch(() => {});
    });

    await cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 60,
      maxWidth: VIEWPORT.width,
      maxHeight: VIEWPORT.height,
      everyNthFrame: 1,
    });
    run.liveCapture = true;
  } catch {
    // Screencast unavailable — fall back to periodic screenshots so the
    // applicant still sees something rather than a blank panel.
    capture = setInterval(async () => {
      const page = run.page;
      if (!page || page.isClosed() || run.stopping) return;
      try {
        const shot = await page.screenshot({ type: 'jpeg', quality: 55 });
        run.frame = Buffer.from(shot).toString('base64');
        run.frameAt = Date.now();
      } catch {
        /* mid-navigation screenshots fail harmlessly */
      }
    }, FALLBACK_FRAME_MS);
  }

  // The work itself, in the background.
  (async () => {
    try {
      if (opts.portal === 'ikamet') {
        await driveIkametRun(run, ikametKit!, opts.applicant, opts.targetUrl ?? '');
      } else {
        await driveVisaRun(run, assistant, opts.applicant);
      }
    } catch (e) {
      run.status = 'failed';
      run.error = e instanceof Error ? e.message : 'The automation stopped unexpectedly.';
      log(run, `Stopped: ${run.error}`);
    } finally {
      if (capture) clearInterval(capture);
      // Forget this applicant's field answers. They are keyed per applicant so
      // they cannot leak between people, but a retry after a correction must
      // re-ask rather than replay the answers that were wrong the first time —
      // and there is no reason to hold someone's passport number in memory
      // once their run is over.
      try {
        assistant.resetFieldCache?.(opts.applicant);
      } catch {
        /* older builds of the script have no cache to reset */
      }
      if (!run.stopping) await closeRun(run);
    }
  })();

  return { ok: true, id };
}

/**
 * The visa appointment: find an open date, select it, then keep filling.
 */
async function driveVisaRun(run: Run, assistant: any, applicant: ApplicantData) {
  const page = run.page!;

  run.status = 'searching';
  log(run, 'Looking for the earliest date with open capacity…');

  const found = await assistant.findEarliestOpenDate(page);
  if (!found) {
    log(run, `No open day in the next ${assistant.MAX_MONTHS_AHEAD} months.`);
    run.status = 'finished';
    return;
  }

  log(run, `Earliest open date: ${found.dateText} (${found.remaining} left).`);
  await page.goto(`${assistant.BASE}/calendar/${assistant.CALENDAR_ID}?month=${found.monthParam}`, {
    waitUntil: 'domcontentloaded',
  });

  const clicked = await assistant.clickDate(page, found.iso, found.dateText);
  log(run, clicked ? 'Date selected — the form is open.' : `Could not select ${found.dateText}; pick it yourself on screen.`);

  run.status = 'filling';
  log(run, 'Filling your details. I will never press Next, Apply or tick anything.');

  // Per-page state. The form is a wizard: clicking Next replaces the whole
  // page, and the next one asks for different things. Tracking "already
  // filled" across that boundary made page two look finished the moment a
  // field repeated a label from page one — so the run announced "your turn"
  // while it was still working, and never reported what page two needed.
  let seen = new Set<string>();
  let idleRounds = 0;
  let lastSignature = '';
  let pageNumber = 1;

  while (!page.isClosed() && !run.stopping) {
    try {
      // Detect the page change first, so the fill below is judged against
      // this page rather than the last one.
      const signature: string = await page
        .evaluate(() => document.title + '|' + location.href + '|' + document.body.innerText.length)
        .catch(() => lastSignature);

      if (signature !== lastSignature) {
        if (lastSignature) {
          pageNumber += 1;
          log(run, `Next page — filling step ${pageNumber}…`);
        }
        lastSignature = signature;
        seen = new Set<string>();
        idleRounds = 0;
        run.status = 'filling';
      }

      const justFilled: string[] = await assistant.fillCurrentPage(page, applicant);
      let changed = false;
      for (const field of justFilled) {
        if (seen.has(field)) continue;
        seen.add(field);
        run.filled.push(field);
        log(run, `Filled ${field}.`);
        changed = true;
      }

      if (changed) {
        idleRounds = 0;
        run.status = 'filling';
      } else if (++idleRounds > 2) {
        // Nothing left this script can type here: it is the applicant's
        // move. Name what is still blank — on later pages that is the only
        // way to tell "done" from "could not fill it".
        if (run.status !== 'waiting_for_you') {
          run.status = 'waiting_for_you';
          const empty: string[] = await assistant.readEmptyFields(page).catch(() => []);
          log(
            run,
            empty.length
              ? `Your turn. Still blank on this page: ${empty.slice(0, 6).join(', ')}${empty.length > 6 ? '…' : ''}`
              : 'Your turn — review the page and click Next yourself.',
          );
        }
      }

      const altcha = await assistant.readAltchaState(page).catch(() => null);
      if (altcha?.present && !altcha.solved) log(run, 'Waiting for the site’s Altcha check to finish…');
    } catch {
      /* the page navigated under us; the next round picks it up */
    }
    await new Promise((r) => setTimeout(r, assistant.POLL_INTERVAL_MS ?? 1500));
  }
}

/**
 * e-İkamet: attach the documents, fill each page, and stop at every gate.
 *
 * The same shape as the CLI assistant's loop, because it is the same portal
 * with the same traps — pages identified by their field names rather than their
 * text length, a budget of passes per page because the dropdowns arrive from
 * the server after the page settles, and a report at each pause that separates
 * "could not fill this" from "this one is yours by design".
 *
 * What is new is the e-mail gate. It is tested only once a page has SETTLED —
 * after the fill passes have stopped changing anything — and never before. A
 * form that explains the verification step in its own help text reads like the
 * page that is waiting for it, and stopping on that would strand the applicant
 * on a page the assistant could have filled.
 */
async function driveIkametRun(
  run: Run,
  kit: Awaited<ReturnType<typeof loadIkametAssistant>>,
  applicant: ApplicantData,
  targetUrl: string,
) {
  const page = run.page!;
  const { ikamet, documents, verification, cursor, engine } = kit;

  await cursor.installCursor(page).catch(() => {});
  await page
    .goto(targetUrl || ikamet.FIRST_URL, { waitUntil: 'domcontentloaded' })
    .catch(() => {
      log(run, 'Could not open e-İkamet directly — navigate there on the page above.');
    });

  run.status = 'filling';
  log(run, 'Filling your details. I never press İleri, Kaydet or Başvuru Yap, and never tick the beyan box — those are yours.');

  let lastSignature = '';
  let passesLeft = 0;
  let lastGaps: string | null = null;
  let announced = true;
  let pageNumber = 0;
  let seen = new Set<string>();

  while (!page.isClosed() && !run.stopping) {
    try {
      // Identify the page by its FORM, not by its text length: a tooltip or a
      // validation note changes the text without changing the step, and every
      // such flicker used to read as a new page and re-run the filler over
      // somebody mid-sentence.
      const signature: string = await page
        .evaluate(() => {
          const sel = 'input:not([type=hidden]):not([type=submit]):not([type=button]), select, textarea';
          const names = [...document.querySelectorAll(sel)]
            .map((el) => el.getAttribute('name') || el.id || el.tagName)
            .join(',');
          return document.title + '|' + location.href + '|' + names;
        })
        .catch(() => lastSignature);

      if (signature !== lastSignature) {
        lastSignature = signature;
        pageNumber += 1;
        if (pageNumber > 1) log(run, `Next page — filling step ${pageNumber}…`);

        const { attached, unmatched } = await ikamet.attachDocuments(page, applicant);
        for (const a of attached) log(run, `Attached ${a}`);
        // Never a guess: a slot whose label matches two documents, or none, is
        // left empty and named. The wrong scan in the wrong slot is a rejected
        // application weeks later, not a cosmetic mistake.
        for (const u of unmatched) log(run, `Upload left for you: ${u}`);

        passesLeft = IKAMET_FILL_PASSES;
        lastGaps = null;
        announced = false;
        seen = new Set<string>();
        run.status = 'filling';
      }

      if (passesLeft > 0) {
        passesLeft -= 1;

        const filled: string[] = await engine.fillCurrentPage(
          page,
          applicant,
          ikamet.IKAMET_ENGINE_OPTS,
        );
        for (const field of filled) {
          if (seen.has(field)) continue;
          seen.add(field);
          run.filled.push(field);
          log(run, `Filled ${field}.`);
        }

        // Masks that reformat on blur mangle a value after it was checked, so
        // the final state gets one more look before the applicant is asked to
        // review it.
        const cleared: string[] = await engine.clearMangledFields(page).catch(() => []);
        for (const c of cleared) {
          log(run, `${c}: the box reformatted what was typed — please enter it yourself.`);
        }

        const empty: string[] = await engine
          .readEmptyFields(page, ikamet.IKAMET_ENGINE_OPTS)
          .catch(() => []);
        const gaps = empty.join('|');

        // Settled: this pass wrote nothing and left the same gaps as the last.
        // Another identical pass would only repeat itself.
        if (!filled.length && !cleared.length && gaps === lastGaps) passesLeft = 0;
        lastGaps = gaps;

        if (passesLeft === 0 && !announced) {
          announced = true;
          await cursor.restCursor(page).catch(() => {});

          const gate = await verification.readVerificationGate(page).catch(() => null);
          if (gate?.present && gate.kind === 'link') {
            run.status = 'waiting_for_email_link';
            run.emailSentTo = gate.sentTo ?? null;
            for (const line of verification.verificationInstructions(gate.sentTo)) log(run, line);
          } else {
            // Two different things, reported separately. A box that is the
            // applicant's by design is not a failure, and burying the ones the
            // assistant could not fill in the same list as the CAPTCHA is how a
            // genuinely missed dropdown goes unnoticed.
            const yours = empty.filter((label) => documents.isYoursByDesign(label));
            const missed = empty.filter((label) => !documents.isYoursByDesign(label));

            run.status = 'waiting_for_you';
            log(
              run,
              missed.length
                ? `Could not fill (please check these): ${missed.slice(0, 6).join(', ')}${missed.length > 6 ? '…' : ''}`
                : 'Every field I can fill on this page is filled.',
            );
            if (yours.length) log(run, `Yours to enter: ${yours.join(', ')}`);
            if (gate?.kind === 'code') {
              log(run, 'The code in that e-mail goes in the box on the page — type it above.');
            }
            log(run, 'Review the page, then press İleri / Kaydet yourself.');
          }
        }
      }
    } catch {
      /* the page navigated under us; the next round picks it up */
    }
    await new Promise((r) => setTimeout(r, engine.POLL_INTERVAL_MS ?? 1500));
  }
}
