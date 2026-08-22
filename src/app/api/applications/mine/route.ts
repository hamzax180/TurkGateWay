export const runtime = 'nodejs';

import { db } from '@/lib/db';
import { desc, eq, sql } from 'drizzle-orm';
import { applicationDocuments, applications, chatSessions } from '@/lib/schema';
import { requireUser } from '@/lib/user-helper';
import { CHECKLIST_APPLICATION_KIND, checklistById, checklistView, pickLang } from '@/lib/document-checklists';

/**
 * GET /api/applications/mine?lang=
 *
 * Everything this person has running with us: which service, how far the
 * paperwork got, what we generated for them, and where it is in the queue.
 *
 * The chat shows one conversation at a time, so someone with a visa and an
 * İkamet in flight had no single place to see both. This is that place.
 */

/** The one checklist that represents each application kind, for progress. */
const KIND_TO_CHECKLIST: Record<string, string> = Object.entries(CHECKLIST_APPLICATION_KIND).reduce(
  (acc, [checklistId, kind]) => {
    if (!acc[kind]) acc[kind] = checklistId;
    return acc;
  },
  {} as Record<string, string>,
);

export async function GET(req: Request) {
  try {
    const user = await requireUser(req);
    const lang = new URL(req.url).searchParams.get('lang') ?? 'en';
    const pick = pickLang(lang);

    const rows = await db
      .select({
        id: applications.id,
        kind: applications.kind,
        status: applications.status,
        session_id: applications.session_id,
        created_at: applications.created_at,
        updated_at: applications.updated_at,
        session_title: chatSessions.title,
        service_id: chatSessions.service_id,
      })
      .from(applications)
      .leftJoin(chatSessions, eq(chatSessions.id, applications.session_id))
      .where(eq(applications.user_id, user.id))
      .orderBy(desc(applications.updated_at));

    const out = [];
    for (const row of rows) {
      const docs = await db
        .select({
          id: applicationDocuments.id,
          kind: applicationDocuments.kind,
          filename: applicationDocuments.filename,
          uploaded_at: applicationDocuments.uploaded_at,
        })
        .from(applicationDocuments)
        .where(eq(applicationDocuments.application_id, row.id));

      // A generated form is our output, not one of the applicant's documents,
      // so it is reported separately and never counted toward progress.
      const generated = docs.filter((d) => d.kind.startsWith('generated_'));
      const uploaded = docs.filter((d) => !d.kind.startsWith('generated_'));

      const checklistId = row.service_id && checklistById(row.service_id)
        ? row.service_id
        : KIND_TO_CHECKLIST[row.kind];
      const checklist = checklistId ? checklistById(checklistId) : null;
      const items = checklist ? checklistView(checklist, pick) : [];
      const have = new Set(uploaded.map((d) => d.kind));

      out.push({
        id: row.id,
        kind: row.kind,
        service: checklist?.id ?? null,
        status: row.status,
        sessionId: row.session_id,
        sessionTitle: row.session_title,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        total: items.length,
        uploadedCount: items.filter((i) => have.has(i.key)).length,
        missing: items.filter((i) => !have.has(i.key)).map((i) => i.title),
        documents: uploaded.map((d) => ({ id: d.id, filename: d.filename, uploadedAt: d.uploaded_at })),
        forms: generated.map((d) => ({ id: d.id, filename: d.filename })),
      });
    }

    return Response.json({ applications: out });
  } catch (e) {
    if (e instanceof Response) return e;
    return Response.json({ detail: 'Error' }, { status: 500 });
  }
}
