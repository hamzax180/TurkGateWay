/**
 * cursor-overlay.mjs
 * A visible cursor for the booking assistant.
 *
 * Playwright fills fields instantly and invisibly — values simply appear, with
 * no indication of what touched them or in what order. That is a poor thing to
 * watch when the form holds someone's passport details and you are the person
 * responsible for checking them before clicking Next.
 *
 * This draws a pointer that travels to each field before it is filled, rings
 * the field, and names what it is about to enter. Nothing here changes what
 * gets filled; it only makes the filling legible. It is decoration in the page,
 * never a form control, and it is removed from nothing the site reads.
 *
 * Disable with VISA_SHOW_CURSOR=0 if you would rather it ran silently.
 */

export const CURSOR_ENABLED = process.env.VISA_SHOW_CURSOR !== '0';

/** How long the pointer takes to travel, and how long it rests on arrival. */
const TRAVEL_MS = 420;
const DWELL_MS = 140;

/**
 * Injected into every page. Guarded so re-injection is harmless, and defers
 * until <body> exists because addInitScript runs before the document is built.
 */
const OVERLAY_SOURCE = `
(() => {
  const build = () => {
    // Presence of the element is the only reliable guard. A boolean flag on
    // window outlives the DOM: a page that swaps out its body keeps the flag
    // set while the overlay itself is gone, and the pointer never comes back.
    if (!document.body || document.getElementById('__visa-cursor')) return;

    const style = document.createElement('style');
    style.textContent = \`
      #__visa-cursor, #__visa-ring, #__visa-label {
        position: fixed;
        z-index: 2147483647;
        pointer-events: none;
        will-change: transform;
      }
      #__visa-cursor {
        top: 0; left: 0;
        width: 26px; height: 26px;
        margin: -2px 0 0 -2px;
        transition: transform ${TRAVEL_MS}ms cubic-bezier(0.22, 0.61, 0.36, 1);
        filter: drop-shadow(0 2px 5px rgba(0,0,0,0.35));
      }
      #__visa-ring {
        border: 2px solid #f97316;
        border-radius: 6px;
        background: rgba(249, 115, 22, 0.10);
        opacity: 0;
        transition: all ${TRAVEL_MS}ms cubic-bezier(0.22, 0.61, 0.36, 1);
      }
      #__visa-ring.on { opacity: 1; }
      @keyframes __visa-pulse {
        0%   { box-shadow: 0 0 0 0 rgba(249, 115, 22, 0.45); }
        100% { box-shadow: 0 0 0 10px rgba(249, 115, 22, 0); }
      }
      #__visa-ring.pulse { animation: __visa-pulse 620ms ease-out; }
      #__visa-label {
        top: 0; left: 0;
        max-width: 320px;
        padding: 5px 10px;
        border-radius: 999px;
        background: #f97316;
        color: #fff;
        font: 600 12px/1.35 ui-sans-serif, system-ui, -apple-system, sans-serif;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        opacity: 0;
        transition: opacity 180ms ease, transform ${TRAVEL_MS}ms cubic-bezier(0.22, 0.61, 0.36, 1);
        box-shadow: 0 2px 8px rgba(0,0,0,0.22);
      }
      #__visa-label.on { opacity: 1; }
      @media (prefers-reduced-motion: reduce) {
        #__visa-cursor, #__visa-ring, #__visa-label { transition-duration: 1ms; }
        #__visa-ring.pulse { animation: none; }
      }
    \`;
    document.head.appendChild(style);

    const cursor = document.createElement('div');
    cursor.id = '__visa-cursor';
    cursor.innerHTML =
      '<svg viewBox="0 0 24 24" width="26" height="26" xmlns="http://www.w3.org/2000/svg">' +
      '<path d="M5 2.5 L5 19.2 L9.3 15.2 L12.2 21.5 L15.1 20.1 L12.3 14 L18 13.6 Z" ' +
      'fill="#f97316" stroke="#ffffff" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    document.body.appendChild(cursor);

    const ring = document.createElement('div');
    ring.id = '__visa-ring';
    document.body.appendChild(ring);

    const label = document.createElement('div');
    label.id = '__visa-label';
    document.body.appendChild(label);

    let x = window.innerWidth / 2;
    let y = 40;
    cursor.style.transform = 'translate(' + x + 'px,' + y + 'px)';

    window.__visaCursor = {
      /** Move the pointer to a field, ring it, and name what is going in. */
      point(rect, text) {
        x = rect.left + Math.min(rect.width - 8, 14);
        y = rect.top + rect.height / 2;
        cursor.style.transform = 'translate(' + x + 'px,' + y + 'px)';

        ring.style.left = rect.left - 3 + 'px';
        ring.style.top = rect.top - 3 + 'px';
        ring.style.width = rect.width + 6 + 'px';
        ring.style.height = rect.height + 6 + 'px';
        ring.classList.add('on');
        ring.classList.remove('pulse');
        void ring.offsetWidth;   // restart the animation
        ring.classList.add('pulse');

        if (text) {
          label.textContent = text;
          // Prefer above the field; drop below when there is no room.
          const above = rect.top > 34;
          label.style.transform =
            'translate(' + Math.max(6, rect.left) + 'px,' +
            (above ? rect.top - 30 : rect.bottom + 8) + 'px)';
          label.classList.add('on');
        } else {
          label.classList.remove('on');
        }
      },
      /** Fade the highlight out once a page is finished. */
      rest() {
        ring.classList.remove('on');
        label.classList.remove('on');
      },
    };
  };

  // Exposed so the driver can re-run it before each move — cheap when the
  // overlay is already there, and the repair when a page has replaced its DOM.
  window.__visaEnsureCursor = build;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build, { once: true });
  } else {
    build();
  }
})();
`;

/**
 * Install on a page and on every page it navigates to. addInitScript covers
 * future navigations; the direct evaluate covers the page already loaded.
 */
export async function installCursor(page) {
  if (!CURSOR_ENABLED) return;
  await page.addInitScript(OVERLAY_SOURCE).catch(() => {});
  await page.evaluate(OVERLAY_SOURCE).catch(() => {});
}

/**
 * Walk the pointer to `element` and announce `text`, then pause just long
 * enough for a person to follow it. Silently does nothing when disabled or if
 * the element has gone — the fill itself must never depend on the decoration.
 */
export async function pointAt(page, element, text) {
  if (!CURSOR_ENABLED) return;
  try {
    await element.scrollIntoViewIfNeeded({ timeout: 1000 });
    const box = await element.boundingBox();
    if (!box) return;
    await pointAtRect(page, { left: box.x, top: box.y, width: box.width, height: box.height }, text);
  } catch {
    // Decoration only — never let it break or delay the actual fill.
  }
}

/**
 * Point at a rectangle rather than an element.
 *
 * Some controls are not the element being filled. A Kendo dropdown hides its
 * real input and paints a wrapper over it, so `boundingBox()` on the thing
 * receiving the value returns nothing and the cursor silently skipped the
 * three most interesting fields on the İkamet form. The caller that knows
 * where the visible control is can say so directly.
 *
 * The rect is viewport-relative, matching both `boundingBox()` and the
 * fixed-position overlay it feeds.
 */
export async function pointAtRect(page, rect, text) {
  if (!CURSOR_ENABLED || !rect) return;
  try {
    await page.evaluate(
      ({ rect, label }) => {
        // Rebuild first if the page swapped its DOM out from under us.
        if (window.__visaEnsureCursor) window.__visaEnsureCursor();
        if (window.__visaCursor) window.__visaCursor.point(rect, label);
      },
      { rect, label: text },
    );
    await page.waitForTimeout(TRAVEL_MS + DWELL_MS);
  } catch {
    // Decoration only — never let it break or delay the actual fill.
  }
}

/** Drop the highlight once a page is done being filled. */
export async function restCursor(page) {
  if (!CURSOR_ENABLED) return;
  await page
    .evaluate(() => window.__visaCursor && window.__visaCursor.rest())
    .catch(() => {});
}
