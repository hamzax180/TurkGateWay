/**
 * The İkamet (residence permit) application's field vocabulary — shared by the
 * server (which saves answers) and any client component that renders the
 * checklist. Free of database imports for the same reason the visa list is.
 *
 * Covers both first applications (İlk Başvuru) and renewals (Uzatma): the
 * permit-specific fields are optional here because a first application has no
 * previous permit, and the agent's tool description makes the model require
 * them only when the user is renewing.
 */

import type { FieldDef } from './intake-core';

export const IKAMET_FIELDS: FieldDef[] = [
  { key: 'firstName', label: 'given name (as printed in the passport)', short: 'Given name' },
  { key: 'lastName', label: 'surname (as printed in the passport)', short: 'Surname' },
  { key: 'passportNumber', label: 'passport number', short: 'Passport number' },
  { key: 'passportExpiry', label: 'passport expiry date', short: 'Passport expiry' },
  { key: 'nationality', label: 'nationality', short: 'Nationality' },
  { key: 'dateOfBirth', label: 'date of birth', short: 'Date of birth' },
  { key: 'fatherName', label: "father's full name", short: "Father's name" },
  { key: 'motherName', label: "mother's full name", short: "Mother's name" },
  { key: 'gender', label: 'gender (Male or Female)', short: 'Gender' },
  { key: 'email', label: 'email address', short: 'Email' },
  { key: 'phone', label: 'mobile number with country code', short: 'Mobile number' },
  {
    key: 'addressInTr',
    label: 'residence address in Türkiye (street, building, district, city)',
    short: 'Address in Türkiye',
  },
  { key: 'entryDate', label: 'date of entry into Türkiye', short: 'Entry date' },
  { key: 'permitNumber', label: 'current ikamet permit number (renewal only)', short: 'Permit number', optional: true },
  { key: 'permitExpiry', label: 'current ikamet expiry date (renewal only)', short: 'Permit expiry', optional: true },
];

export type IkametIntakeData = Record<string, string>;

/** Which required fields are still unanswered. */
export function missingIkametFields(data: IkametIntakeData): FieldDef[] {
  return IKAMET_FIELDS.filter((f) => !f.optional && !String(data[f.key] ?? '').trim());
}
