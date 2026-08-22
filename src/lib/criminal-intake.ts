import { db } from './db';
import { applications } from './schema';
import { eq, and } from 'drizzle-orm';
import { ensureApplication } from './application-documents';
import {
  CRIMINAL_FIELDS,
  missingCriminalFields,
  type CriminalIntakeData,
} from './criminal-fields';

/**
 * Conversational intake for a criminal defense case.
 *
 * Same merge-and-persist shape as the visa and university intakes, with the
 * differences that matter for an emergency: it is free (no credit, no
 * confirmation gate) and completing the intake hands the case to the human
 * lawyer. Status flow: collecting → ready (all required fields) → forwarded
 * (the lawyer's office has been handed the case).
 */

export {
  CRIMINAL_FIELDS,
  missingCriminalFields,
  type CriminalField,
  type CriminalIntakeData,
} from './criminal-fields';

export function parseCriminalIntake(raw: string | null): CriminalIntakeData {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as CriminalIntakeData) : {};
  } catch {
    return {};
  }
}

/** Merge new answers, ignoring blanks so a partial call never erases earlier ones. */
export async function saveCriminalIntake(opts: {
  sessionId: string;
  userId: number | null;
  answers: Record<string, string | undefined>;
}) {
  const application = await ensureApplication(opts.sessionId, opts.userId, 'criminal_case');
  const current = parseCriminalIntake(application.data);

  const merged: CriminalIntakeData = { ...current };
  for (const field of CRIMINAL_FIELDS) {
    const value = opts.answers[field.key];
    if (typeof value === 'string' && value.trim()) {
      merged[field.key] = value.trim();
    }
  }

  const missing = missingCriminalFields(merged);

  const locked = application.status === 'forwarded' || application.status === 'in_progress' || application.status === 'done';
  const nextStatus = locked ? application.status : missing.length ? 'collecting' : 'ready';

  await db
    .update(applications)
    .set({ data: JSON.stringify(merged), status: nextStatus, updated_at: new Date() })
    .where(eq(applications.id, application.id));

  return {
    application: { ...application, status: nextStatus },
    data: merged,
    missing,
    status: nextStatus,
  };
}

export async function readCriminalIntake(sessionId: string) {
  const rows = await db
    .select()
    .from(applications)
    .where(and(eq(applications.session_id, sessionId), eq(applications.kind, 'criminal_case')))
    .limit(1);
  if (!rows.length) return null;

  const application = rows[0];
  const data = parseCriminalIntake(application.data);
  return { application, data, missing: missingCriminalFields(data) };
}

export type CriminalSubmission =
  | { kind: 'missing_application' }
  | { kind: 'incomplete'; missing: ReturnType<typeof missingCriminalFields> }
  | { kind: 'auth_required' }
  | { kind: 'forwarded'; applicationId: number }
  | { kind: 'already_forwarded' };

/**
 * Hand the completed case to the human lawyer. Free and immediate — an
 * emergency intake must not sit behind a payment wall.
 *
 * The delivery channel is a placeholder until the lawyer's contact details
 * (email/phone/WhatsApp) are configured: the case row is marked 'forwarded'
 * and logged, so the office can already see it in the database. See
 * forwardCriminalCaseToLawyer below.
 */
export async function submitCriminalCase(opts: {
  sessionId: string;
  userId: number | null;
}): Promise<CriminalSubmission> {
  const state = await readCriminalIntake(opts.sessionId);
  if (!state) return { kind: 'missing_application' };

  const { application, missing } = state;
  if (application.status === 'forwarded' || application.status === 'in_progress' || application.status === 'done') {
    return { kind: 'already_forwarded' };
  }
  if (missing.length) return { kind: 'incomplete', missing };
  if (!opts.userId) return { kind: 'auth_required' };

  // Idempotent: forwarding twice just re-marks the same case.
  await db
    .update(applications)
    .set({ status: 'forwarded', updated_at: new Date() })
    .where(eq(applications.id, application.id));

  await forwardCriminalCaseToLawyer(application.id);

  return { kind: 'forwarded', applicationId: application.id };
}

/**
 * PLACEHOLDER — the actual channel lands when the lawyer's contact details
 * are provided (email / phone / WhatsApp). Until then the case is stored as
 * 'forwarded' and logged here, which is enough for the office to act on.
 */
async function forwardCriminalCaseToLawyer(applicationId: number) {
  const lawyerEmail = process.env.LAWYER_CONTACT_EMAIL ?? null;
  const lawyerPhone = process.env.LAWYER_CONTACT_PHONE ?? null;

  if (!lawyerEmail && !lawyerPhone) {
    console.log(
      `[lawyer-forward] Case ${applicationId} ready for Emre Aslan — configure LAWYER_CONTACT_EMAIL / LAWYER_CONTACT_PHONE to deliver it automatically.`,
    );
    return;
  }

  console.log(
    `[lawyer-forward] Case ${applicationId} queued for delivery to ${lawyerEmail ?? lawyerPhone} (delivery channel not implemented yet).`,
  );
}
