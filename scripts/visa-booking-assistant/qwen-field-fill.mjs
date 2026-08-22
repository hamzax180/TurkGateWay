/**
 * qwen-field-fill.mjs
 * Live, semantic field matching — replaces blind regex matching, which broke
 * on the real form: "Passport No" and "Passport Issued Place" both matched
 * /passport/i, so the passport *number* got written into the issue-place
 * field too. A regex can't tell those apart; reading the label can.
 *
 * For each empty field the static matcher doesn't confidently resolve, this
 * asks Qwen (the same model config as the main app — see src/lib/qwen.ts)
 * what belongs there, given the field's real label/type/options and the
 * applicant's data. Qwen only ever returns a value to type into a field it's
 * already been asked about — it never sees or touches Next/Submit, so this
 * doesn't change what the tool is allowed to do, only how accurately it fills
 * what it was already filling.
 *
 * Every (label, type, options) combination is asked about once and cached —
 * the watch loop polls every 1.5s, and re-asking the same question every tick
 * would be slow and wasteful.
 */
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dir, '..', '..', '.env.local');
if (existsSync(envPath)) {
  readFileSync(envPath, 'utf8').split('\n').forEach((line) => {
    const [key, ...rest] = line.split('=');
    if (key && rest.length) process.env[key.trim()] = rest.join('=').trim();
  });
}

const QWEN_BASE_URL = process.env.QWEN_BASE_URL || 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';
const QWEN_MODEL = process.env.QWEN_MODEL || 'qwen3.8-max';

export function hasQwenKey() {
  return Boolean(process.env.DASHSCOPE_API_KEY);
}

const SYSTEM_PROMPT = `You fill in ONE form field on a visa appointment website, from a JSON record of applicant data.

Rules:
- Read the field's label/type/options carefully. Fields can look similar but mean different things — e.g. "Passport No" wants the passport number, but "Passport Issued Place" wants a city/country name, not the number. Do not confuse them.
- You are also told the other field labels on the same page. Use them to disambiguate: a field labelled "Name" sitting next to a separate "Surname" field wants ONLY the given name, not the full name. A field is never meant to duplicate what a neighbouring field already covers.
- Only use data that is actually present in the applicant JSON. Never invent, guess, or fabricate a value.
- For a <select>, you MUST return one of the exact option strings given to you, or "SKIP".
- If nothing in the applicant data clearly and safely belongs in this field, return exactly "SKIP". Returning nothing rather than a wrong guess is always the correct choice here — this is a real government-adjacent form.
- Reply with ONLY the value to type/select, or "SKIP". No explanation, no punctuation around it.`;

/**
 * Answers are cached so the 1.5s poll loop does not re-ask the same question
 * every tick.
 *
 * The key MUST include who is being filled in. This module began life in a
 * one-shot CLI where a process handled exactly one applicant, so keying on the
 * field alone was safe. It is now also imported by the server
 * (src/lib/browser-automation.ts), where one long-lived process handles many
 * applicants — and there, a field-only key means applicant A's passport number
 * is served to applicant B's form, and a single "SKIP" is remembered forever
 * so that field never fills for anyone again.
 */
const cache = new Map();

/** Small, stable fingerprint of the applicant record. */
function applicantKey(applicant) {
  const json = JSON.stringify(applicant ?? {});
  let hash = 5381;
  for (let i = 0; i < json.length; i += 1) hash = ((hash * 33) ^ json.charCodeAt(i)) >>> 0;
  return hash.toString(36);
}

/** Bound the map so a server that never restarts cannot grow without limit. */
const MAX_CACHE = 500;

/** Drop everything remembered for one applicant, e.g. when their run ends. */
export function resetFieldCache(applicant) {
  if (!applicant) {
    cache.clear();
    return;
  }
  const prefix = applicantKey(applicant);
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}

/**
 * Ask Qwen what belongs in one field. Returns a string value, or null if it
 * says SKIP (or the call fails — a failure must never invent a fallback
 * value, it just means the field stays empty for the human to fill).
 */
export async function askFieldValue({ label, type, options, applicant, siblingLabels }) {
  const cacheKey =
    applicantKey(applicant) + '|' + JSON.stringify({ label, type, options, siblingLabels });
  if (cache.has(cacheKey)) return cache.get(cacheKey);
  if (cache.size > MAX_CACHE) cache.clear();

  if (!hasQwenKey()) {
    cache.set(cacheKey, null);
    return null;
  }

  const userPrompt = [
    `Field label: ${JSON.stringify(label)}`,
    `Field type: ${type}`,
    options && options.length ? `Available options: ${JSON.stringify(options)}` : null,
    siblingLabels && siblingLabels.length
      ? `Other field labels on this same page: ${JSON.stringify(siblingLabels)}`
      : null,
    `Applicant data: ${JSON.stringify(applicant)}`,
  ].filter(Boolean).join('\n');

  try {
    const res = await fetch(`${QWEN_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.DASHSCOPE_API_KEY}`,
      },
      body: JSON.stringify({
        model: QWEN_MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: 40,
        // Same fix as the main app — Qwen3's default "thinking" mode adds
        // multi-second latency for what should be an instant lookup.
        enable_thinking: false,
      }),
    });

    // NOT cached. A 429 or a 5xx is the transport failing, not the model
    // deciding this field has no value — and the caller polls every 1.5s, so
    // leaving it uncached lets the next tick ask again. Caching it meant one
    // transient blip silently left a mandatory field blank for the whole run,
    // which is how three fields came back empty on a real İkamet page.
    if (!res.ok) return null;
    const data = await res.json();
    const raw = (data.choices?.[0]?.message?.content ?? '').trim();
    const value = raw && raw.toUpperCase() !== 'SKIP' ? raw : null;

    // For selects, only accept an answer that's actually one of the real
    // options — never let the model invent a value that doesn't exist on
    // the page.
    // A select answer must name an option that really exists on the page —
    // the model must never invent one. Matching is case- and punctuation
    // insensitive so "Yemen" still resolves against an option printed
    // "YEMEN (YEM)", but an answer matching two options is rejected: on a
    // government form, an ambiguous pick is a wrong pick.
    if (value && type === 'select' && options) {
      const fold = (v) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      const target = fold(value);
      const exact = options.filter((o) => fold(o) === target);
      const partial = exact.length ? exact : options.filter((o) => fold(o).includes(target));
      if (partial.length !== 1) {
        cache.set(cacheKey, null);
        return null;
      }
      cache.set(cacheKey, partial[0]);
      return partial[0];
    }

    cache.set(cacheKey, value);
    return value;
  } catch {
    // Same reasoning as the !res.ok branch — a dropped connection is not an
    // answer, so it must not be remembered as one.
    return null;
  }
}
