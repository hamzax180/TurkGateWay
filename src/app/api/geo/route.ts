export const runtime = 'nodejs';

import { detectClientCountry } from '@/lib/geo';

/**
 * GET /api/geo
 * Returns { country, in_turkey, source } based on the CDN edge's geo headers,
 * so the client can tailor services (inside vs outside Türkiye). No PII is
 * processed or stored.
 */
export async function GET(req: Request) {
  const geo = detectClientCountry(req.headers);
  return Response.json({
    country: geo.country,
    in_turkey: geo.inTurkey,
    source: geo.source,
  });
}
