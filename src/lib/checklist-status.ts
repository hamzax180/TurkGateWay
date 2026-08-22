/**
 * checklist-status.ts
 * The bridge between "here is what you need to upload" and "here is what you
 * have actually uploaded".
 *
 * document-checklists.ts knows the paperwork each service requires;
 * application_documents knows which files arrived. This module joins the two
 * so the chat can show a live checklist that turns green item by item, and so
 * the application flips to `ready` — the state the automation waits on — the
 * moment the last document lands.
 *
 * Each checklist item is stored under its own `kind` (see `itemKey`). That is
 * load-bearing: `storeDocument` deletes existing rows of the same kind before
 * inserting, so filing every upload under one kind would mean each new
 * document silently destroyed the one before it.
 */

import { and, eq } from 'drizzle-orm';
import { db } from './db';
import { applications, applicationDocuments, type ApplicationKind } from './schema';
import { ensureApplication, storeDocument } from './application-documents';
import {
  CHECKLIST_APPLICATION_KIND,
  checklistById,
  checklistView,
  itemKey,
  pickLang,
  type ServiceChecklist,
} from './document-checklists';

export type ChecklistItemStatus = {
  key: string;
  title: string;
  whereToGet: string;
  uploaded: boolean;
  filename: string | null;
  uploadedAt: string | null;
};

export type ChecklistStatus = {
  service: string;
  kind: ApplicationKind;
  items: ChecklistItemStatus[];
  uploadedCount: number;
  total: number;
  /** Every required document is in — this is what gates the automation. */
  complete: boolean;
  /** The application's lifecycle status: collecting | ready | in_progress | … */
  status: string;
  applicationId: number | null;
};

export function applicationKindFor(serviceId: string): ApplicationKind | null {
  return CHECKLIST_APPLICATION_KIND[serviceId] ?? null;
}

/**
 * Read which of a service's documents have arrived.
 *
 * Never creates an application: asking "what do I still need?" is a read, and
 * a visitor who only browsed a checklist should not leave a row behind.
 */
export async function getChecklistStatus(opts: {
  sessionId: string;
  serviceId: string;
  lang: string;
}): Promise<ChecklistStatus | null> {
  const checklist: ServiceChecklist | null = checklistById(opts.serviceId);
  if (!checklist) return null;

  const kind = applicationKindFor(opts.serviceId);
  if (!kind) return null;

  const pick = pickLang(opts.lang);

  const [application] = await db
    .select()
    .from(applications)
    .where(and(eq(applications.session_id, opts.sessionId), eq(applications.kind, kind)))
    .limit(1);

  let uploaded: { kind: string; filename: string; uploaded_at: Date | null }[] = [];
  if (application) {
    uploaded = await db
      .select({
        kind: applicationDocuments.kind,
        filename: applicationDocuments.filename,
        uploaded_at: applicationDocuments.uploaded_at,
      })
      .from(applicationDocuments)
      .where(eq(applicationDocuments.application_id, application.id));
  }

  const byKind = new Map(uploaded.map((d) => [d.kind, d]));

  // checklistView owns language resolution (including the Russian overrides),
  // so the status view must not index the tuples itself or Russian would
  // silently fall back to English here only.
  const items: ChecklistItemStatus[] = checklistView(checklist, pick).map((row) => {
    const doc = byKind.get(row.key);
    return {
      ...row,
      uploaded: Boolean(doc),
      filename: doc?.filename ?? null,
      uploadedAt: doc?.uploaded_at ? doc.uploaded_at.toISOString() : null,
    };
  });

  const uploadedCount = items.filter((i) => i.uploaded).length;

  return {
    service: checklist.id,
    kind,
    items,
    uploadedCount,
    total: items.length,
    complete: uploadedCount === items.length && items.length > 0,
    status: application?.status ?? 'collecting',
    applicationId: application?.id ?? null,
  };
}

/**
 * Store one checklist document and return the checklist's new state.
 *
 * When the upload completes the set, the application is promoted to `ready`
 * so the automation can pick it up. Later lifecycle states are never demoted
 * — an application already `submitted` does not go backwards because someone
 * re-uploaded a cleaner scan.
 */
export async function uploadChecklistDocument(opts: {
  sessionId: string;
  userId: number | null;
  serviceId: string;
  itemKey: string;
  lang: string;
  file: File;
}): Promise<{ ok: true; status: ChecklistStatus } | { ok: false; reason: string }> {
  const checklist = checklistById(opts.serviceId);
  if (!checklist) return { ok: false, reason: 'Unknown service.' };

  const kind = applicationKindFor(opts.serviceId);
  if (!kind) return { ok: false, reason: 'Unknown service.' };

  // The key must be one this checklist actually defines — otherwise a crafted
  // request could file junk kinds against someone's application.
  const validKeys = new Set(checklist.items.map((item, i) => itemKey(item, i)));
  if (!validKeys.has(opts.itemKey)) {
    return { ok: false, reason: 'That document is not on this checklist.' };
  }

  const stored = await storeDocument({
    sessionId: opts.sessionId,
    userId: opts.userId,
    file: opts.file,
    applicationKind: kind,
    kind: opts.itemKey,
  });
  if (!stored.ok) return stored;

  const status = await getChecklistStatus({
    sessionId: opts.sessionId,
    serviceId: opts.serviceId,
    lang: opts.lang,
  });
  if (!status) return { ok: false, reason: 'Could not read the checklist.' };

  if (status.complete) {
    const application = await ensureApplication(opts.sessionId, opts.userId, kind);
    const locked = new Set(['in_progress', 'submitted', 'booked', 'forwarded', 'done']);
    if (!locked.has(application.status)) {
      await db
        .update(applications)
        .set({ status: 'ready', updated_at: new Date() })
        .where(eq(applications.id, application.id));
      status.status = 'ready';
    } else {
      status.status = application.status;
    }
  }

  return { ok: true, status };
}

/** Remove one uploaded document, so a wrong file can be replaced. */
export async function removeChecklistDocument(opts: {
  sessionId: string;
  serviceId: string;
  itemKey: string;
  lang: string;
}): Promise<ChecklistStatus | null> {
  const kind = applicationKindFor(opts.serviceId);
  if (!kind) return null;

  const [application] = await db
    .select()
    .from(applications)
    .where(and(eq(applications.session_id, opts.sessionId), eq(applications.kind, kind)))
    .limit(1);

  if (application) {
    await db
      .delete(applicationDocuments)
      .where(
        and(
          eq(applicationDocuments.application_id, application.id),
          eq(applicationDocuments.kind, opts.itemKey),
        ),
      );
    // The set is no longer complete, so it is back to collecting — unless an
    // operator has already taken it further.
    const locked = new Set(['in_progress', 'submitted', 'booked', 'forwarded', 'done']);
    if (!locked.has(application.status)) {
      await db
        .update(applications)
        .set({ status: 'collecting', updated_at: new Date() })
        .where(eq(applications.id, application.id));
    }
  }

  return getChecklistStatus({
    sessionId: opts.sessionId,
    serviceId: opts.serviceId,
    lang: opts.lang,
  });
}
