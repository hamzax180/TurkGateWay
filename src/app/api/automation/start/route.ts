export const runtime = 'nodejs';
export const maxDuration = 60;

import { db } from '@/lib/db';
import { and, eq } from 'drizzle-orm';
import { applicationDocuments, applications, chatSessions } from '@/lib/schema';
import { requireUser } from '@/lib/user-helper';
import { parseStoredData } from '@/lib/intake-core';
import { INTAKE_FIELDS, missingFields } from '@/lib/visa-fields';
import { missingIkametFields } from '@/lib/ikamet-fields';
import { applicationKindFor } from '@/lib/checklist-status';
import { documentSlotFor, toAssistantApplicant } from '@/lib/ikamet-applicant';
import { IKAMET_EXT_URL, IKAMET_FIRST_URL } from '@/lib/ikamet-automation';
import { startRun, type ApplicantData, type Portal } from '@/lib/browser-automation';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * POST /api/automation/start
 * Body: { session_id, service? }
 *
 * Opens the applicant's portal on the server and begins filling their details,
 * streaming the page back to them. This is the button that replaces "download
 * the desktop app and run a script".
 *
 * Two services have a site wired up. The visa appointment hunts a calendar;
 * e-İkamet walks a multi-page form and attaches the documents already uploaded
 * here. İkamet in particular has to run this way rather than as a link the
 * student opens themselves: the portal now mails a one-time verification link
 * bound to the session that started the application, so the browser holding
 * that session has to be one we can hand the link back to.
 *
 * Everything else still queues for an operator.
 */

/** Uploads are bytes in a row; Playwright hands over a path, so they land here. */
function extensionFor(mime: string, filename: string): string {
  const fromName = /\.[a-z0-9]{2,4}$/i.exec(filename)?.[0];
  if (fromName) return fromName.toLowerCase();
  if (mime === 'application/pdf') return '.pdf';
  if (mime === 'image/png') return '.png';
  return '.jpg';
}

export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
    const body = await req.json().catch(() => null);
    const sessionId = String(body?.session_id ?? '');
    if (!sessionId) return Response.json({ detail: 'session_id required' }, { status: 400 });

    // The checklist card names the service it is showing. Older callers only
    // ever meant the visa appointment, which is what they still get.
    const service = String(body?.service ?? 'student_visa');
    const kind = applicationKindFor(service);
    if (kind !== 'visa_appointment' && kind !== 'ikamet') {
      return Response.json(
        { detail: 'That service has no portal to open — it is worked from the queue.' },
        { status: 400 },
      );
    }

    const [session] = await db
      .select({ id: chatSessions.id })
      .from(chatSessions)
      .where(and(eq(chatSessions.id, sessionId), eq(chatSessions.user_id, user.id)))
      .limit(1);
    if (!session) return Response.json({ detail: 'Not your conversation.' }, { status: 403 });

    const [application] = await db
      .select()
      .from(applications)
      .where(and(eq(applications.session_id, sessionId), eq(applications.kind, kind)))
      .limit(1);
    if (!application) {
      return Response.json({ detail: 'No application of that kind on this conversation.' }, { status: 404 });
    }

    const data = parseStoredData(application.data);

    // The site's form is the point — starting it without the answers would
    // just show the applicant an empty page filling itself in with nothing.
    // Each service owns its field vocabulary, so ask that service.
    const missing = kind === 'ikamet' ? missingIkametFields(data) : missingFields(data);
    if (missing.length) {
      return Response.json(
        { detail: 'Some details are still missing.', missing: missing.map((f) => f.short) },
        { status: 409 },
      );
    }

    const docs = await db
      .select({
        kind: applicationDocuments.kind,
        filename: applicationDocuments.filename,
        mime_type: applicationDocuments.mime_type,
        data: applicationDocuments.data,
      })
      .from(applicationDocuments)
      .where(eq(applicationDocuments.application_id, application.id));

    let applicant: ApplicantData;
    let portal: Portal;
    let targetUrl: string | undefined;
    let documentPath: string | null = null;
    let tempDir: string | null = null;

    if (kind === 'ikamet') {
      portal = 'ikamet';
      const isExtension = service === 'ikamet_renewal';
      targetUrl = isExtension ? IKAMET_EXT_URL : IKAMET_FIRST_URL;

      const fields = toAssistantApplicant(data, isExtension);

      // Every scan the portal has an upload slot for, written out under the
      // slot name the assistant's label matcher resolves to. A document whose
      // kind maps to nothing is left behind rather than guessed at — the
      // assistant reports that slot as the applicant's to attach.
      tempDir = join(tmpdir(), `ikamet-run-${application.id}-${Date.now()}`);
      await mkdir(tempDir, { recursive: true });

      const documents: Record<string, string> = {};
      for (const doc of docs) {
        const slot = documentSlotFor(doc.kind);
        // First one wins: two uploads mapping to one slot means one file, and
        // silently replacing it would attach whichever row came back last.
        if (!slot || documents[slot]) continue;
        const path = join(tempDir, `${slot}${extensionFor(doc.mime_type, doc.filename)}`);
        await writeFile(path, Buffer.from(doc.data));
        documents[slot] = path;
      }

      applicant = { ...fields, documents };
    } else {
      portal = 'visa';
      const visa: Record<string, string> = {
        applicantCount: '1',
        travelDocumentType: 'Ordinary Passport',
      };
      for (const field of INTAKE_FIELDS) {
        const value = data[field.key];
        if (value) visa[field.key] = value;
      }

      // The acceptance letter is attached to the form's upload field, so it has
      // to exist as a real file for Playwright to hand over.
      const letter =
        docs.find((d) => d.kind.startsWith('acceptance')) ??
        docs.find((d) => !d.kind.startsWith('generated_'));

      if (letter) {
        tempDir = join(tmpdir(), `visa-run-${application.id}`);
        await mkdir(tempDir, { recursive: true });
        documentPath = join(tempDir, `acceptance-letter${extensionFor(letter.mime_type, letter.filename)}`);
        await writeFile(documentPath, Buffer.from(letter.data));
        visa.mainSupportingDocumentPath = documentPath;
      }
      applicant = visa;
    }

    const started = await startRun({
      userId: user.id,
      applicationId: application.id,
      portal,
      applicant,
      targetUrl,
      documentPath,
      tempDir,
    });

    if (!started.ok) return Response.json({ detail: started.reason }, { status: 503 });
    return Response.json({ runId: started.id, portal });
  } catch (e) {
    if (e instanceof Response) return e;
    console.error('[automation/start]', e);
    return Response.json({ detail: 'Error' }, { status: 500 });
  }
}
