export const runtime = 'nodejs';
export const maxDuration = 60;

import { db } from '@/lib/db';
import { and, eq } from 'drizzle-orm';
import { applications, chatSessions } from '@/lib/schema';
import { requireUser } from '@/lib/user-helper';
import { getChecklistStatus, applicationKindFor } from '@/lib/checklist-status';
import { checkEntitlement, entitlementResponse } from '@/lib/entitlements';
import { parseStoredData } from '@/lib/intake-core';
import { extractFromDocuments } from '@/lib/document-extract';
import { missingFields } from '@/lib/visa-fields';
import { missingIkametFields } from '@/lib/ikamet-fields';
import { generateFormPdf, storeGeneratedForm, type FormKind } from '@/lib/form-docs';

/**
 * POST /api/applications/automate
 * Body: { session_id, service, lang? }
 *
 * Starts the automation for a service the moment its documents are complete —
 * the checklist card calls this itself, so nobody has to find and press a
 * button after uploading the last file.
 *
 * What "starting" means depends on how far the pipeline can go from a
 * serverless request:
 *
 *  - The filled application form IS generated here and returned, because that
 *    is pure computation over data we already hold.
 *  - The portal submission is NOT, and cannot be: e-ikamet and the consulate
 *    appointment systems need a real browser session on an operator machine
 *    (see scripts/visa-booking-assistant/watch.mjs). So the application is
 *    placed in the `ready` queue that the watcher claims.
 *
 * The response says which of those actually happened rather than implying the
 * booking is done.
 */

const APPLICATION_TO_FORM: Record<string, FormKind | undefined> = {
  visa_appointment: 'visa',
  ikamet: 'ikamet',
  university: undefined,
  insurance: undefined,
  business: undefined,
};

export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
    const body = await req.json().catch(() => null);

    const sessionId = String(body?.session_id ?? '');
    const service = String(body?.service ?? '');
    const lang = String(body?.lang ?? 'en');
    if (!sessionId || !service) {
      return Response.json({ detail: 'session_id and service required' }, { status: 400 });
    }

    const [session] = await db
      .select({ id: chatSessions.id })
      .from(chatSessions)
      .where(and(eq(chatSessions.id, sessionId), eq(chatSessions.user_id, user.id)))
      .limit(1);
    if (!session) return Response.json({ detail: 'Not your conversation.' }, { status: 403 });

    const kind = applicationKindFor(service);
    if (!kind) return Response.json({ detail: 'Unknown service' }, { status: 404 });

    // Same paywall as the checklist endpoint. Automation is the most expensive
    // thing the platform does, so it must never run for an unpaid placement.
    if (kind === 'university') {
      const gate = await checkEntitlement({ feature: 'university_automation', sessionId });
      if (!gate.allowed) return entitlementResponse(gate);
    }

    // Automation is gated on the documents, not on the user's word for it.
    const status = await getChecklistStatus({ sessionId, serviceId: service, lang });
    if (!status) return Response.json({ detail: 'Unknown service' }, { status: 404 });
    if (!status.complete) {
      return Response.json(
        { detail: 'Not all documents are uploaded yet.', status },
        { status: 409 },
      );
    }

    const [application] = await db
      .select()
      .from(applications)
      .where(and(eq(applications.session_id, sessionId), eq(applications.kind, kind)))
      .limit(1);
    if (!application) return Response.json({ detail: 'No application found.' }, { status: 404 });

    // Read the uploads before deciding what is still missing — most of a visa
    // form is printed on the passport the applicant just gave us, and asking
    // for it again is the slowest part of the whole flow.
    const extraction = await extractFromDocuments({ sessionId, kind }).catch(() => null);

    const [refreshed] = await db
      .select()
      .from(applications)
      .where(eq(applications.id, application.id))
      .limit(1);
    const data = parseStoredData((refreshed ?? application).data);

    // Queue it for the watcher. Anything already further along stays put — an
    // application being worked is not sent back to the start of the queue.
    const locked = new Set(['in_progress', 'submitted', 'booked', 'forwarded', 'done']);
    if (!locked.has(application.status)) {
      await db
        .update(applications)
        .set({ status: 'ready', updated_at: new Date() })
        .where(eq(applications.id, application.id));
    }

    // Generate the filled form where one exists and the intake is complete.
    let form: { documentId: number; filename: string } | null = null;
    // Keyed, not just labelled: the card renders an input per outstanding
    // field, so it needs to know which field each one is.
    let missing: { key: string; label: string }[] = [];

    const formKind = APPLICATION_TO_FORM[kind];
    if (formKind) {
      // Each service owns its field vocabulary, so ask that service what is
      // outstanding rather than checking one list against all of them.
      const outstanding =
        kind === 'visa_appointment' ? missingFields(data) : missingIkametFields(data);
      missing = outstanding.map((f) => ({ key: f.key, label: f.short }));

      if (missing.length === 0) {
        try {
          // generateFormPdf returns both the bytes and its own suggested name.
          const generated = await generateFormPdf(formKind, data);
          const stored = await storeGeneratedForm({
            sessionId,
            userId: user.id,
            kind: formKind,
            filename: generated.filename,
            bytes: generated.bytes,
          });
          form = { documentId: stored.documentId, filename: generated.filename };
        } catch (err) {
          // A form that fails to render must not block the queue entry — the
          // operator can still work the application from the uploads.
          console.error('[automate] form generation failed', err);
          form = null;
        }
      }
    }

    const fresh = await getChecklistStatus({ sessionId, serviceId: service, lang });

    return Response.json({
      started: true,
      queued: true,
      /** Details still needed before the form can be filled, if any. */
      missing,
      form,
      /** What reading the uploads produced, so the UI can show its work. */
      extracted: extraction?.filled ?? [],
      unreadable: extraction?.unreadable ?? [],
      status: fresh ?? status,
    });
  } catch (e) {
    if (e instanceof Response) return e;
    console.error('[applications/automate]', e);
    return Response.json({ detail: 'Error' }, { status: 500 });
  }
}
