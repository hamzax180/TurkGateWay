import { saveFieldAnswers, readFieldIntake, type IntakeAnswers } from './intake-core';
import { IKAMET_FIELDS, missingIkametFields, type IkametIntakeData } from './ikamet-fields';

/**
 * Conversational intake for a residence permit (İkamet) application — first
 * application and renewal. Merge-blank semantics come from intake-core: a
 * partial call never erases an earlier answer.
 */

export { IKAMET_FIELDS, missingIkametFields, type IkametIntakeData };

export function saveIkametIntake(opts: {
  sessionId: string;
  userId: number | null;
  answers: IntakeAnswers;
}) {
  return saveFieldAnswers({ ...opts, kind: 'ikamet', fields: IKAMET_FIELDS });
}

export function readIkametIntake(sessionId: string) {
  return readFieldIntake({ sessionId, kind: 'ikamet', fields: IKAMET_FIELDS });
}
