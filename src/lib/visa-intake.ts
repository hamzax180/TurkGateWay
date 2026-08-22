import { db } from './db';
import { applications } from './schema';
import { eq, and } from 'drizzle-orm';
import { ensureApplication, hasDocument, touch } from './application-documents';
import { INTAKE_FIELDS, missingFields, type IntakeData } from './visa-fields';

/**
 * Conversational intake for a Türkiye Student Visa appointment (Mosaic Visa,
 * Ashgabat).
 *
 * The chat collects these answers over as many turns as it takes; the local
 * booking watcher then claims the finished application and fills the real
 * form with them. The field names deliberately match
 * scripts/visa-booking-assistant/applicant.json so the handoff needs no
 * translation layer that could silently drift.
 */

export {
  INTAKE_FIELDS,
  missingFields,
  type IntakeField,
  type IntakeData,
} from './visa-fields';

export function parseIntake(raw: string | null): IntakeData {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as IntakeData) : {};
  } catch {
    return {};
  }
}

/**
 * Merge new answers into an application, ignoring blanks so a partial tool
 * call can never wipe an answer given earlier. Returns the updated state plus
 * what is still outstanding, so the model knows what to ask next instead of
 * re-asking for things it already has.
 */
export async function saveIntake(opts: {
  sessionId: string;
  userId: number | null;
  answers: Record<string, string | undefined>;
}) {
  const application = await ensureApplication(opts.sessionId, opts.userId, 'visa_appointment');
  const current = parseIntake(application.data);

  const merged: IntakeData = { ...current };
  for (const field of INTAKE_FIELDS) {
    const value = opts.answers[field.key];
    if (typeof value === 'string' && value.trim()) {
      merged[field.key] = value.trim();
    }
  }

  const missing = missingFields(merged);
  const documentPresent = await hasDocument(application.id);

  // 'ready' means the watcher may pick it up and start filling the real form,
  // so it requires both a complete answer set and the supporting document —
  // an application without the acceptance letter cannot be submitted anyway.
  const complete = missing.length === 0 && documentPresent;
  const nextStatus =
    application.status === 'in_progress' || application.status === 'booked'
      ? application.status
      : complete
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
    documentPresent,
    status: nextStatus,
  };
}

/** Read current intake state without modifying anything. */
export async function readIntake(sessionId: string) {
  const rows = await db
    .select()
    .from(applications)
    .where(and(eq(applications.session_id, sessionId), eq(applications.kind, 'visa_appointment')))
    .limit(1);
  if (!rows.length) return null;

  const application = rows[0];
  const data = parseIntake(application.data);
  return {
    application,
    data,
    missing: missingFields(data),
    documentPresent: await hasDocument(application.id),
  };
}

/**
 * Re-evaluate readiness after something other than an answer changed —
 * specifically after a document upload, which can complete an application
 * whose fields were already all filled in.
 */
export async function refreshReadiness(sessionId: string) {
  const state = await readIntake(sessionId);
  if (!state) return null;
  const { application, missing, documentPresent } = state;
  if (application.status === 'in_progress' || application.status === 'booked') return state;

  const next = missing.length === 0 && documentPresent ? 'ready' : 'collecting';
  if (next !== application.status) {
    await db
      .update(applications)
      .set({ status: next, updated_at: new Date() })
      .where(eq(applications.id, application.id));
  } else {
    await touch(application.id);
  }
  return { ...state, application: { ...application, status: next } };
}
