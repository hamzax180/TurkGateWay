export const runtime = 'nodejs';
export const maxDuration = 60;

import { db } from '@/lib/db';
import { users, chatSessions, chatMessages } from '@/lib/schema';
import { eq } from 'drizzle-orm';
import { getOptionalUser, shouldResetTokens, defaultTokens } from '@/lib/user-helper';
import { streamAgentReply, MissingModelKeyError, type VisaIntakeState } from '@/lib/agent-router';
import { refundCredit } from '@/lib/credits';
import { storeDocument, safeFilename } from '@/lib/application-documents';
import { applicationKindFor } from '@/lib/checklist-status';
import { refreshReadiness, INTAKE_FIELDS } from '@/lib/visa-intake';
import { touchTicket } from '@/lib/support-tickets';
import { DEFAULT_AGENT, isAgentDisabled } from '@/lib/agents-config';

// Rate limiting lives in middleware.ts now (the `llm` tier). The private
// limiter that used to sit here only existed when Upstash was configured and
// had no fallback, so without it this — the most expensive endpoint in the
// product — was completely unmetered, guests included.

/**
 * Server-sent event frames consumed by src/app/chat/page.tsx:
 *   meta      { source, token_balance, session_title }  — sent immediately
 *   delta     { t }                                     — a chunk of reply text
 *   dashboard { state }                                 — roadmap ready
 *   visa_intake { collected, missing, ... }             — visa intake progress
 *   university_intake { collected, missing, status }    — university intake
 *   ikamet_intake / insurance_intake / business_intake  — same shape
 *   document_checklist { service, items }               — upload checklist
 *   attachment { filename, url }                        — generated document
 *   done {}
 *   error { detail }
 */
function frame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  // Stops nginx/proxies from buffering the stream into one blob
  'X-Accel-Buffering': 'no',
};

export async function POST(req: Request) {
  try {
    // Parse multipart or JSON
    let query = '';
    let language = 'en';
    let sessionId = '';
    let assistantType = 'permit';
    let uploadService = '';
    let uploadDocKind = '';
    let isStepQuery = false;
    let isVoice = false;
    let confirmCredit = false;
    let bodyJson: any = null;

    let upload: File | null = null;

    const ct = req.headers.get('content-type') ?? '';
    if (ct.includes('multipart/form-data')) {
      const form = await req.formData();
      query = String(form.get('query') ?? '');
      language = String(form.get('language') ?? 'en');
      sessionId = String(form.get('session_id') ?? '');
      assistantType = String(form.get('assistant_type') ?? 'permit');
      // These four used to be read only on the JSON path, so attaching a file
      // silently downgraded the request — no history, no voice mode, and an
      // already-confirmed credit prompt would ask again.
      isStepQuery = String(form.get('is_step_query') ?? '') === 'true';
      isVoice = String(form.get('is_voice') ?? '') === 'true';
      confirmCredit = String(form.get('confirm_credit') ?? '') === 'true';
      const historyRaw = form.get('history');
      if (typeof historyRaw === 'string' && historyRaw) {
        try {
          bodyJson = { history: JSON.parse(historyRaw) };
        } catch {
          // Malformed history is not worth failing the request over — the
          // route already falls back to the stored transcript.
        }
      }
      const filePart = form.get('file');
      if (filePart && typeof filePart === 'object' && 'arrayBuffer' in filePart) {
        upload = filePart as File;
      }
      // Which checklist the file belongs to, when the client knows. Without it
      // an İkamet or university document would be filed against the visa
      // application, because that was the only flow uploads originally had.
      uploadService = String(form.get('service') ?? '');
      uploadDocKind = String(form.get('doc_kind') ?? '');
    } else {
      const body = await req.json();
      bodyJson = body;
      query = body.query ?? '';
      language = body.language ?? 'en';
      sessionId = body.context?.session_id ?? body.session_id ?? '';
      assistantType = body.assistant_type ?? 'permit';
      isStepQuery = body.is_step_query === true;
      isVoice = body.is_voice === true;
      // Set only after the user has seen and accepted the credit prompt.
      confirmCredit = body.confirm_credit === true;
    }

    if (!query.trim()) {
      return Response.json({ detail: 'Query required' }, { status: 400 });
    }

    // A disabled agent can still arrive here from a stale tab or an old session
    // row, so it is folded back onto the enabled default. 'support' and other
    // non-agent types pass through untouched.
    if (isAgentDisabled(assistantType)) {
      assistantType = DEFAULT_AGENT;
    }

    // Auth (optional — guests allowed)
    let user = await getOptionalUser(req);

    // Token balance check + reset
    if (user) {
      if (shouldResetTokens(user)) {
        const balance = defaultTokens(user);
        await db.update(users).set({ token_balance: balance, last_token_reset: new Date() }).where(eq(users.id, user.id));
        user = { ...user, token_balance: balance, last_token_reset: new Date() };
      }

      if ((user.token_balance ?? 0) <= 0) {
        const reset = new Date(user.last_token_reset ?? new Date());
        const isActive = user.subscription_status === 'active';
        reset.setTime(reset.getTime() + (isActive ? 30 * 24 * 60 * 60 * 1000 : 12 * 60 * 60 * 1000));
        const resetStr = reset.toLocaleString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
        return Response.json({ detail: `Model quota reached|${resetStr}` }, { status: 403 });
      }
    }

    // Store an attached document before generating anything, so the model's
    // reply can already reflect that it arrived. Rejections are returned to
    // the user rather than swallowed — silently dropping someone's acceptance
    // letter is exactly the bug this route had before.
    let uploadNote = '';
    let uploadIntake: VisaIntakeState | null = null;
    if (upload) {
      if (!sessionId || sessionId.startsWith('guest-')) {
        return Response.json(
          { detail: 'Please sign in before uploading documents so they stay attached to your application.' },
          { status: 401 },
        );
      }
      // A named service wins; otherwise fall back to the visa flow, which is
      // the one the bare "+" attach button was originally built for.
      const resolvedKind =
        (uploadService && applicationKindFor(uploadService)) || 'visa_appointment';

      const stored = await storeDocument({
        sessionId,
        userId: user?.id ?? null,
        file: upload,
        applicationKind: resolvedKind,
        // storeDocument replaces same-kind rows, so an untagged upload must not
        // reuse another document's kind or it would delete it.
        kind: uploadDocKind || undefined,
      }).catch((e) => ({ ok: false as const, reason: e?.message ?? 'Upload failed.' }));

      if (!stored.ok) {
        return Response.json({ detail: stored.reason }, { status: 400 });
      }
      // The document may have been the last thing outstanding, so re-check
      // whether the application is now complete.
      const readiness = await refreshReadiness(sessionId).catch(() => null);
      const outstanding = readiness?.missing.map((f) => f.label) ?? [];
      if (readiness) {
        // An upload can complete an application on its own, without the model
        // calling the intake tool — so the checklist has to be told directly.
        uploadIntake = {
          collected: INTAKE_FIELDS.filter((f) => readiness.data[f.key]).map((f) => f.short),
          missing: readiness.missing.map((f) => f.short),
          documentAttached: readiness.documentPresent,
          status: readiness.application.status,
        };
      }
      uploadNote = outstanding.length
        ? `[The applicant just uploaded "${safeFilename(upload.name)}" — it is saved. Acknowledge it in one short sentence, then ask for: ${outstanding.slice(0, 3).join(', ')}.]`
        : `[The applicant just uploaded "${safeFilename(upload.name)}" — it is saved. Acknowledge it in one short sentence.]`;
    }

    // Conversation history for the model. The client sends what it has rendered;
    // otherwise fall back to the stored transcript.
    let recentMessages: Array<{ role: string; content: string }> = [];
    if (bodyJson && Array.isArray(bodyJson.history)) {
      recentMessages = bodyJson.history
        .map((m: any) => ({ role: String(m.role), content: String(m.content) }))
        .slice(-12);
    } else if (sessionId && !sessionId.startsWith('guest-')) {
      try {
        recentMessages = await db
          .select({ role: chatMessages.role, content: chatMessages.content })
          .from(chatMessages)
          .where(eq(chatMessages.session_id, sessionId))
          .orderBy(chatMessages.timestamp)
          .limit(12);
      } catch { /* DB unavailable — skip context */ }
    }

    // First name for personalized greetings (logged-in users only)
    const firstName = user?.full_name ? String(user.full_name).trim().split(/\s+/)[0] : undefined;

    let result;
    try {
      result = await streamAgentReply({
        query: uploadNote ? `${query}

${uploadNote}` : query,
        language,
        assistantType,
        sessionId: sessionId || undefined,
        messages: recentMessages,
        userName: firstName,
        isStepQuery,
        isVoice,
        userId: user?.id,
        creditsConfirmed: confirmCredit,
      });
    } catch (e) {
      if (e instanceof MissingModelKeyError) {
        return Response.json({ detail: e.message }, { status: 503 });
      }
      throw e;
    }

    // A roadmap costs a service credit. Nothing was generated and nothing was
    // charged — ask the user to confirm, then they re-send with confirm_credit.
    if (result.kind === 'confirm_required') {
      return Response.json({ confirm_required: result.pending }, { status: 402 });
    }

    // The roadmap path makes no model call, so it costs no quota.
    const chargesToken = Boolean(user) && result.kind === 'stream';
    const newBalance = chargesToken
      ? Math.max(0, (user!.token_balance ?? 1) - 1)
      : (user?.token_balance ?? null);

    // Auto-generate the session title from the first message
    let sessionTitle: string | null = null;
    if (sessionId && user) {
      try {
        const [session] = await db.select().from(chatSessions).where(eq(chatSessions.id, sessionId));
        if (session && !session.title) {
          sessionTitle = query.length > 50 ? query.slice(0, 47) + '...' : query;
          await db.update(chatSessions).set({ title: sessionTitle, updated_at: new Date() }).where(eq(chatSessions.id, sessionId));
        }
      } catch { /* non-fatal */ }
    }

    const shouldSave = bodyJson?.save_history !== false && Boolean(sessionId) && !sessionId.startsWith('guest-');

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: string, data: unknown) => {
          controller.enqueue(encoder.encode(frame(event, data)));
        };

        let fullText = '';

        try {
          send('meta', {
            source: result.kind === 'workflow' ? 'workflow' : 'ai',
            token_balance: newBalance,
            session_title: sessionTitle,
          });

          if (result.kind === 'workflow') {
            fullText = result.content;
            send('delta', { t: fullText });
            send('dashboard', { state: result.dashboardState });
          } else {
            for await (const chunk of result.textStream) {
              if (req.signal.aborted) break;
              fullText += chunk;
              send('delta', { t: chunk });
            }

            // Citation line for knowledge-base grounded answers
            if (result.sources.length && fullText.trim()) {
              const sourceLabels: Record<string, string> = {
                en: 'Sources',
                tr: 'Kaynaklar',
                ar: 'المصادر',
                tk: 'Çeşmeler',
                az: 'Mənbələr',
                uz: 'Manbalar',
                kk: 'Дереккөздер',
                fa: 'منابع',
                ru: 'Источники',
              };
              const label = sourceLabels[language] ?? 'Sources';
              const cite = `\n\n*_${label}: ${result.sources.join(', ')}_*`;
              fullText += cite;
              send('delta', { t: cite });
            }

            const state = result.getDashboardState();
            if (state) send('dashboard', { state });

            // Visa intake progress, so the chat can render a live checklist.
            // Field labels only — never the answers themselves.
            const intake = result.getVisaIntake() ?? uploadIntake;
            if (intake) send('visa_intake', intake);

            // University intake progress, same values-never-leave-the-server
            // rule as the visa event.
            const university = result.getUniversityIntake();
            if (university) send('university_intake', university);

            // İkamet / insurance / business intake progress, same contract.
            const ikamet = result.getIkametIntake();
            if (ikamet) send('ikamet_intake', ikamet);

            const insurance = result.getInsuranceIntake();
            if (insurance) send('insurance_intake', insurance);

            const business = result.getBusinessIntake();
            if (business) send('business_intake', business);

            // The free "what do I need to upload" checklist, resolved to the
            // conversation language — the client renders it as a card.
            const checklist = result.getDocumentChecklist();
            if (checklist) {
              send('document_checklist', checklist);
              // Remember which service this conversation is about, so reopening
              // it can rebuild the upload card. Until a document is uploaded
              // there is no application row to infer it from.
              if (sessionId && !sessionId.startsWith('guest-')) {
                db.update(chatSessions)
                  .set({ service_id: checklist.service })
                  .where(eq(chatSessions.id, sessionId))
                  .catch(() => {});
              }
            }

            // The model wanted to build a roadmap but the user has not agreed
            // to spend a credit yet — nothing was charged or generated.
            const pending = result.getPendingConfirm();
            if (pending) send('confirm_required', pending);

            // A generated form (deliver_form) — the client renders a
            // downloadable file chip on the assistant message.
            const attachment = result.getAttachment();
            if (attachment) send('attachment', attachment);
          }

          send('done', {});
        } catch (e) {
          console.error('[agent/query] stream', e);
          send('error', { detail: 'The assistant could not finish that response. Please try again.' });

          // A credit was spent but no roadmap reached the user — give it back.
          const spent = result.kind === 'workflow'
            ? result.consumedCreditId
            : result.getConsumedCreditId();
          if (spent && user) {
            await refundCredit(spent, user.id, 'stream failed').catch(err =>
              console.error('[agent/query] refund failed', err),
            );
          }
        } finally {
          // Charge and persist only what was actually produced
          try {
            if (chargesToken && fullText.trim()) {
              await db.update(users).set({ token_balance: newBalance }).where(eq(users.id, user!.id));
            }
            if (shouldSave && fullText.trim()) {
              const attachment = result.kind === 'stream' ? result.getAttachment() : null;
              await db.insert(chatMessages).values([
                { session_id: sessionId, role: 'user', content: query },
                {
                  session_id: sessionId,
                  role: 'assistant',
                  content: fullText,
                  attachment_id: attachment?.documentId ?? null,
                  attachment_filename: attachment?.filename ?? null,
                },
              ]);
            }
          } catch (dbErr) {
            console.error('[agent/query] persist', dbErr);
          }

          // Support conversations are also tickets — stamp activity and, on the
          // very first reply, the response time the admin panel reports on.
          if (assistantType === 'support' && fullText.trim()) {
            await touchTicket(sessionId, { agentReplied: true });
          }

          controller.close();
        }
      },
    });

    return new Response(stream, { headers: SSE_HEADERS });
  } catch (e: any) {
    console.error('[agent/query]', e);
    return Response.json({ detail: 'Internal error' }, { status: 500 });
  }
}
