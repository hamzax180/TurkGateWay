import { saveFieldAnswers, readFieldIntake, type IntakeAnswers } from './intake-core';
import { INSURANCE_FIELDS, missingInsuranceFields, type InsuranceIntakeData } from './insurance-fields';

/**
 * Conversational intake for an SGK student health insurance application.
 * Merge-blank semantics come from intake-core.
 */

export { INSURANCE_FIELDS, missingInsuranceFields, type InsuranceIntakeData };

export function saveInsuranceIntake(opts: {
  sessionId: string;
  userId: number | null;
  answers: IntakeAnswers;
}) {
  return saveFieldAnswers({ ...opts, kind: 'insurance', fields: INSURANCE_FIELDS });
}

export function readInsuranceIntake(sessionId: string) {
  return readFieldIntake({ sessionId, kind: 'insurance', fields: INSURANCE_FIELDS });
}
