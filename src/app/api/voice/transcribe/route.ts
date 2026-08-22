export const runtime = 'nodejs';
export const maxDuration = 60;

import { getOptionalUser } from '@/lib/user-helper';
import { normalizeLang } from '@/lib/prompts';

/**
 * POST /api/voice/transcribe — turn a dictated clip into text.
 *
 * This is the composer's microphone, not the phone call. The caller records a
 * few seconds, this returns the words, and they land in the message box where
 * they can be edited before sending. That editing step is the whole point: the
 * old browser SpeechRecognition path wrote its guesses straight into a live
 * request, so a misheard word became a question nobody asked.
 *
 * Kept apart from /api/voice/realtime deliberately — dictation is a one-shot
 * upload with no session, no WebRTC and no per-minute billing, and gating it
 * behind a service credit the way a call is gated would make the microphone
 * button dead for most of the people who would use it.
 */

const TRANSCRIBE_URL = 'https://api.openai.com/v1/audio/transcriptions';

/**
 * gpt-4o-mini-transcribe over whisper-1: markedly better on the Turkic and
 * Central Asian languages this app serves, and cheaper. whisper-1 remains the
 * only one that can return word timings, which dictation does not need.
 */
const MODEL = process.env.VOICE_TRANSCRIBE_MODEL ?? 'gpt-4o-mini-transcribe';

/** A dictated message. Anything longer is a recording left running by mistake. */
const MAX_BYTES = 20 * 1024 * 1024;

/**
 * Whisper-family language codes. The app's own tags are already ISO-639-1
 * except Turkmen, which the API does not accept at all — sending it produces a
 * 400 rather than a graceful fallback, so it is omitted and the model is left
 * to auto-detect. That detects Turkmen as Turkish more often than not, which
 * is wrong but intelligible, and is the same compromise turkmen-speech.ts
 * documents for the opposite direction.
 */
const TRANSCRIBE_LANG: Record<string, string | undefined> = {
  en: 'en', tr: 'tr', ar: 'ar', az: 'az', uz: 'uz', kk: 'kk', fa: 'fa', ru: 'ru',
  tk: undefined,
};

export async function POST(req: Request) {
  try {
    const key = process.env.OPENAI_API_KEY;
    if (!key) {
      return Response.json({ detail: 'transcription not configured' }, { status: 503 });
    }

    // Signed in only — no credit gate. See the note above.
    const user = await getOptionalUser(req);
    if (!user) return Response.json({ detail: 'Not authenticated' }, { status: 401 });

    const form = await req.formData().catch(() => null);
    const file = form?.get('audio');
    if (!(file instanceof File) || file.size === 0) {
      return Response.json({ detail: 'audio required' }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return Response.json({ detail: 'recording too long' }, { status: 413 });
    }

    const lang = normalizeLang(String(form?.get('language') ?? 'en'));
    const upstreamForm = new FormData();
    upstreamForm.append('file', file, file.name || 'dictation.webm');
    upstreamForm.append('model', MODEL);
    upstreamForm.append('response_format', 'json');

    // Naming the language is worth a lot on short clips, where there is not
    // enough audio to detect it from. Omitted for Turkmen, which is unsupported.
    const hint = TRANSCRIBE_LANG[lang];
    if (hint) upstreamForm.append('language', hint);

    const upstream = await fetch(TRANSCRIBE_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: upstreamForm,
    });

    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => '');
      console.error('[voice/transcribe] upstream', upstream.status, detail.slice(0, 300));
      return Response.json({ detail: 'could not transcribe' }, { status: 503 });
    }

    const data = await upstream.json().catch(() => null);
    const text = String(data?.text ?? '').trim();

    // An empty result is a normal outcome — somebody tapped the mic and said
    // nothing — so it answers 200 with empty text rather than an error the UI
    // would have to render as a failure.
    return Response.json({ text });
  } catch (e) {
    if (e instanceof Response) return e;
    console.error('[voice/transcribe]', e);
    return Response.json({ detail: 'Error' }, { status: 503 });
  }
}
