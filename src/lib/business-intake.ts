import { saveFieldAnswers, readFieldIntake, type IntakeAnswers } from './intake-core';
import { BUSINESS_FIELDS, missingBusinessFields, type BusinessIntakeData } from './business-fields';

/**
 * Conversational intake for a business permit (İşyeri Açma ve Çalışma Ruhsatı)
 * application. Merge-blank semantics come from intake-core.
 */

export { BUSINESS_FIELDS, missingBusinessFields, type BusinessIntakeData };

export function saveBusinessIntake(opts: {
  sessionId: string;
  userId: number | null;
  answers: IntakeAnswers;
}) {
  return saveFieldAnswers({ ...opts, kind: 'business', fields: BUSINESS_FIELDS });
}

export function readBusinessIntake(sessionId: string) {
  return readFieldIntake({ sessionId, kind: 'business', fields: BUSINESS_FIELDS });
}
