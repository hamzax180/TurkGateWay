/**
 * document-extract.ts
 * Reads the applicant's own paperwork so they do not have to retype it.
 *
 * A visa application asks for ~20 details that are already printed on the
 * passport the applicant just uploaded. Asking for them one at a time is the
 * slowest part of the whole flow, so every uploaded image is passed to Qwen's
 * vision model and whatever it can read is merged into the intake.
 *
 * Two rules keep this safe:
 *
 *  - Extracted values NEVER overwrite an answer the applicant gave. A human
 *    correcting a misread scan must not be undone by the next upload.
 *  - Extraction failing is never fatal. The intake simply stays as it was and
 *    the agent asks for the remaining fields as before.
 *
 * PDFs are not readable by the vision model (it rejects them outright), so
 * only image uploads are extracted from. `unreadable` reports the rest rather
 * than pretending they were processed.
 */

import { eq } from 'drizzle-orm';
import { db } from './db';
import { applicationDocuments, applications, type ApplicationKind } from './schema';
import { hasQwenKey, QWEN_BASE_URL } from './qwen';
import { parseStoredData, type FieldDef } from './intake-core';
import { INTAKE_FIELDS } from './visa-fields';
import { IKAMET_FIELDS } from './ikamet-fields';

/** Vision model — qwen-vl-max reads document scans reliably and returns JSON. */
const VISION_MODEL = process.env.QWEN_VISION_MODEL || 'qwen-vl-max';

/** Formats the vision endpoint accepts. PDFs are refused by the API. */
const READABLE_MIME = new Set(['image/jpeg', 'image/png']);

/** Cap per request so one huge scan cannot stall an upload. */
const EXTRACT_TIMEOUT_MS = 25_000;

export function fieldsForKind(kind: ApplicationKind): FieldDef[] {
  if (kind === 'visa_appointment') return INTAKE_FIELDS;
  if (kind === 'ikamet') return IKAMET_FIELDS;
  return [];
}

export type ExtractionResult = {
  /** Fields newly filled by reading documents. */
  filled: string[];
  /** Documents that could not be read (PDFs, or a failed call). */
  unreadable: string[];
  /** Everything still outstanding after extraction. */
  missing: string[];
  data: Record<string, string>;
};

/**
 * Dates arrive as "14 MAR 2003", "14/03/2003", "2003-03-14"… The forms want one
 * shape, and a half-parsed date is worse than the raw string, so anything not
 * confidently recognised is passed through untouched.
 */
const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

export function normalizeDate(value: string): string {
  const raw = value.trim();

  // 14 MAR 2003 / 14 March 2003
  const named = raw.match(/^(\d{1,2})[\s-]+([A-Za-z]{3,})[\s-]+(\d{4})$/);
  if (named) {
    const mon = MONTHS[named[2].slice(0, 3).toLowerCase()];
    if (mon) return `${named[3]}-${mon}-${named[1].padStart(2, '0')}`;
  }

  // 2003-03-14 — already there
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  // 14/03/2003 or 14.03.2003 — day first, the convention in every country this
  // platform serves.
  const slashed = raw.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/);
  if (slashed) {
    return `${slashed[3]}-${slashed[2].padStart(2, '0')}-${slashed[1].padStart(2, '0')}`;
  }

  return raw;
}

/**
 * Date-valued fields only. Deliberately does NOT include "issue" or "expiry":
 * `passportIssuedPlace` is a city, and matching it here made the date
 * validation reject "ASHGABAT" and silently drop it. Every real date field
 * already contains "date".
 */
const DATE_FIELD = /date|dob/i;
const PHONE_FIELD = /phone|mobile|tel/i;
const COUNTRY_FIELD = /country|nationality/i;

/**
 * Words that mean the model has handed us an organisation rather than a place.
 * An acceptance letter says "University: Istanbul Technical University" right
 * next to the applicant's details, and that landed in applicationCountry —
 * which then defeated the dialling-code lookup and would have been typed into
 * the form as the country applied from.
 */
const NOT_A_COUNTRY = /universit|school|colleg|institut|academy|faculty|bank|hospital|ministry|embassy|consulate|gmbh|ltd|inc\b/i;

/**
 * Strip separators from a phone number.
 *
 * People and documents write "+993 65 123456"; the appointment form validates
 * against a bare "+99365123456" and rejects anything with spaces as an invalid
 * number. Normalising here means the stored value is the one every consumer
 * wants — the form filler, the generated PDF and the operator alike.
 */
export function normalizePhone(value: string, country?: string): string {
  const trimmed = value.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return trimmed;

  // Already international.
  if (trimmed.startsWith('+')) return '+' + digits;
  if (trimmed.startsWith('00')) return '+' + digits.replace(/^00/, '');

  // A bare local number ("626721782") is rejected by the appointment form just
  // as firmly as one with spaces — it has no country code. We know where the
  // applicant is applying from, so use it rather than storing something the
  // form will refuse.
  const code = country ? diallingCode(country) : null;
  if (code) {
    // Local numbers are often written with a trunk zero that the country code
    // replaces: 0612 345678 -> +90 612 345678.
    return '+' + code + digits.replace(/^0+/, '');
  }

  return digits;
}

/** Dialling codes for the countries this platform actually serves. */
const DIALLING: Array<[RegExp, string]> = [
  [/t[uü]rkmen/i, '993'],
  [/t[uü]rk[iy]|turkey/i, '90'],
  [/azerbai|az[əe]rbay/i, '994'],
  [/uzbek|o'?zbek/i, '998'],
  [/kazakh|qazaq/i, '7'],
  [/iran|persia/i, '98'],
  [/iraq/i, '964'],
  [/syria/i, '963'],
  [/egypt/i, '20'],
  [/saudi/i, '966'],
  [/emirat|u\.?a\.?e/i, '971'],
  [/russia/i, '7'],
];

/** First candidate that resolves to a dialling code, or '' if none do. */
export function countryWithDiallingCode(candidates: (string | undefined)[]): string {
  for (const candidate of candidates) {
    if (candidate && diallingCode(candidate)) return candidate;
  }
  return '';
}

export function diallingCode(country: string): string | null {
  const value = String(country ?? '').trim();
  if (!value) return null;
  for (const [pattern, code] of DIALLING) {
    if (pattern.test(value)) return code;
  }
  return null;
}

function cleanValue(key: string, value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  // Models like to say so rather than omit the key.
  if (/^(n\/?a|null|none|unknown|not (visible|found|specified))$/i.test(trimmed)) return null;
  if (trimmed.length > 200) return null;

  if (DATE_FIELD.test(key)) {
    const date = normalizeDate(trimmed);
    // "2025" is a year, not a date, and a form fed one rejects it. A value we
    // cannot resolve to a real calendar date is worse than no value at all —
    // absent, the applicant is asked for it; present and wrong, it is typed in
    // and refused with nothing explaining why.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    const [y, m, d2] = date.split('-').map(Number);
    if (m < 1 || m > 12 || d2 < 1 || d2 > 31 || y < 1900 || y > 2100) return null;
    return date;
  }
  if (COUNTRY_FIELD.test(key) && NOT_A_COUNTRY.test(trimmed)) return null;
  if (PHONE_FIELD.test(key)) return normalizePhone(trimmed);  // country applied later
  return trimmed;
}

/** Ask the vision model to read one document against a field list. */
async function readDocument(
  base64: string,
  mime: string,
  fields: FieldDef[],
): Promise<Record<string, string>> {
  const wanted = fields.map((f) => `- ${f.key}: ${f.label}`).join('\n');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EXTRACT_TIMEOUT_MS);

  try {
    const res = await fetch(`${QWEN_BASE_URL}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.DASHSCOPE_API_KEY ?? ''}`,
      },
      body: JSON.stringify({
        model: VISION_MODEL,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } },
              {
                type: 'text',
                text:
                  'This is a scan of an official document belonging to a visa/residence applicant.\n' +
                  'Read it and return ONLY a JSON object with any of these fields you can see printed on it:\n\n' +
                  `${wanted}\n\n` +
                  'Rules: omit a field entirely if it is not printed on this document — never guess, never infer. ' +
                  'A country field must be a COUNTRY name (e.g. "Turkmenistan") — never a university, school, bank or company. ' +
                  'A date field must be a full calendar date; if only a year or a range is shown, omit it. ' +
                  'Copy names and numbers exactly as printed. Use YYYY-MM-DD for dates. Return only the JSON object.',
              },
            ],
          },
        ],
        max_tokens: 700,
      }),
    });

    if (!res.ok) return {};
    const body = await res.json();
    const content: string = body?.choices?.[0]?.message?.content ?? '';

    // Models often fence the JSON, so take the first object in the reply.
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return {};

    const parsed = JSON.parse(match[0]) as Record<string, unknown>;
    const allowed = new Set(fields.map((f) => f.key));
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (!allowed.has(key)) continue;
      const clean = cleanValue(key, value);
      if (clean) out[key] = clean;
    }
    return out;
  } catch {
    return {};
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Read every image document on an application and merge what they contain into
 * its intake data.
 *
 * Returns null when there is nothing to do (no key, no field set, no
 * application) so callers can skip silently.
 */
export async function extractFromDocuments(opts: {
  sessionId: string;
  kind: ApplicationKind;
}): Promise<ExtractionResult | null> {
  if (!hasQwenKey()) return null;

  const fields = fieldsForKind(opts.kind);
  if (!fields.length) return null;

  const [application] = await db
    .select()
    .from(applications)
    .where(eq(applications.session_id, opts.sessionId))
    .limit(1);
  if (!application || application.kind !== opts.kind) return null;

  const docs = await db
    .select({
      kind: applicationDocuments.kind,
      filename: applicationDocuments.filename,
      mime_type: applicationDocuments.mime_type,
      data: applicationDocuments.data,
    })
    .from(applicationDocuments)
    .where(eq(applicationDocuments.application_id, application.id));

  const existing = parseStoredData(application.data);
  const merged: Record<string, string> = { ...existing };
  const filled: string[] = [];
  const unreadable: string[] = [];

  const outstanding = () =>
    fields.filter((f) => !f.optional && !String(merged[f.key] ?? '').trim());

  // Nothing to look for. Re-reading every scan to confirm what we already know
  // would cost half a minute of vision calls for no new information — and this
  // runs again on every reconnect.
  if (outstanding().length === 0) {
    return { filled, unreadable, missing: [], data: merged };
  }

  // Generated forms are our own output — reading them back would be circular.
  const sources = docs.filter((d) => !d.kind.startsWith('generated_'));

  // Read every scan at once. Sequentially this was ~5s per document, so a
  // six-document checklist sat on a spinner for half a minute and looked hung.
  const reads = await Promise.all(
    sources.map(async (doc) => {
      if (!READABLE_MIME.has(doc.mime_type)) {
        return { doc, found: null as Record<string, string> | null };
      }
      const found = await readDocument(
        Buffer.from(doc.data).toString('base64'),
        doc.mime_type,
        fields,
      );
      return { doc, found };
    }),
  );

  for (const { doc, found } of reads) {
    if (!found || !Object.keys(found).length) {
      unreadable.push(doc.filename);
      continue;
    }
    for (const [key, value] of Object.entries(found)) {
      // An answer already on file wins — the applicant, or an earlier and
      // clearer scan, beats a fresh guess.
      if (String(merged[key] ?? '').trim()) continue;
      merged[key] = value;
      const field = fields.find((f) => f.key === key);
      filled.push(field?.short ?? key);
    }
  }

  // The country may have come from a different document than the phone number,
  // so the dialling code can only be applied once everything is merged. Try
  // every candidate rather than the first non-empty one — a misread country
  // must not stop a perfectly good nationality from supplying the code.
  const homeCountry = countryWithDiallingCode([merged.applicationCountry, merged.nationality]);
  for (const key of Object.keys(merged)) {
    if (PHONE_FIELD.test(key) && merged[key]) {
      merged[key] = normalizePhone(merged[key], homeCountry);
    }
  }

  const missing = outstanding().map((f) => f.short);

  if (filled.length) {
    const locked = new Set(['submitted', 'booked', 'forwarded', 'done']);
    const nextStatus = locked.has(application.status)
      ? application.status
      : missing.length === 0
        ? 'ready'
        : application.status;

    await db
      .update(applications)
      .set({ data: JSON.stringify(merged), status: nextStatus, updated_at: new Date() })
      .where(eq(applications.id, application.id));
  }

  return { filled, unreadable, missing, data: merged };
}
