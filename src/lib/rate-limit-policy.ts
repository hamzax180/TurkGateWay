/**
 * rate-limit-policy.ts
 * Which ceiling applies to which route.
 *
 * One table rather than a call in each of 52 handlers. The point is that a
 * route added tomorrow is metered by the `default` tier without anyone
 * remembering to wire it up — the previous arrangement covered 4 routes out of
 * 52, which is the failure mode this design is built to avoid.
 *
 * Tiers are sized by what a request *costs us*, not by how it feels:
 * launching a headless browser or running a document through a vision model is
 * worth orders of magnitude more than reading a row, so they are metered
 * orders of magnitude tighter.
 *
 * Matching is first-wins and ordered most-specific to least, so `exempt` and
 * the narrow paths sit above the broad prefixes.
 */

export interface Tier {
  name: string;
  /** Requests per minute. */
  perMinute: number;
  /**
   * Optional daily ceiling, for the tiers where a minute limit alone still
   * allows a ruinous bill — 20/minute of Qwen calls sustained for a day is
   * nearly 29,000 completions.
   */
  perDay?: number;
}

export const TIERS = {
  browser:   { name: 'browser',   perMinute: 3,   perDay: 20 },
  vision:    { name: 'vision',    perMinute: 10,  perDay: 60 },
  llm:       { name: 'llm',       perMinute: 20,  perDay: 300 },
  // Realtime bills per MINUTE OF AUDIO, not per request, so the meaningful
  // ceiling is on how many calls a person may open — not on how fast they may
  // ask. Five session mints a minute is already generous for a human placing
  // one call; the daily cap is what actually bounds the bill.
  voice:     { name: 'voice',     perMinute: 5,   perDay: 40 },
  // TTS is per-sentence during a call, so it needs real headroom inside a
  // session while still being far below the `default` it used to inherit.
  voiceTts:  { name: 'voiceTts',  perMinute: 60,  perDay: 1_500 },
  auth:      { name: 'auth',      perMinute: 10 },
  authLight: { name: 'authLight', perMinute: 30 },
  poll:      { name: 'poll',      perMinute: 120 },
  write:     { name: 'write',     perMinute: 30 },
  read:      { name: 'read',      perMinute: 120 },
  admin:     { name: 'admin',     perMinute: 60 },
  default:   { name: 'default',   perMinute: 60 },
} as const satisfies Record<string, Tier>;

type Rule = {
  pattern: RegExp;
  /** Restrict the rule to these methods; omit to match any. */
  methods?: readonly string[];
  /** null means exempt — no limiting at all. */
  tier: Tier | null;
};

const RULES: readonly Rule[] = [
  // ── Exempt ───────────────────────────────────────────────────────────────
  // The payment provider retries webhooks; a 429 here loses money. Its real
  // protection is a signature check, which it does not currently have.
  { pattern: /^\/payment\/webhook$/, tier: null },
  // The callback is a redirect target the customer's browser lands on once
  // after paying — throttling it strands them on an error page.
  { pattern: /^\/payment\/callback$/, tier: null },
  // Vercel Cron. Its protection is a constant-time CRON_SECRET check in the
  // handler, not a request ceiling, and a 429 here silently skips a day of the
  // PII retention sweep — which is the failure this route exists to prevent.
  { pattern: /^\/api\/cron\//, tier: null },

  // ── Expensive: headless browser ──────────────────────────────────────────
  { pattern: /^\/api\/automation\/start$/, tier: TIERS.browser },
  { pattern: /^\/api\/applications\/automate$/, tier: TIERS.browser },

  // ── Expensive: vision model ──────────────────────────────────────────────
  { pattern: /^\/api\/applications\/details$/, tier: TIERS.vision },
  // Only the upload path runs extraction; reading or removing the checklist is
  // an ordinary write.
  { pattern: /^\/api\/applications\/checklist$/, methods: ['POST'], tier: TIERS.vision },
  { pattern: /^\/api\/applications\/checklist$/, tier: TIERS.write },

  // ── Expensive: voice ─────────────────────────────────────────────────────
  // These used to fall through to `default` (60/min) while billing per minute
  // of audio upstream. Auth and a held credit already gate them, so this is a
  // ceiling on cost, not an access check.
  { pattern: /^\/api\/voice\/realtime\//, tier: TIERS.voice },
  { pattern: /^\/api\/voice\/transcribe$/, tier: TIERS.voice },
  { pattern: /^\/api\/voice\/tts$/, tier: TIERS.voiceTts },
  // Reading back an eligibility flag or a stored transcript is an ordinary
  // read and must not be metered as if it were a call.
  { pattern: /^\/api\/voice\//, tier: TIERS.read },

  // ── Expensive: language model ────────────────────────────────────────────
  { pattern: /^\/agent\/query$/, tier: TIERS.llm },
  { pattern: /^\/api\/ikamet-automation$/, tier: TIERS.llm },
  { pattern: /^\/workflow\/step\/automate\//, tier: TIERS.llm },

  // ── Polled endpoints ─────────────────────────────────────────────────────
  // The support widget polls every 3.5s and heartbeats every 15s, and the
  // automation viewer pulls frames faster still. These need real headroom.
  { pattern: /^\/api\/support\/queue\//, tier: TIERS.poll },
  { pattern: /^\/api\/automation\/[^/]+$/, tier: TIERS.poll },

  // ── Credential endpoints ─────────────────────────────────────────────────
  { pattern: /^\/auth\/(login|register|google)$/, tier: TIERS.auth },
  { pattern: /^\/auth\/mfa\/verify$/, tier: TIERS.auth },
  { pattern: /^\/auth\/api-key\/generate$/, tier: TIERS.auth },
  { pattern: /^\/auth\/(check-email|me)$/, tier: TIERS.authLight },
  { pattern: /^\/auth\/mfa$/, tier: TIERS.authLight },

  // ── Admin ────────────────────────────────────────────────────────────────
  { pattern: /^\/api\/admin\//, tier: TIERS.admin },
  { pattern: /^\/api\/visa-application\//, tier: TIERS.admin },
  { pattern: /^\/api\/kilo\/proxy$/, tier: TIERS.admin },
  { pattern: /^\/api\/applications\/next$/, tier: TIERS.admin },

  // ── Cheap reads ──────────────────────────────────────────────────────────
  // Metered rather than exempt: it probes the database, so an open version is
  // a free amplifier. 120/min is far above what any uptime monitor needs.
  { pattern: /^\/api\/health$/, tier: TIERS.read },
  { pattern: /^\/api\/geo$/, tier: TIERS.read },
  { pattern: /^\/api\/documents\//, tier: TIERS.read },
  { pattern: /^\/api\/applications\/(mine|session)$/, tier: TIERS.read },
  { pattern: /^\/workflow\/latest$/, tier: TIERS.read },

  // ── Ordinary writes ──────────────────────────────────────────────────────
  { pattern: /^\/chat\/(sessions|history)\//, tier: TIERS.write },
  { pattern: /^\/chat\/sessions$/, tier: TIERS.write },
  { pattern: /^\/api\/support\/tickets/, tier: TIERS.write },
  { pattern: /^\/auth\/account$/, tier: TIERS.write },
  { pattern: /^\/auth\//, tier: TIERS.write },
  { pattern: /^\/payment\/subscribe$/, tier: TIERS.write },
  { pattern: /^\/workflow\//, tier: TIERS.write },
];

/**
 * The tier for a request, or null when the path is exempt.
 * Unmatched paths get `default` — new routes are covered on the day they land.
 */
export function policyFor(pathname: string, method: string): Tier | null {
  for (const rule of RULES) {
    if (!rule.pattern.test(pathname)) continue;
    if (rule.methods && !rule.methods.includes(method)) continue;
    return rule.tier;
  }
  return TIERS.default;
}
