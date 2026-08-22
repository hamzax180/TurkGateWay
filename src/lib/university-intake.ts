import { db } from './db';
import { applications } from './schema';
import { eq, and, isNull } from 'drizzle-orm';
import { ensureApplication } from './application-documents';
import { consumeCredit, getCreditBalance, refundCredit } from './credits';
import {
  UNIVERSITY_FIELDS,
  missingUniversityFields,
  hasChosenUniversity,
  type UniversityIntakeData,
} from './university-fields';

/**
 * Conversational intake for a university placement in Türkiye.
 *
 * Same shape as the visa intake — answers accumulate over as many turns as it
 * takes, merged into one application row — with one deliberate difference in
 * where the money moves. A visa application is charged by the operator when
 * the appointment is actually booked; a university application is charged by
 * the platform itself, exactly one service credit, at the moment the intake
 * completes and the application is submitted to the placement team.
 *
 * Status flow: collecting → ready (every field answered, awaiting the user's
 * OK to spend a credit) → submitted (credit spent) → in_progress / done
 * (operator side).
 */

export {
  UNIVERSITY_FIELDS,
  UNIVERSITY_CHOICE_KEYS,
  missingUniversityFields,
  missingUniversityChoice,
  hasChosenUniversity,
  type UniversityField,
  type UniversityIntakeData,
} from './university-fields';

export function parseUniversityIntake(raw: string | null): UniversityIntakeData {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as UniversityIntakeData) : {};
  } catch {
    return {};
  }
}

/**
 * Merge new answers into the session's university application, ignoring blanks
 * so a partial tool call can never wipe an answer given earlier. Returns the
 * updated state plus what is still outstanding, so the model knows what to ask
 * next instead of re-asking for things it already has.
 */
export async function saveUniversityIntake(opts: {
  sessionId: string;
  userId: number | null;
  answers: Record<string, string | undefined>;
}) {
  const application = await ensureApplication(opts.sessionId, opts.userId, 'university');
  const current = parseUniversityIntake(application.data);

  const merged: UniversityIntakeData = { ...current };
  for (const field of UNIVERSITY_FIELDS) {
    const value = opts.answers[field.key];
    if (typeof value === 'string' && value.trim()) {
      merged[field.key] = value.trim();
    }
  }

  const missing = missingUniversityFields(merged);

  // Once a credit is spent the application is submitted — later answers must
  // not rewind that status, and any extra detail is part of the final record.
  const locked =
    application.status === 'submitted' ||
    application.status === 'in_progress' ||
    application.status === 'done';
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

/** Read current intake state without modifying anything. */
export async function readUniversityIntake(sessionId: string) {
  const rows = await db
    .select()
    .from(applications)
    .where(and(eq(applications.session_id, sessionId), eq(applications.kind, 'university')))
    .limit(1);
  if (!rows.length) return null;

  const application = rows[0];
  const data = parseUniversityIntake(application.data);
  return {
    application,
    data,
    missing: missingUniversityFields(data),
  };
}

export type UniversityServiceStart =
  | { kind: 'no_university' }
  | { kind: 'auth_required' }
  | { kind: 'confirmation_required'; available: number; nextExpiry: Date | null; university: string }
  | { kind: 'no_credit'; nextExpiry: Date | null; university: string }
  | { kind: 'started'; creditId: number; university: string }
  | { kind: 'already_started'; university: string };

/**
 * Spend the one service credit that opens the placement service, as soon as the
 * student has chosen a university.
 *
 * The credit used to be charged at the very end, once every intake field was
 * answered. It is charged here instead because this is where the student starts
 * receiving the thing they are paying for: the document checklist, the upload
 * workflow and the university's official payment details. Collecting the
 * remaining profile fields continues afterwards and costs nothing more.
 *
 * Exactly-once is enforced the same way the final submission enforces it — an
 * application that already carries a credit_id is never re-charged, and the
 * status update is conditional on credit_id still being NULL, so two
 * simultaneous confirmations cannot both win. The loser refunds.
 */
export async function startUniversityService(opts: {
  sessionId: string;
  userId: number | null;
  confirmed: boolean;
}): Promise<UniversityServiceStart> {
  const state = await readUniversityIntake(opts.sessionId);
  if (!state || !hasChosenUniversity(state.data)) return { kind: 'no_university' };

  const { application, data } = state;
  const university = String(data.chosenUniversity).trim();

  if (application.credit_id) return { kind: 'already_started', university };
  if (!opts.userId) return { kind: 'auth_required' };

  const balance = await getCreditBalance(opts.userId);
  if (balance.available < 1) {
    return { kind: 'no_credit', nextExpiry: balance.nextExpiry, university };
  }
  if (!opts.confirmed) {
    return {
      kind: 'confirmation_required',
      available: balance.available,
      nextExpiry: balance.nextExpiry,
      university,
    };
  }

  const creditId = await consumeCredit(opts.userId, opts.sessionId);
  if (creditId === null) return { kind: 'no_credit', nextExpiry: null, university };

  const updated = await db
    .update(applications)
    .set({ credit_id: creditId, status: 'in_progress', updated_at: new Date() })
    .where(and(eq(applications.id, application.id), isNull(applications.credit_id)))
    .returning({ id: applications.id });

  if (!updated.length) {
    await refundCredit(creditId, opts.userId, 'service start race');
    return { kind: 'already_started', university };
  }

  return { kind: 'started', creditId, university };
}

/** True once the service credit has been spent for this session's application. */
export async function universityServicePaid(sessionId: string): Promise<boolean> {
  const state = await readUniversityIntake(sessionId);
  return Boolean(state?.application.credit_id);
}

export type UniversitySubmission =
  | { kind: 'missing_application' }
  | { kind: 'incomplete'; missing: ReturnType<typeof missingUniversityFields> }
  | { kind: 'auth_required' }
  | {
      kind: 'confirmation_required';
      available: number;
      nextExpiry: Date | null;
    }
  | { kind: 'no_credit'; nextExpiry: Date | null }
  | { kind: 'submitted'; creditId: number }
  | { kind: 'already_submitted' }
  /** Service credit already spent at university selection — no second charge. */
  | { kind: 'handed_over' };

/**
 * Spend the one service credit and mark the application submitted.
 *
 * The charge happens only when the user has explicitly confirmed it — the tool
 * surfaces `confirmation_required` on the first complete pass and the chat
 * re-invokes it with the confirmation flag set. Exactly-once is enforced two
 * ways: an application that already carries a credit_id is never re-charged,
 * and the final status update is conditional on credit_id still being NULL so
 * two simultaneous submissions cannot both win — the loser refunds.
 */
export async function submitUniversityApplication(opts: {
  sessionId: string;
  userId: number | null;
  confirmed: boolean;
}): Promise<UniversitySubmission> {
  const state = await readUniversityIntake(opts.sessionId);
  if (!state) return { kind: 'missing_application' };

  const { application, missing } = state;

  // The credit is spent up front now, when the student picks a university, so
  // a paid application reaching here is the normal path — not a double charge.
  // Finish the profile off and hand it to the placement team for free.
  if (application.credit_id) {
    if (missing.length) return { kind: 'incomplete', missing };
    if (application.status === 'submitted' || application.status === 'done') {
      return { kind: 'already_submitted' };
    }
    await db
      .update(applications)
      .set({ status: 'submitted', updated_at: new Date() })
      .where(eq(applications.id, application.id));
    return { kind: 'handed_over' };
  }

  if (missing.length) return { kind: 'incomplete', missing };

  if (!opts.userId) return { kind: 'auth_required' };

  const balance = await getCreditBalance(opts.userId);
  if (balance.available < 1) {
    return { kind: 'no_credit', nextExpiry: balance.nextExpiry };
  }
  if (!opts.confirmed) {
    return {
      kind: 'confirmation_required',
      available: balance.available,
      nextExpiry: balance.nextExpiry,
    };
  }

  const creditId = await consumeCredit(opts.userId, opts.sessionId);
  if (creditId === null) {
    // Lost a race against a concurrent request — treat as no credit.
    return { kind: 'no_credit', nextExpiry: null };
  }

  const updated = await db
    .update(applications)
    .set({ credit_id: creditId, status: 'submitted', updated_at: new Date() })
    .where(and(eq(applications.id, application.id), isNull(applications.credit_id)))
    .returning({ id: applications.id });

  if (!updated.length) {
    await refundCredit(creditId, opts.userId, 'submission race');
    return { kind: 'already_submitted' };
  }

  return { kind: 'submitted', creditId };
}
