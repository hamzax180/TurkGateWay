export const runtime = 'nodejs';
export const maxDuration = 60;

import { db } from '@/lib/db';
import { and, eq } from 'drizzle-orm';
import { applicationDocuments, applications, chatSessions } from '@/lib/schema';
import { requireUser } from '@/lib/user-helper';
import { parseStoredData } from '@/lib/intake-core';
import { INTAKE_FIELDS, missingFields } from '@/lib/visa-fields';
import { startRun } from '@/lib/browser-automation';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * POST /api/automation/start
 * Body: { session_id }
 *
 * Opens the visa appointment site on the server and begins filling the
 * applicant's details, streaming the page back to them. This is the button
 * that replaces "download the desktop app and run a script".
 *
 * Only the visa appointment has a booking site wired up today; the other
 * services queue for an operator instead.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
    const body = await req.json().catch(() => null);
    const sessionId = String(body?.session_id ?? '');
    if (!sessionId) return Response.json({ detail: 'session_id required' }, { status: 400 });

    const [session] = await db
      .select({ id: chatSessions.id })
      .from(chatSessions)
      .where(and(eq(chatSessions.id, sessionId), eq(chatSessions.user_id, user.id)))
      .limit(1);
    if (!session) return Response.json({ detail: 'Not your conversation.' }, { status: 403 });

    const [application] = await db
      .select()
      .from(applications)
      .where(
        and(eq(applications.session_id, sessionId), eq(applications.kind, 'visa_appointment')),
      )
      .limit(1);
    if (!application) {
      return Response.json({ detail: 'No visa application on this conversation.' }, { status: 404 });
    }

    const data = parseStoredData(application.data);

    // The site's form is the point — starting it without the answers would
    // just show the applicant an empty page filling itself in with nothing.
    const missing = missingFields(data);
    if (missing.length) {
      return Response.json(
        {
          detail: 'Some details are still missing.',
          missing: missing.map((f) => f.short),
        },
        { status: 409 },
      );
    }

    const applicant: Record<string, string> = { applicantCount: '1', travelDocumentType: 'Ordinary Passport' };
    for (const field of INTAKE_FIELDS) {
      const value = data[field.key];
      if (value) applicant[field.key] = value;
    }

    // The acceptance letter is attached to the form's upload field, so it has
    // to exist as a real file for Playwright to hand over.
    let documentPath: string | null = null;
    const docs = await db
      .select({
        kind: applicationDocuments.kind,
        filename: applicationDocuments.filename,
        mime_type: applicationDocuments.mime_type,
        data: applicationDocuments.data,
      })
      .from(applicationDocuments)
      .where(eq(applicationDocuments.application_id, application.id));

    const letter =
      docs.find((d) => d.kind.startsWith('acceptance')) ??
      docs.find((d) => !d.kind.startsWith('generated_'));

    if (letter) {
      const dir = join(tmpdir(), `visa-run-${application.id}`);
      await mkdir(dir, { recursive: true });
      const ext =
        letter.mime_type === 'application/pdf' ? '.pdf' : letter.mime_type === 'image/png' ? '.png' : '.jpg';
      documentPath = join(dir, `acceptance-letter${ext}`);
      await writeFile(documentPath, Buffer.from(letter.data));
      applicant.mainSupportingDocumentPath = documentPath;
    }

    const started = await startRun({
      userId: user.id,
      applicationId: application.id,
      applicant,
      documentPath,
    });

    if (!started.ok) return Response.json({ detail: started.reason }, { status: 503 });
    return Response.json({ runId: started.id });
  } catch (e) {
    if (e instanceof Response) return e;
    console.error('[automation/start]', e);
    return Response.json({ detail: 'Error' }, { status: 500 });
  }
}
