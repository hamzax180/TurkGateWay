import { db } from './db';
import { applications, type ApplicationKind } from './schema';
import { eq, and } from 'drizzle-orm';
import { ensureApplication } from './application-documents';

/**
 * intake-core.ts
 * Shared plumbing for conversational intakes (visa, university, ikamet,
 * insurance, business). Each service keeps its own field vocabulary file
 * (no DB imports, so client components can render checklists safely) and a
 * thin intake module; this file owns the merge-and-persist logic so it exists
 * once instead of five times.
 */

export type FieldDef = {
  key: string;
  /** How the model refers to the field when asking. */
  label: string;
  /** Short form for the UI checklist. */
  short: string;
  /** Optional — the form accepts an empty value, so never block on it. */
  optional?: boolean;
};

export type IntakeAnswers = Record<string, string | undefined>;

export function parseStoredData(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export function missingOf(fields: FieldDef[], data: Record<string, string>): FieldDef[] {
  return fields.filter((f) => !f.optional && !String(data[f.key] ?? '').trim());
}

/**
 * Merge new answers into the session's application of `kind`, ignoring blanks
 * so a partial tool call can never wipe an answer given earlier. Returns the
 * updated state plus what is still outstanding.
 */
export async function saveFieldAnswers(opts: {
  sessionId: string;
  userId: number | null;
  kind: ApplicationKind;
  fields: FieldDef[];
  answers: IntakeAnswers;
}) {
  const application = await ensureApplication(opts.sessionId, opts.userId, opts.kind);
  const current = parseStoredData(application.data);

  const merged: Record<string, string> = { ...current };
  for (const field of opts.fields) {
    const value = opts.answers[field.key];
    if (typeof value === 'string' && value.trim()) {
      merged[field.key] = value.trim();
    }
  }

  const missing = missingOf(opts.fields, merged);

  // 'ready' means a human operator (or the document generator) may pick the
  // application up. Later phases of the lifecycle ('in_progress', 'submitted',
  // 'booked', 'forwarded', 'done') are never demoted by a new answer.
  const protectedStatuses = new Set(['in_progress', 'submitted', 'booked', 'forwarded', 'done']);
  const nextStatus = protectedStatuses.has(application.status)
    ? application.status
    : missing.length === 0
      ? 'ready'
      : 'collecting';

  await db
    .update(applications)
    .set({ data: JSON.stringify(merged), status: nextStatus, updated_at: new Date() })
    .where(eq(applications.id, application.id));

  return {
    applicationId: application.id,
    data: merged,
    missing,
    status: nextStatus,
  };
}

/** Read current intake state without modifying anything. */
export async function readFieldIntake(opts: {
  sessionId: string;
  kind: ApplicationKind;
  fields: FieldDef[];
}) {
  const rows = await db
    .select()
    .from(applications)
    .where(and(eq(applications.session_id, opts.sessionId), eq(applications.kind, opts.kind)))
    .limit(1);
  if (!rows.length) return null;

  const application = rows[0];
  const data = parseStoredData(application.data);
  return {
    application,
    data,
    missing: missingOf(opts.fields, data),
  };
}
