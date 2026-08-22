export const runtime = 'nodejs';

import { db } from '@/lib/db';
import { applicationDocuments, applications } from '@/lib/schema';
import { eq, sql } from 'drizzle-orm';
import { requireAdmin } from '@/lib/user-helper';

/**
 * Claim the next application of any service that is ready to be worked.
 *
 * The visa watcher has had `/api/visa-application/next` since it was the only
 * automated service. İkamet, university, insurance and business applications
 * reach `ready` exactly the same way — every required document uploaded — but
 * had no way to be claimed, so they simply sat there. This is that endpoint,
 * parameterised by kind.
 *
 * Claiming is atomic: the row is flipped to `in_progress` inside the same
 * statement that selects it, and SKIP LOCKED steps over rows another watcher
 * is already taking, so two watchers can never grab the same application.
 *
 * Admin-only — the payload carries passport-level PII.
 */

const CLAIMABLE = new Set([
  'visa_appointment',
  'university',
  'ikamet',
  'insurance',
  'business',
  'criminal_case',
]);

export async function GET(req: Request) {
  try {
    await requireAdmin(req);
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }

  const url = new URL(req.url);
  const kind = url.searchParams.get('kind') ?? '';
  if (!CLAIMABLE.has(kind)) {
    return Response.json(
      { detail: `kind must be one of: ${[...CLAIMABLE].join(', ')}` },
      { status: 400 },
    );
  }

  const claimed = await db.execute(sql`
    UPDATE ${applications}
    SET status = 'in_progress', updated_at = now()
    WHERE id = (
      SELECT id FROM ${applications}
      WHERE kind = ${kind} AND status = 'ready'
      ORDER BY created_at
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id, session_id, data, kind
  `);

  const row = (claimed.rows ?? claimed)[0] as
    | { id: number; session_id: string; data: string; kind: string }
    | undefined;

  if (!row) return Response.json({ application: null });

  // Document metadata only — the bytes are fetched per-document, so claiming a
  // queue does not drag every scan across the wire.
  const documents = await db
    .select({
      id: applicationDocuments.id,
      kind: applicationDocuments.kind,
      filename: applicationDocuments.filename,
      mime_type: applicationDocuments.mime_type,
      size_bytes: applicationDocuments.size_bytes,
    })
    .from(applicationDocuments)
    .where(eq(applicationDocuments.application_id, row.id));

  let data: Record<string, string> = {};
  try {
    data = JSON.parse(row.data || '{}');
  } catch {
    data = {};
  }

  return Response.json({
    application: {
      id: row.id,
      kind: row.kind,
      session_id: row.session_id,
      data,
      documents,
    },
  });
}

/**
 * Release or finish a claimed application.
 * Body: { application_id, status } where status is 'ready' (hand it back),
 * 'submitted', or 'done'.
 */
export async function POST(req: Request) {
  try {
    await requireAdmin(req);
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }

  const body = await req.json().catch(() => null);
  const id = Number(body?.application_id);
  const status = String(body?.status ?? '');

  if (!Number.isFinite(id) || !['ready', 'submitted', 'done'].includes(status)) {
    return Response.json({ detail: 'application_id and a valid status required' }, { status: 400 });
  }

  await db
    .update(applications)
    .set({ status, updated_at: new Date() })
    .where(eq(applications.id, id));

  return Response.json({ ok: true });
}
