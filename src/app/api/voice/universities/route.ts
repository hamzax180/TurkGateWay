export const runtime = 'nodejs';

import { getOptionalUser } from '@/lib/user-helper';
import {
  findUniversity,
  searchUniversities,
  universitiesInCity,
  TURKISH_UNIVERSITIES,
} from '@/lib/turkish-universities';

/**
 * POST /api/voice/universities — what the suggest_universities tool calls.
 *
 * A Realtime session runs in the browser, so its tools cannot execute on the
 * server the way the Qwen agent's do. The model asks, the browser relays the
 * ask here, and the answer goes back down the data channel. This route is that
 * relay's server half.
 *
 * It exists rather than shipping the university list to the browser because
 * TurkishUniversity carries admissions email addresses, which are marked
 * server-side use only. Only name, city and website leave this process.
 *
 * ── Why the shape is deliberately small ──────────────────────────────────
 * Everything returned here gets READ ALOUD. Three universities is what a
 * person can hold in their head on a phone call; a list of ten is the thing
 * VOICE_STYLE exists to prevent. So the cap is low and non-negotiable by the
 * caller, and websites are omitted from the spoken payload — reading a URL
 * aloud character by character is unbearable, and the chat afterwards is where
 * links belong.
 */

/** Small on purpose: this is spoken, not rendered. */
const MAX_SPOKEN = 3;

interface SpokenUniversity {
  name: string;
  city: string;
}

const spoken = (u: { name: string; city: string }): SpokenUniversity => ({
  name: u.name,
  city: u.city,
});

export async function POST(req: Request) {
  try {
    // Signed in is enough here — this reads a static public list and spends
    // nothing, so it is not behind the credit gate the call itself is behind.
    const user = await getOptionalUser(req);
    if (!user) return Response.json({ detail: 'Not authenticated' }, { status: 401 });

    const body = await req.json().catch(() => null);
    const nameGuess = String(body?.nameGuess ?? '').trim();
    const city = String(body?.city ?? '').trim();
    const fieldOfStudy = String(body?.fieldOfStudy ?? '').trim();

    // A name they already said wins over a city filter — they are confirming a
    // specific school, not browsing. Same precedence the text agent's
    // suggest_universities uses, so a caller gets the same answer either way.
    if (nameGuess) {
      const exact = findUniversity(nameGuess);
      if (exact) {
        return Response.json({
          resolved: spoken(exact),
          message: `${exact.name} in ${exact.city} is on our list. Confirm this is the one they mean, then move on.`,
        });
      }

      const near = searchUniversities(nameGuess, MAX_SPOKEN);
      if (near.length) {
        return Response.json({
          options: near.map(spoken),
          message:
            'Not an exact match. Read these back and ask which one they meant. Do not guess for them.',
        });
      }
    }

    if (city) {
      const inCity = universitiesInCity(city, MAX_SPOKEN);
      if (inCity.length) {
        return Response.json({
          options: inCity.map(spoken),
          message: `Universities we work with in ${city}. Offer them and ask which one they want.`,
        });
      }
      return Response.json({
        options: [],
        message: `We have no partner universities in ${city}. Say so plainly and ask if another city works.`,
      });
    }

    // Nothing to filter on. Offer a few real ones rather than nothing — a
    // caller who does not know where to start is exactly who needs options.
    return Response.json({
      options: TURKISH_UNIVERSITIES.slice(0, MAX_SPOKEN).map(spoken),
      // fieldOfStudy is accepted so the model can mention it naturally, but it
      // is NOT used to filter: the list carries no programme data, and picking
      // universities by a field we have no information about would be invention.
      message: fieldOfStudy
        ? `We have no programme-level data, so do not claim any of these are strong in ${fieldOfStudy}. Offer them as options and ask which city they prefer.`
        : 'Offer these and ask which city they prefer, or ask what they want to study.',
    });
  } catch (e) {
    if (e instanceof Response) return e;
    console.error('[api/voice/universities]', e);
    return Response.json({ detail: 'Error' }, { status: 500 });
  }
}
