/**
 * geo.ts
 * Detect whether the client is inside or outside Türkiye, so the platform can
 * surface the right services: residence/business/legal for people already in
 * the country, visa/university/relocation for people still abroad.
 *
 * Uses the geo headers injected by the CDN edge (Vercel / Cloudflare) — no
 * external geolocation API, no database, and no PII leaves the server. When
 * the app runs somewhere that does not inject the header (localhost), the
 * result is null and callers simply skip personalisation.
 */

export type RegionDetection = {
  /** ISO 3166-1 alpha-2 country code of the client, or null when unknown. */
  country: string | null;
  inTurkey: boolean;
  /** Which header the answer came from — for debugging only. */
  source: string | null;
};

const COUNTRY_HEADERS = ['x-vercel-ip-country', 'cf-ipcountry', 'x-country-code'] as const;

export function detectClientCountry(headers: Headers): RegionDetection {
  for (const name of COUNTRY_HEADERS) {
    const raw = headers.get(name);
    if (raw && /^[A-Za-z]{2}$/.test(raw.trim())) {
      const country = raw.trim().toUpperCase();
      return { country, inTurkey: country === 'TR', source: name };
    }
  }
  return { country: null, inTurkey: false, source: null };
}
