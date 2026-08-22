import { db } from './db';
import { applications, applicationDocuments, type ApplicationKind } from './schema';
import { eq, and, sql } from 'drizzle-orm';

/**
 * Supporting documents uploaded in chat (currently the acceptance/invitation
 * letter for a student visa appointment).
 *
 * These hold real applicant paperwork, so they are deliberately short-lived:
 * every application carries a `purge_after` deadline, the booking watcher
 * deletes the row once an appointment is booked, and `purgeExpired()` sweeps
 * anything left behind.
 */

/** Only formats a visa office actually accepts. */
export const ALLOWED_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;
export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024; // 5 MB

/** How long an application may live before it is purged regardless of state. */
export const RETENTION_DAYS = 30;

export function retentionDeadline(from = new Date()) {
  return new Date(from.getTime() + RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

export type UploadRejection = { ok: false; reason: string };
export type UploadAccepted = { ok: true; documentId: number; applicationId: number };

/**
 * Validate an uploaded file. Called server-side even though the client also
 * checks — the client's `accept` attribute and size check are a convenience
 * for the user, not a control. Anyone can post whatever they like directly.
 */
export function validateUpload(file: File): UploadRejection | { ok: true } {
  if (!file.size) {
    return { ok: false, reason: 'That file is empty.' };
  }
  if (file.size > MAX_DOCUMENT_BYTES) {
    const mb = (file.size / (1024 * 1024)).toFixed(1);
    return {
      ok: false,
      reason: `That file is ${mb} MB. The limit is ${MAX_DOCUMENT_BYTES / (1024 * 1024)} MB — please upload a smaller scan.`,
    };
  }
  if (!ALLOWED_MIME_TYPES.includes(file.type as (typeof ALLOWED_MIME_TYPES)[number])) {
    return {
      ok: false,
      reason: `${file.type || 'That file type'} isn't accepted. Please upload a PDF, JPG, or PNG.`,
    };
  }
  return { ok: true };
}

/** Get the application row for a session + service, creating it on first touch. */
export async function ensureApplication(
  sessionId: string,
  userId: number | null,
  kind: ApplicationKind,
) {
  const existing = await db
    .select()
    .from(applications)
    .where(and(eq(applications.session_id, sessionId), eq(applications.kind, kind)))
    .limit(1);
  if (existing.length) return existing[0];

  const [created] = await db
    .insert(applications)
    .values({
      kind,
      session_id: sessionId,
      user_id: userId,
      status: 'collecting',
      data: '{}',
      purge_after: retentionDeadline(),
    })
    .returning();
  return created;
}

/**
 * Store an uploaded document against a session's application, replacing any
 * previous document of the same kind — re-uploading is how someone corrects a
 * bad scan, and keeping both would leave the watcher guessing which is current.
 */
export async function storeDocument(opts: {
  sessionId: string;
  userId: number | null;
  file: File;
  /** Which service the document belongs to. */
  applicationKind: ApplicationKind;
  kind?: string;
}): Promise<UploadAccepted | UploadRejection> {
  const check = validateUpload(opts.file);
  if (!check.ok) return check;

  const kind = opts.kind ?? 'acceptance_letter';
  const application = await ensureApplication(opts.sessionId, opts.userId, opts.applicationKind);

  const bytes = Buffer.from(await opts.file.arrayBuffer());

  await db
    .delete(applicationDocuments)
    .where(
      and(
        eq(applicationDocuments.application_id, application.id),
        eq(applicationDocuments.kind, kind),
      ),
    );

  const [doc] = await db
    .insert(applicationDocuments)
    .values({
      application_id: application.id,
      kind,
      filename: safeFilename(opts.file.name),
      mime_type: opts.file.type,
      size_bytes: bytes.length,
      data: bytes,
    })
    .returning({ id: applicationDocuments.id });

  await touch(application.id);

  return { ok: true, documentId: doc.id, applicationId: application.id };
}

/**
 * Strip any directory component and control characters from a client-supplied
 * filename. This value is later written to disk by the local watcher, so a
 * name like `../../.ssh/authorized_keys` must not survive.
 */
export function safeFilename(name: string) {
  const base = String(name ?? '')
    .replace(/\\/g, '/')
    .split('/')
    .pop() ?? '';
  const cleaned = base.replace(/[\x00-\x1f<>:"|?*]/g, '').replace(/^\.+/, '').trim();
  return cleaned.slice(0, 120) || 'document';
}

export async function touch(applicationId: number) {
  await db
    .update(applications)
    .set({ updated_at: new Date() })
    .where(eq(applications.id, applicationId));
}

/** Does this application already have its supporting document? */
export async function hasDocument(applicationId: number) {
  const rows = await db
    .select({ id: applicationDocuments.id })
    .from(applicationDocuments)
    .where(eq(applicationDocuments.application_id, applicationId))
    .limit(1);
  return rows.length > 0;
}

/** Delete everything for an application — documents cascade with the row. */
export async function purgeApplication(applicationId: number) {
  await db.delete(applications).where(eq(applications.id, applicationId));
}

/**
 * Delete anything past its retention deadline. Safety net for applications
 * abandoned mid-intake or never claimed by the watcher, so passport data does
 * not accumulate indefinitely.
 */
export async function purgeExpired() {
  const result = await db
    .delete(applications)
    .where(sql`${applications.purge_after} < now()`)
    .returning({ id: applications.id });
  return result.length;
}
