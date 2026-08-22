export const runtime = 'nodejs';

import { getOptionalUser } from '@/lib/user-helper';
import { getCreditBalance } from '@/lib/credits';
import { buildSystemPrompt, normalizeAgent, normalizeLang } from '@/lib/prompts';

/**
 * POST /api/voice/realtime/session — open a Realtime voice call.
 *
 * Mints a short-lived client secret so the browser can talk to OpenAI directly
 * over WebRTC. The account API key never leaves this process: handing it to the
 * browser would put an unlimited key in every caller's devtools.
 *
 * ── Why this exists at all ───────────────────────────────────────────────
 * The previous voice path was three sequential round trips — browser speech
 * recognition, then Qwen writing a reply, then OpenAI rendering it to audio.
 * Measured: ~0.5s to detect the caller stopped, ~1.7s for Qwen, ~1.3s for TTS.
 * About three and a half seconds of silence before the caller heard anything,
 * and no way to interrupt.
 *
 * A Realtime session is one persistent connection carrying audio both ways, so
 * the model starts answering while the caller is still finishing their
 * sentence, and can be talked over. That is the difference people mean when
 * they say a voice assistant feels alive rather than like a walkie-talkie.
 *
 * ── What the model is told ───────────────────────────────────────────────
 * The instructions come from buildSystemPrompt({ isVoice: true }) — the very
 * same prompt the Qwen path uses. That is deliberate: the agent persona, the
 * language directive, the scope guard and the phone-call delivery rules are
 * the product, and a second hand-written copy here would drift from it within
 * a release or two.
 *
 * The one thing that cannot carry over is [CALL_COMPLETE]. In the old path the
 * model wrote that token and the client stripped it before speaking. Here the
 * model IS the speaker, so a written token would be read out loud. It gets a
 * tool instead, which is what the token was always emulating.
 */

const CLIENT_SECRETS_URL = 'https://api.openai.com/v1/realtime/client_secrets';

/**
 * Input languages gpt-live-transcribe accepts, checked against the API's own
 * error message rather than assumed.
 *
 * Turkmen is absent — passing 'tk' is rejected outright — so it is left to
 * auto-detect. The model still UNDERSTANDS the caller either way, because a
 * Realtime session is speech-to-speech and the audio reaches it directly; only
 * the written transcript suffers, usually by being labelled as Turkish. That
 * is the same trade turkmen-speech.ts documents in the opposite direction.
 *
 * Naming the language for the other eight is worth real accuracy on short
 * utterances, where there is too little audio to detect it from.
 */
const TRANSCRIBE_LANG: Record<string, string | undefined> = {
  en: 'en', tr: 'tr', ar: 'ar', az: 'az', uz: 'uz', kk: 'kk', fa: 'fa', ru: 'ru',
  tk: undefined,
};

/** Snapshot rather than the `gpt-realtime` alias, so a vendor-side model swap
 *  cannot change how the call sounds without a deploy. */
const REALTIME_MODEL = process.env.VOICE_REALTIME_MODEL ?? 'gpt-realtime-2.1';

/** Realtime voices are a different set from the TTS ones; 'marin' and 'cedar'
 *  are the two built for this model. Overridable without a code change. */
const REALTIME_VOICE = process.env.VOICE_REALTIME_VOICE ?? 'marin';

/**
 * Replaces the [CALL_COMPLETE] paragraph in VOICE_STYLE.
 *
 * VOICE_STYLE tells the model to end its last sentence with a literal token.
 * That worked when a separate TTS step could strip it; here it would be spoken
 * aloud as "bracket call underscore complete". The rule is restated as a tool
 * call, and the old instruction is explicitly cancelled — leaving both in play
 * gets the token spoken AND the tool called.
 */
const REALTIME_ENDING = [
  'ENDING THE CALL — this overrides any earlier instruction about writing [CALL_COMPLETE].',
  'Never say or spell out the token [CALL_COMPLETE]; everything you produce here is spoken aloud.',
  'Instead, the moment you know which of the four services they need and the one detail that pins it down:',
  'say your one-sentence confirmation out loud, and then call the end_call tool with what you learned.',
  'Say the sentence first and call the tool immediately after, so the caller hears the close before the line drops.',
].join(' ');

/**
 * How to behave around a tool result.
 *
 * A tool result arrives as a fresh turn, and the model treated it as a fresh
 * conversation: observed on a live call introducing itself a second time
 * mid-sentence — "...options we work with. I'm your student agent. We work
 * with a few in Istanbul...". Nobody re-introduces themselves halfway through
 * a phone call, and VOICE_STYLE already limits the greeting to once.
 */
const REALTIME_TOOL_MANNERS = [
  'When a tool returns, you are still in the SAME call, mid-conversation.',
  'Do not greet, do not introduce yourself again, and do not restate who you are — just continue from where you left off.',
  'Read back at most three items, and never read a website or a URL aloud; say you will put it in the chat instead.',
  'The moment the caller settles on a university, a subject, or a service, call record_choice so it appears on their screen.',
].join(' ');

/**
 * Put what the caller has decided on their screen, as they decide it.
 *
 * A phone call has no record of itself while it is happening: somebody says
 * "Bahcesehir, computer engineering" and then spends the rest of the call
 * wondering whether it was heard correctly. This is the read-back, except it
 * is visual and does not cost a turn of conversation.
 *
 * Called repeatedly and at any point — the caller changing their mind is the
 * normal case, not an error.
 */
const RECORD_CHOICE_TOOL = {
  type: 'function',
  name: 'record_choice',
  description:
    'Put what the caller has settled on up on their screen. Call this the MOMENT you hear it — a university, ' +
    'what they want to study, or which service they need — not at the end of the call. ' +
    'Send only the fields you actually heard. Call it again whenever they change their mind, and do not ' +
    'announce that you are doing it; it is a display, not a step.',
  parameters: {
    type: 'object',
    properties: {
      university: { type: 'string', description: 'The university they have chosen.' },
      major: { type: 'string', description: 'What they want to study.' },
      service: {
        type: 'string',
        description: 'Which service they need, if that is what they just settled.',
        enum: [
          'university_registration',
          'student_visa',
          'ikamet_new',
          'ikamet_renewal',
          'health_insurance',
        ],
      },
    },
    required: [],
  },
} as const;

/**
 * Choosing a university is part of intake, not advice.
 *
 * A caller who wants university registration but has not picked a university
 * cannot be taken any further — the acceptance letter, the apostille and the
 * tuition receipt all come from ONE named school. So the call has to be able
 * to offer real options, and it must never invent them: the same rule the text
 * agent's suggest_universities carries.
 *
 * Executed in the browser and relayed to /api/voice/universities, because a
 * Realtime session's tools run wherever the data channel is — unlike the Qwen
 * agent's, which run server-side.
 */
const SUGGEST_UNIVERSITIES_TOOL = {
  type: 'function',
  name: 'suggest_universities',
  description:
    'Offer Turkish universities we work with. Call this as soon as a caller wants university registration but has not named a university, or asks which ones we have. ' +
    'Pass whatever they said — a city, a field of study, or a half-remembered name. ' +
    'Read back at most three, with their city, and ask which one they want. ' +
    'NEVER invent a university, a tuition price or an entry requirement; if asked about cost or grades, say you will confirm those and move on.',
  parameters: {
    type: 'object',
    properties: {
      nameGuess: {
        type: 'string',
        description: 'A university name the caller mentioned, however roughly they pronounced it.',
      },
      city: { type: 'string', description: 'A Turkish city they said they prefer.' },
      fieldOfStudy: { type: 'string', description: 'What they want to study, if they said.' },
    },
    required: [],
  },
} as const;

/**
 * Ending the call.
 *
 * The intake call's job is to find out which service the caller wants —
 * roadmaps, document lists and prices are built afterwards in the chat, where
 * there is a screen to show them on. So the heavy agent tools deliberately do
 * NOT hang off this session; wiring start_roadmap into a phone call would mean
 * reading a twelve-step plan aloud, which is the thing VOICE_STYLE forbids.
 */
const END_CALL_TOOL = {
  type: 'function',
  name: 'end_call',
  description:
    'Call this once you know which service the caller needs and the single detail that pins it down. ' +
    'Say your closing sentence out loud first, then call this. It hangs up the line.',
  parameters: {
    type: 'object',
    properties: {
      service: {
        type: 'string',
        description:
          'Which service the caller needs. Use ikamet_new for a first residence permit and ' +
          'ikamet_renewal for an extension — ask which if they have not said.',
        enum: [
          'university_registration',
          'student_visa',
          'ikamet_new',
          'ikamet_renewal',
          'health_insurance',
        ],
      },
      detail: {
        type: 'string',
        description:
          'The one detail that pins the service down — nationality, university, or whether it is a first application or an extension.',
      },
    },
    required: ['service'],
  },
} as const;

export async function POST(req: Request) {
  try {
    const key = process.env.OPENAI_API_KEY;
    if (!key) {
      return Response.json({ detail: 'realtime voice not configured' }, { status: 503 });
    }

    // Same door as the rest of voice: signed in, holding a credit or an admin.
    // A Realtime session bills per minute of audio, so an open endpoint here is
    // a worse bill than the per-sentence TTS one it replaces.
    const user = await getOptionalUser(req);
    if (!user) return Response.json({ detail: 'Not authenticated' }, { status: 401 });
    if (!user.is_admin) {
      const balance = await getCreditBalance(user.id);
      if (balance.available < 1) {
        return Response.json({ detail: 'Start a service to use voice.' }, { status: 402 });
      }
    }

    const body = await req.json().catch(() => null);
    const agent = normalizeAgent(body?.assistant_type);
    const lang = normalizeLang(body?.language);

    const instructions = [
      buildSystemPrompt({ agent, lang, isVoice: true, userName: user.full_name ?? undefined }),
      REALTIME_TOOL_MANNERS,
      REALTIME_ENDING,
    ].join('\n\n');

    const upstream = await fetch(CLIENT_SECRETS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        session: {
          type: 'realtime',
          model: REALTIME_MODEL,
          instructions,
          audio: {
            input: {
              // Transcribing the caller is what lets the call be filed as a
              // transcript afterwards, and what the on-screen caption reads.
              transcription: {
                model: 'gpt-live-transcribe',
                ...(TRANSCRIBE_LANG[lang] ? { language: TRANSCRIBE_LANG[lang] } : {}),
              },
              // Semantic turn detection waits for a finished THOUGHT rather
              // than for a gap in the waveform, which is what stops the agent
              // interrupting somebody who paused mid-sentence to think.
              turn_detection: { type: 'semantic_vad' },
            },
            output: { voice: REALTIME_VOICE },
          },
          tools: [END_CALL_TOOL, SUGGEST_UNIVERSITIES_TOOL, RECORD_CHOICE_TOOL],
          tool_choice: 'auto',
        },
      }),
    });

    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => '');
      // Logged verbatim: this endpoint cannot be exercised without a live key,
      // so the upstream message is the only diagnostic when it first runs.
      console.error('[voice/realtime] mint failed', upstream.status, detail.slice(0, 500));
      return Response.json({ detail: 'could not open voice session' }, { status: 503 });
    }

    const data = await upstream.json().catch(() => null);
    const secret = data?.value ?? data?.client_secret?.value;
    if (!secret) {
      console.error('[voice/realtime] no client secret in response', JSON.stringify(data).slice(0, 500));
      return Response.json({ detail: 'could not open voice session' }, { status: 503 });
    }

    return Response.json({
      client_secret: secret,
      expires_at: data?.expires_at ?? null,
      model: REALTIME_MODEL,
    });
  } catch (e) {
    if (e instanceof Response) return e;
    console.error('[voice/realtime]', e);
    return Response.json({ detail: 'Error' }, { status: 503 });
  }
}
