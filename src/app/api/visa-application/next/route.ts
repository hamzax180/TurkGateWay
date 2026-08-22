export const runtime = 'nodejs';

import { db } from '@/lib/db';
import { applications, applicationDocuments } from '@/lib/schema';
import { eq, and, sql } from 'drizzle-orm';
import { requireAdmin } from '@/lib/user-helper';
import { INTAKE_FIELDS, parseIntake } from '@/lib/visa-intake';

/**
 * Claim the next completed visa application for the local booking watcher
 * (scripts/visa-booking-assistant/watch.mjs).
 *
 * The watcher runs a real browser on an operator's machine — the chat runs
 * serverless and cannot drive a browser — so this endpoint is the handoff.
 * It hands back exactly one application and marks it in_progress in the same
 * statement, so two watchers polling at once can never grab the same one.
 *
 * Admin-only. The response contains passport-level PII and a scan of the
 * applicant's acceptance letter.
 */
export async function GET(req: Request) {
  try {
    await requireAdmin(req);
  } catch (e) {
    // requireUser/requireAdmin signal failure by throwing a Response.
    if (e instanceof Response) return e;
    throw e;
  }

  // Claim atomically. SKIP LOCKED steps over rows another watcher is already
  // taking rather than blocking on them — the same approach consumeCredit()
  // uses in src/lib/credits.ts.
  const claimed = await db.execute(sql`
    UPDATE ${applications}
    SET status = 'in_progress', updated_at = now()
    WHERE id = (
      SELECT id FROM ${applications}
      WHERE kind = 'visa_appointment' AND status = 'ready'
      ORDER BY created_at
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id, session_id, data
  `);

  const row = (claimed.rows ?? claimed)[0] as
    | { id: number; session_id: string; data: string }
    | undefined;

  if (!row) {
    return Response.json({ application: null });
  }

  const intake = parseIntake(row.data);

  const docs = await db
    .select()
    .from(applicationDocuments)
    .where(eq(applicationDocuments.application_id, row.id))
    .limit(1);

  // Shaped to match scripts/visa-booking-assistant/applicant.json so the
  // watcher can hand it straight to the existing fill logic.
  const applicant: Record<string, string> = {
    nationality: 'Turkmenistan',
    travelDocumentType: 'Ordinary Passport',
    applicantCount: '1',
  };
  for (const field of INTAKE_FIELDS) {
    const value = intake[field.key];
    if (value) applicant[field.key] = value;
  }

  return Response.json({
    application: {
      id: row.id,
      sessionId: row.session_id,
      applicant,
      document: docs.length
        ? {
            filename: docs[0].filename,
            mimeType: docs[0].mime_type,
            sizeBytes: docs[0].size_bytes,
            base64: Buffer.from(docs[0].data).toString('base64'),
          }
        : null,
    },
  });
}

/**
 * Release a claim without deleting anything — used when the watcher stops
 * before an appointment is booked, so the application returns to the queue
 * instead of being stranded in in_progress forever.
 */
export async function POST(req: Request) {
  try {
    await requireAdmin(req);
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }

  const body = await req.json().catch(() => ({}));
  const id = Number(body?.id);
  if (!Number.isInteger(id)) {
    return Response.json({ detail: 'id required' }, { status: 400 });
  }

  await db
    .update(applications)
    .set({ status: 'ready', updated_at: new Date() })
    .where(eq(applications.id, id));

  return Response.json({ released: id });
}
