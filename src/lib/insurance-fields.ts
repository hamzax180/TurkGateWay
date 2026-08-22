/**
 * The SGK student health insurance application's field vocabulary. Shared by
 * the server and any client checklist card, free of database imports.
 */

import type { FieldDef } from './intake-core';

export const INSURANCE_FIELDS: FieldDef[] = [
  { key: 'firstName', label: 'given name (as printed in the passport)', short: 'Given name' },
  { key: 'lastName', label: 'surname (as printed in the passport)', short: 'Surname' },
  { key: 'dateOfBirth', label: 'date of birth', short: 'Date of birth' },
  { key: 'nationality', label: 'nationality', short: 'Nationality' },
  { key: 'passportNumber', label: 'passport number', short: 'Passport number' },
  { key: 'university', label: 'university name in Türkiye', short: 'University' },
  { key: 'enrollmentDate', label: 'university enrollment (kayıt) date', short: 'Enrollment date' },
  {
    key: 'coverageStart',
    label: 'month the insurance coverage should start',
    short: 'Coverage start',
    optional: true,
  },
  { key: 'email', label: 'email address', short: 'Email' },
  { key: 'phone', label: 'mobile number with country code', short: 'Mobile number' },
];

export type InsuranceIntakeData = Record<string, string>;

/** Which required fields are still unanswered. */
export function missingInsuranceFields(data: InsuranceIntakeData): FieldDef[] {
  return INSURANCE_FIELDS.filter((f) => !f.optional && !String(data[f.key] ?? '').trim());
}
