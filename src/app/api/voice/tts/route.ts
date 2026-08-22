export const runtime = 'nodejs';
export const maxDuration = 30;

import { getOptionalUser } from '@/lib/user-helper';
import { getCreditBalance } from '@/lib/credits';
import { turkmenToTurkishPhonetic } from '@/lib/turkmen-speech';

/**
 * POST /api/voice/tts — speak one line, in a real voice.
 *
 * This is the ONLY voice the app has. The browser's speechSynthesis path (the
 * OS engine — SAPI on Windows) was removed: no amount of rate and pitch tuning
 * made it stop sounding synthetic, and keeping it as a fallback meant a silent
 * failure here came back as a robotic voice rather than as something anybody
 * would notice and fix.
 *
 * The consequence of that is worth being explicit about: every 503 below is
 * SILENCE on the call, not a downgrade. Anything that turns this endpoint off —
 * a missing key, an unfunded OpenAI account, a language left out of TTS_LANGS —
 * is a caller hearing nothing at all.
 *
 * ── Turkmen ──────────────────────────────────────────────────────────────
 * No commercial TTS speaks Turkmen — not OpenAI, Gemini, Qwen, Azure or
 * ElevenLabs. Checked against each vendor's own documentation, and
 * turkmen-speech.ts records the same finding independently.
 *
 * So Turkmen is respelled into Turkish orthography and read by a Turkish
 * voice. The result is a Turkish accent reading Turkmen words: intelligible,
 * audibly foreign. Whether
 * that is good enough is a judgement for a Turkmen speaker, which is why
 * TTS_LANGS below lets it be switched off for that language alone without
 * touching the others.
 */

const OPENAI_TTS_URL = 'https://api.openai.com/v1/audio/speech';

/** Which languages go to the neural voice. Others get no voice at all. */
const TTS_LANGS = (process.env.VOICE_TTS_LANGS ?? 'en,tr,ar,tk')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

/**
 * gpt-4o-mini-tts takes a plain-language `instructions` field describing how to
 * deliver the line. It is the single biggest lever on sounding human — more
 * than the voice choice — because it controls pace, warmth and phrasing rather
 * than timbre alone.
 *
 * The previous wording asked for "a normal conversational pace — not hurried",
 * which the model reads as slow: 129 words per minute on a fixed test line,
 * against the 160-175 people actually use on a support call.
 *
 * Rewording alone does not reliably fix it. Measured over three samples per
 * config, the same instructions vary by up to 40wpm run to run, which swamps
 * the difference between one wording and another — the `speed` parameter below
 * is the lever that actually moves the mean. This text is therefore aimed at
 * tone, and speed is aimed at pace.
 */
const DELIVERY = [
  'You are a friendly call-centre agent on a quick phone call.',
  'Speak at a brisk, efficient pace — the clip of somebody who handles these calls all day,',
  'is glad to help, and does not linger over words.',
  'Keep the intonation light and natural, as if talking to one person.',
  'Do not sound like an announcer or a narrator, and do not draw words out.',
].join(' ');

/**
 * Playback rate on top of the delivery instructions, and the reliable half of
 * the pacing fix. Measured mean over three samples of a fixed line:
 *
 *   no speed set   129 wpm      (what shipped, and what "too slow" meant)
 *   speed 1.1      148 wpm      still draggy, and swings 36wpm run to run
 *   speed 1.2      164 wpm      lands in the natural band, tightest spread
 *
 * The API accepts 0.25-4.0. The clamp here is a guard rail against a typo in
 * the env var turning the call unlistenable, not a claim about where the voice
 * starts to sound clipped — that is a judgement by ear, so tune VOICE_TTS_SPEED
 * rather than trusting this default if it sounds wrong to you.
 */
const TTS_SPEED = Math.min(1.4, Math.max(0.8, Number(process.env.VOICE_TTS_SPEED ?? '1.2') || 1.2));

/** Turkmen has no voice anywhere, so it is read by the Turkish one. */
function resolveSpeech(text: string, lang: string): { input: string; spokenAs: string } {
  if (lang === 'tk') return { input: turkmenToTurkishPhonetic(text), spokenAs: 'tr' };
  return { input: text, spokenAs: lang };
}

export async function POST(req: Request) {
  try {
    const key = process.env.OPENAI_API_KEY;
    if (!key) {
      // Nothing to fall back to any more: this is a silent call.
      return Response.json({ detail: 'neural tts not configured' }, { status: 503 });
    }

    // Generation costs money, so it is behind the same door as the call itself:
    // signed in, and holding a credit (or an admin). Without this the endpoint
    // is an open bill anyone can run up.
    const user = await getOptionalUser(req);
    if (!user) return Response.json({ detail: 'Not authenticated' }, { status: 401 });
    if (!user.is_admin) {
      const balance = await getCreditBalance(user.id);
      if (balance.available < 1) {
        return Response.json({ detail: 'Start a service to use voice.' }, { status: 402 });
      }
    }

    const body = await req.json().catch(() => null);
    const rawText = String(body?.text ?? '').trim();
    const lang = String(body?.lang ?? 'en').trim().toLowerCase();

    if (!rawText) return Response.json({ detail: 'text required' }, { status: 400 });
    // The caller sends one short chunk at a time; anything much longer is a
    // bug upstream and would be slow and expensive to voice.
    if (rawText.length > 800) {
      return Response.json({ detail: 'text too long' }, { status: 413 });
    }
    if (!TTS_LANGS.includes(lang)) {
      return Response.json({ detail: 'language not enabled for neural tts' }, { status: 503 });
    }

    const { input } = resolveSpeech(rawText, lang);

    const upstream = await fetch(OPENAI_TTS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.VOICE_TTS_MODEL ?? 'gpt-4o-mini-tts',
        voice: process.env.VOICE_TTS_VOICE ?? 'sage',
        input,
        instructions: DELIVERY,
        speed: TTS_SPEED,
        // Opus streams sooner and is far smaller than mp3 over a phone-style
        // exchange, where time-to-first-sound is what makes it feel live.
        response_format: 'opus',
      }),
    });

    if (!upstream.ok || !upstream.body) {
      const detail = await upstream.text().catch(() => '');
      console.error('[voice/tts] upstream failed', upstream.status, detail.slice(0, 300));
      // The status is logged above rather than passed through, since the client
      // can do nothing different with a 429 than with a 500. Check this log
      // first when a call goes quiet — an unfunded account shows up here as
      // 429 insufficient_quota.
      return Response.json({ detail: 'tts upstream failed' }, { status: 503 });
    }

    return new Response(upstream.body, {
      headers: {
        'Content-Type': 'audio/ogg',
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    console.error('[voice/tts]', e);
    return Response.json({ detail: 'Error' }, { status: 503 });
  }
}
