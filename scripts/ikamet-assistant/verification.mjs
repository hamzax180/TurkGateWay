/**
 * The e-mail verification gate on e-İkamet, and the only safe way past it.
 *
 * The portal now mails a one-time link after the entry page and refuses to open
 * the application until it is followed. That breaks an assisted run in a way
 * that is not obvious: the token is bound to the session cookie created when
 * the e-mail was typed, so a link tapped in the applicant's phone e-mail opens
 * in a browser that has no such cookie. Best case the portal starts over; worst
 * case the one-time token is spent and the window holding their half-filled
 * application is stranded.
 *
 * So the link has to be opened in the browser that already holds the session —
 * which means the applicant hands it over rather than clicking it, and this
 * module is what receives it. Both surfaces (the CLI window and the streamed
 * server run) import from here so the markers and the host check exist once.
 */

import { fold } from './documents.mjs';

/** The only host a pasted link may point at, and the domain it must sit under. */
export const PORTAL_HOST = 'e-ikamet.goc.gov.tr';
export const PORTAL_DOMAIN = 'goc.gov.tr';

/**
 * Phrases that mean "we have mailed you something, go and get it".
 *
 * Written pre-folded, in ASCII, and tested against `fold(pageText)` — the
 * dotted capital `İ` does not case-fold onto `i`, so `/doğrulama/i` misses
 * `DOĞRULAMA`, which is how a page shouting its own heading writes it. This is
 * the same trap `documents.mjs` documents for the upload labels.
 *
 * Every entry asserts a COMPLETED SEND, or tells the applicant to go and look.
 * Nothing here matches a bare noun: "doğrulama bağlantısı" (verification link)
 * is a thing an entry page happily mentions beside its e-mail box, and a run
 * that stops there — on a form it could have filled — is worse than one that
 * never checked. Tense carries the same weight: "gönderilen" (was sent) is a
 * gate, "gönderilecek" (will be sent) is a page saying what is about to
 * happen, and every pattern ends before the suffix that separates them.
 */
export const VERIFICATION_LINK_MARKERS = [
  // Turkish
  /e-?posta adresinize gonderilen/,
  /e-?postaniza gonderilen/,
  /adresinize bir dogrulama/,
  /mailinize gonderilen/,
  /e-?postanizi kontrol/,
  /hesabinizi dogrulay/,
  // English
  /verify your e-?mail/,
  /verify your account/,
  /check your e-?mail/,
  /sent to your e-?mail/,
  /we have sent .{0,40}link/,
];

/**
 * The variant that mails a short code to type instead of a link.
 *
 * Kept apart because the two need opposite handling: a code is the applicant's
 * to type into a box that is right there, so the run pauses the ordinary way,
 * while a link needs the whole paste-back dance below. Distinguished from the
 * image CAPTCHA — which `IKAMET_NEVER_FILL` already covers with the same words
 * — by the mail context, never by "doğrulama kodu" on its own.
 */
export const VERIFICATION_CODE_MARKERS = [
  /e-?posta adresinize gonderilen dogrulama kodu/,
  /e-?postaniza gonderilen kodu?/,
  /mailinize gonderilen kodu?/,
  /verification code sent to your e-?mail/,
  /code we sent to your e-?mail/,
];

/** Masked or plain, the address the page says it wrote to. */
const ADDRESS = /[\w.*+-]+@[\w*-]+(?:\.[\w*-]+)+/;

/**
 * Every control a form could ask the applicant to fill.
 *
 * Deliberately NOT filtered on visibility. Every dropdown on this portal is a
 * Kendo widget mounted on a `display:none` input, so a visibility filter counts
 * the busiest page on the form as empty — the same trap the fill engine is
 * built around. Submit and button inputs are excluded because a wait page is
 * allowed its Resend button and still be a wait page.
 */
const FILLABLE = 'input:not([type=hidden]):not([type=submit]):not([type=button]), select, textarea';

/**
 * Is the page waiting on the applicant's inbox?
 *
 * Returns `kind: 'link'` when there is nothing to type and the run genuinely
 * cannot continue, `kind: 'code'` when a box is waiting for a short code, and
 * `present: false` for every ordinary page. `sentTo` is lifted so the prompt
 * can name the inbox rather than telling somebody with three addresses to go
 * and check all of them.
 *
 * The field count is the second opinion, and it is why this is trustworthy
 * enough to stop a run on. Wording alone can be quoted anywhere — a form that
 * explains the verification step in its help text reads exactly like the page
 * that is waiting for it. A page with a form on it is a page to fill; a link
 * gate is text, and at most the one box its Resend control sits in.
 */
export async function readVerificationGate(page) {
  const read = await page
    .evaluate((sel) => ({
      text: document.body?.innerText ?? '',
      fillable: document.querySelectorAll(sel).length,
    }), FILLABLE)
    .catch(() => null);
  if (!read) return { present: false, kind: null, sentTo: null };

  const verdict = classifyVerificationText(read.text);
  if (verdict.kind === 'link' && read.fillable > 1) {
    return { present: false, kind: null, sentTo: null };
  }
  return verdict;
}

/** The pure half of readVerificationGate, so it can be tested without a page. */
export function classifyVerificationText(text) {
  const raw = String(text ?? '');
  const folded = fold(raw);
  const absent = { present: false, kind: null, sentTo: null };
  if (!folded.trim()) return absent;

  const code = VERIFICATION_CODE_MARKERS.some((re) => re.test(folded));
  const link = VERIFICATION_LINK_MARKERS.some((re) => re.test(folded));
  if (!code && !link) return absent;

  // A page offering a code box wins over one that merely mentions a link:
  // if there is something to type, the applicant types it and the run carries
  // on, which is the cheaper of the two paths.
  return {
    present: true,
    kind: code ? 'code' : 'link',
    // Matched against the raw text — folding would mangle the address itself.
    sentTo: raw.match(ADDRESS)?.[0] ?? null,
  };
}

/**
 * Accept a pasted link, or say exactly why not.
 *
 * This check is the reason the feature is safe to offer at all. "Paste a URL
 * and we will open it" is, without it, an open redirect into a browser holding
 * somebody's part-filled residence application — and on the server, where that
 * browser sits inside our own network, a request-forgery primitive pointed at
 * whatever the paster likes. The allowlist is the whole defence, so it is
 * deliberately narrow: https, and the portal's own domain.
 *
 * `new URL` is what makes it trustworthy against the lookalikes —
 * `https://e-ikamet.goc.gov.tr@evil.example/` parses with hostname
 * `evil.example` and is refused, where a string comparison would wave it past.
 */
export function isPortalLink(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return { ok: false, reason: 'Paste the link from the e-mail first.' };

  let url;
  try {
    url = new URL(text);
  } catch {
    return {
      ok: false,
      reason: 'That is not a complete web address — copy the whole link, starting with https://',
    };
  }

  if (url.protocol !== 'https:') {
    return { ok: false, reason: 'Only https links are accepted, and the portal always sends https.' };
  }

  // The leading dot is load-bearing: without it "notgoc.gov.tr" would pass.
  const host = url.hostname.toLowerCase();
  if (host !== PORTAL_HOST && !host.endsWith(`.${PORTAL_DOMAIN}`)) {
    return { ok: false, reason: `That link points at ${host}, which is not the e-İkamet portal.` };
  }

  return { ok: true, url };
}

/**
 * Where a link goes, in a form that is safe to write down.
 *
 * The query string carries the verification token, which is a bearer
 * credential for somebody's residence application for as long as it is unused.
 * It must not reach a log file, an event feed or a screenshot, so nothing that
 * describes a link for a human ever includes it.
 */
export function describeLink(url) {
  return `${url.host}${url.pathname}`;
}

/**
 * Follow the link on the page we already hold.
 *
 * Navigating THIS page — rather than opening a new one — is the entire point:
 * the context, and so the session cookie the token was minted against, comes
 * with it. The applicant's own browser never sees the link, so the one-time
 * token is spent exactly once, in the browser that can use it.
 */
export async function resumeFromVerificationLink(page, raw) {
  const check = isPortalLink(raw);
  if (!check.ok) return check;

  try {
    await page.goto(check.url.href, { waitUntil: 'domcontentloaded' });
  } catch {
    return {
      ok: false,
      reason: 'The portal did not answer that link. If it was already opened once, press Tekrar Gönder (Resend) on the page and paste the new one.',
    };
  }

  return { ok: true, where: describeLink(check.url) };
}

/**
 * What to tell the applicant at a link gate.
 *
 * One text, used by the terminal and the streamed panel alike, because the
 * instruction that matters — COPY, do not click — is the one that decides
 * whether their token still works when it gets here.
 */
export function verificationInstructions(sentTo) {
  return [
    sentTo
      ? `e-İkamet has e-mailed a verification link to ${sentTo}.`
      : 'e-İkamet has e-mailed you a verification link.',
    'Open that e-mail and COPY the link — do not click it. It only works once, and it has to be opened here, in the browser holding your application.',
    'Already clicked it? Press Tekrar Gönder / Resend on the page, then copy the new one.',
  ];
}
