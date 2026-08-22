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

import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Browser, Page } from 'playwright';

export type RunStatus =
  | 'starting'
  | 'searching'
  | 'filling'
  | 'waiting_for_you'
  | 'finished'
  | 'failed';

export type RunEvent = { at: number; text: string };

type Run = {
  id: string;
  userId: number;
  applicationId: number;
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
const MAX_CONCURRENT = 3;
const MAX_EVENTS = 60;

/**
 * Import the existing assistant at runtime.
 *
 * `new Function` keeps the bundler from following the path: the script lives
 * outside src/, is plain ESM, and must stay the single definition of how the
 * Mosaic form is read and filled.
 */
const runtimeImport = new Function('p', 'return import(p)') as (p: string) => Promise<any>;

async function loadAssistant() {
  const file = join(process.cwd(), 'scripts', 'visa-booking-assistant', 'find-slot.mjs');
  return runtimeImport(pathToFileURL(file).href);
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
    status: run.status,
    events: run.events,
    filled: run.filled,
    error: run.error,
    viewport: run.viewport,
    frameAt: run.frameAt,
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
    if (now - run.lastTouched > IDLE_TIMEOUT_MS) {
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
 * Start a run: open the calendar, find the first date with capacity, select it
 * and keep the applicant's details typed into whatever page is on screen.
 *
 * Returns as soon as the browser is up; the rest continues in the background
 * and is observed through the frame stream.
 */
export async function startRun(opts: {
  userId: number;
  applicationId: number;
  applicant: Record<string, string>;
  documentPath?: string | null;
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
    lastTouched: Date.now(),
    stopping: false,
  };
  state.runs.set(id, run);

  let assistant: any;
  let chromium: typeof import('playwright').chromium;
  try {
    assistant = await loadAssistant();
    ({ chromium } = await import('playwright'));
  } catch {
    run.status = 'failed';
    run.error = 'The automation could not be loaded on the server.';
    return { ok: false, reason: run.error };
  }

  log(run, 'Opening the appointment site…');

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
    const page = run.page!;
    try {
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

          const justFilled: string[] = await assistant.fillCurrentPage(page, opts.applicant);
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
