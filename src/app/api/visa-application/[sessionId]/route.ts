export const runtime = 'nodejs';

import { db } from '@/lib/db';
import { applications, applicationDocuments } from '@/lib/schema';
import { eq, and } from 'drizzle-orm';
import { requireAdmin } from '@/lib/user-helper';
import { INTAKE_FIELDS, parseIntake, missingFields } from '@/lib/visa-intake';

type Ctx = { params: Promise<{ sessionId: string }> };

async function loadApplication(sessionId: string) {
  const rows = await db
    .select()
    .from(applications)
    .where(and(eq(applications.session_id, sessionId), eq(applications.kind, 'visa_appointment')))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Manual fallback for when the booking watcher isn't running: fetch one
 * application's details and its supporting document as JSON, so an operator
 * can save them locally and run `visa:find-slot --bundle`.
 *
 * Admin-only — this returns passport data and the applicant's letter.
 */
export async function GET(req: Request, { params }: Ctx) {
  try {
    await requireAdmin(req);
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }

  const { sessionId } = await params;
  const application = await loadApplication(sessionId);
  if (!application) {
    return Response.json({ detail: 'No application for that session' }, { status: 404 });
  }

  const intake = parseIntake(application.data);
  const applicant: Record<string, string> = {
    nationality: 'Turkmenistan',
    travelDocumentType: 'Ordinary Passport',
    applicantCount: '1',
  };
  for (const field of INTAKE_FIELDS) {
    if (intake[field.key]) applicant[field.key] = intake[field.key];
  }

  const docs = await db
    .select()
    .from(applicationDocuments)
    .where(eq(applicationDocuments.application_id, application.id))
    .limit(1);

  return Response.json({
    id: application.id,
    sessionId: application.session_id,
    status: application.status,
    missing: missingFields(intake).map((f) => f.label),
    applicant,
    document: docs.length
      ? {
          filename: docs[0].filename,
          mimeType: docs[0].mime_type,
          sizeBytes: docs[0].size_bytes,
          base64: Buffer.from(docs[0].data).toString('base64'),
        }
      : null,
  });
}

/**
 * Purge an application and its documents once the appointment is booked.
 *
 * This is the mechanism that keeps passport data short-lived rather than
 * accumulating indefinitely, so it deletes outright — the row is gone, not
 * flagged. `purge_after` in the schema is the backstop for anything that
 * never gets here.
 */
export async function DELETE(req: Request, { params }: Ctx) {
  try {
    await requireAdmin(req);
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }

  const { sessionId } = await params;
  const application = await loadApplication(sessionId);
  if (!application) {
    return Response.json({ detail: 'No application for that session' }, { status: 404 });
  }

  // application_documents cascades on the foreign key.
  await db.delete(applications).where(eq(applications.id, application.id));

  return Response.json({ purged: application.id });
}
