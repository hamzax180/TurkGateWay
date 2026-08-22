export const runtime = 'nodejs';

import { db } from '@/lib/db';
import { chatSessions, chatMessages, voiceCallTranscripts } from '@/lib/schema';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { requireUser } from '@/lib/user-helper';
import { checklistById, checklistView, pickLang } from '@/lib/document-checklists';

/**
 * POST /api/voice/transcript — file a finished voice call.
 *
 * Called once, when the caller hangs up. It does two things in one request so
 * a thread can never end up referencing a transcript that was not written, or
 * a transcript nothing points at:
 *
 *   1. stores the spoken turns in voice_call_transcripts
 *   2. appends ONE message to the thread, carrying that transcript's id
 *
 * The turns themselves never reach chat_messages. That is the whole point:
 * they are verbatim speech-recognition output, and interleaving them with
 * typed conversation both made threads unreadable and fed the recognition
 * noise back to the model as context on later questions.
 */

/** Longest call we will file. Past this the caller is almost certainly a bug. */
const MAX_TURNS = 400;
const MAX_TURN_CHARS = 4000;

interface Turn {
  role: 'user' | 'assistant';
  content: string;
}

/** Keep only well-formed turns; a malformed one is dropped, not fatal. */
function cleanTurns(raw: unknown): Turn[] {
  if (!Array.isArray(raw)) return [];
  const out: Turn[] = [];
  for (const item of raw.slice(0, MAX_TURNS)) {
    const role = (item as Turn)?.role;
    const content = String((item as Turn)?.content ?? '').trim();
    if ((role !== 'user' && role !== 'assistant') || !content) continue;
    out.push({ role, content: content.slice(0, MAX_TURN_CHARS) });
  }
  return out;
}

/** "3m 12s" / "48s" — the label the thread shows for the call. */
function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

/**
 * The four services, named in the caller's own language.
 *
 * The thread line is the only thing a finished call leaves behind, so it has
 * to say what was decided — "Voice call - 3m 12s" tells the caller nothing
 * they did not already know.
 */
const SERVICE_LABEL: Record<string, Record<string, string>> = {
  university_registration: { en: 'University registration', tr: 'Üniversite kaydı', ar: 'تسجيل جامعي', tk: 'Uniwersitet ýerleşdirmek', az: 'Universitet qeydiyyatı', uz: 'Universitetga joylashish', kk: 'Университетке тіркелу', fa: 'ثبت‌نام دانشگاه', ru: 'Поступление в университет' },
  student_visa: { en: 'Student visa', tr: 'Öğrenci vizesi', ar: 'تأشيرة طالب', tk: 'Talyp wizasy', az: 'Tələbə vizası', uz: 'Talaba vizasi', kk: 'Студенттік виза', fa: 'ویزای دانشجویی', ru: 'Студенческая виза' },
  ikamet_new: { en: 'Residence permit', tr: 'İkamet izni', ar: 'إقامة', tk: 'Ýaşaýyş rugsady', az: 'Yaşayış icazəsi', uz: 'Yashash ruxsati', kk: 'Ықтиярхат', fa: 'اقامت', ru: 'Вид на жительство' },
  health_insurance: { en: 'Health insurance', tr: 'Sağlık sigortası', ar: 'تأمين صحي', tk: 'Saglyk ätiýaçlandyryşy', az: 'Tibbi sığorta', uz: 'Tibbiy sugʻurta', kk: 'Медициналық сақтандыру', fa: 'بیمه درمانی', ru: 'Медицинская страховка' },
};

/**
 * Storable services, named exactly as the document checklists name them.
 *
 * Renewal is a genuinely different list from a first application, so the two
 * are kept apart here rather than collapsed into one "ikamet" and guessed at
 * later. The renewal label is borrowed from the first-application one, which
 * reads correctly in every language we ship.
 */
const SERVICES = [
  'university_registration',
  'student_visa',
  'ikamet_new',
  'ikamet_renewal',
  'health_insurance',
];
SERVICE_LABEL.ikamet_renewal = SERVICE_LABEL.ikamet_new;

const CALL_LABEL: Record<string, (d: string) => string> = {
  en: (d) => `Voice call — ${d}`,
  tr: (d) => `Sesli görüşme — ${d}`,
  ar: (d) => `مكالمة صوتية — ${d}`,
  tk: (d) => `Ses jaňy — ${d}`,
  az: (d) => `Səsli zəng — ${d}`,
  uz: (d) => `Ovozli qo'ng'iroq — ${d}`,
  kk: (d) => `Дауыстық қоңырау — ${d}`,
  fa: (d) => `تماس صوتی — ${d}`,
  ru: (d) => `Голосовой звонок — ${d}`,
};

export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
    const body = await req.json().catch(() => null);

    const sessionId = String(body?.session_id ?? '').trim();
    const turns = cleanTurns(body?.turns);
    const durationSeconds = Math.max(0, Math.floor(Number(body?.duration_seconds) || 0));
    const language = String(body?.language ?? 'en').trim().toLowerCase().slice(0, 10);
    const assistantType = String(body?.assistant_type ?? 'permit').trim().slice(0, 20);

    // What the call decided. Validated against the four we offer rather than
    // stored as sent — this arrives from a model, and a fifth service would
    // render as a blank chip nobody can act on.
    const rawService = String(body?.service ?? '').trim().toLowerCase();
    const service = SERVICES.includes(rawService) ? rawService : null;
    const detail = String(body?.detail ?? '').trim().slice(0, 500) || null;

    // A call where nobody said anything is not worth a row or a thread entry.
    if (!turns.length) {
      return Response.json({ saved: false, reason: 'empty' });
    }

    /**
     * A call started from a brand-new chat has no session yet — the thread is
     * only created when the first message is sent, and a voice call never
     * sends one. That used to mean the whole call was discarded: no
     * transcript, no thread entry, no document list. The caller talked for two
     * minutes and got nothing.
     *
     * So the call creates the chat it belongs in. The id comes back in the
     * response for the client to adopt, which is what makes the new thread
     * appear in the sidebar rather than the call vanishing into one that was
     * never saved.
     */
    let targetSessionId = sessionId;
    let createdSession = false;

    if (!targetSessionId || targetSessionId.startsWith('guest-')) {
      targetSessionId = randomUUID();
      await db.insert(chatSessions).values({
        id: targetSessionId,
        user_id: user.id,
        assistant_type: assistantType,
        language,
        // Titled below, once the service is known — a thread called
        // "Voice call" tells the caller nothing in a list of them.
        title: null,
      });
      createdSession = true;
    } else {
      // Owner-only, checked the same way the applications routes check it. A
      // foreign session id answers the same as a missing one.
      const owned = await db
        .select({ id: chatSessions.id })
        .from(chatSessions)
        .where(and(eq(chatSessions.id, targetSessionId), eq(chatSessions.user_id, user.id)))
        .limit(1);

      if (!owned.length) {
        return Response.json({ detail: 'Not found' }, { status: 404 });
      }
    }

    const inserted = await db
      .insert(voiceCallTranscripts)
      .values({
        session_id: targetSessionId,
        user_id: user.id,
        turns: JSON.stringify(turns),
        duration_seconds: durationSeconds,
        language,
        assistant_type: assistantType,
        service,
        detail,
      })
      .returning({ id: voiceCallTranscripts.id });

    const transcriptId = inserted[0]?.id;
    if (!transcriptId) {
      return Response.json({ detail: 'Error' }, { status: 500 });
    }

    // The single line the thread keeps. Written as an assistant message so it
    // renders on the side the call's outcome belongs to, and so a reopened
    // session shows the call in the right place in the order of events.
    const base = (CALL_LABEL[language] ?? CALL_LABEL.en)(formatDuration(durationSeconds));
    const serviceName = service
      ? (SERVICE_LABEL[service]?.[language] ?? SERVICE_LABEL[service]?.en ?? null)
      : null;
    const label = serviceName ? `${base} — ${serviceName}` : base;
    await db.insert(chatMessages).values({
      session_id: targetSessionId,
      role: 'assistant',
      content: label,
      transcript_id: transcriptId,
    });

    await db
      .update(chatSessions)
      .set({
        updated_at: new Date(),
        // Name a freshly created thread after what the call was about, so the
        // sidebar shows "Student visa" rather than an untitled row.
        ...(createdSession ? { title: serviceName ?? 'Voice call' } : {}),
      })
      .where(eq(chatSessions.id, targetSessionId));

    // The documents they now need, returned with the call rather than fetched
    // afterwards. The seed is a pure function of the checklist definition and
    // the language, so it costs nothing to build here and saves the client a
    // round trip at exactly the moment the caller is waiting to see it.
    const checklist = service ? checklistById(service) : null;
    const checklistSeed = checklist
      ? {
          service: checklist.id,
          agent: checklist.agent,
          items: checklistView(checklist, pickLang(language)),
        }
      : null;

    return Response.json({
      saved: true,
      // Always returned: the client adopts it, which is how a call started in
      // an empty chat ends up in a real thread the caller can carry on in.
      session_id: targetSessionId,
      created_session: createdSession,
      transcript_id: transcriptId,
      label,
      service,
      detail,
      checklist: checklistSeed,
      turns: turns.length,
    });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error('[api/voice/transcript]', e);
    return Response.json({ detail: 'Error' }, { status: 500 });
  }
}
