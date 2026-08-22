/**
 * The business permit application's field vocabulary — what the Business agent
 * collects to auto-fill the İşyeri Açma ve Çalışma Ruhsatı application packet.
 * Shared by the server and any client checklist card, free of DB imports.
 */

import type { FieldDef } from './intake-core';

export const BUSINESS_FIELDS: FieldDef[] = [
  { key: 'businessName', label: 'business name', short: 'Business name' },
  {
    key: 'activity',
    label: 'what the business does (e.g. Restaurant, Retail Shop, Software Office) — this becomes the NACE code',
    short: 'Business activity',
  },
  { key: 'district', label: 'district in Istanbul where the business is located', short: 'District' },
  { key: 'address', label: 'full business address (street, building, district)', short: 'Business address' },
  { key: 'ownerFirstName', label: "owner's given name", short: "Owner's given name" },
  { key: 'ownerLastName', label: "owner's surname", short: "Owner's surname" },
  {
    key: 'ownerPassportOrTckn',
    label: "owner's passport number (foreigner) or T.C. Kimlik number",
    short: "Owner's passport/TCKN",
  },
  { key: 'phone', label: 'contact mobile number with country code', short: 'Mobile number' },
  { key: 'email', label: 'contact email address', short: 'Email' },
  {
    key: 'leaseStatus',
    label: 'lease status (do they already have a signed rental contract for the premises?)',
    short: 'Lease status',
    optional: true,
  },
];

export type BusinessIntakeData = Record<string, string>;

/** Which required fields are still unanswered. */
export function missingBusinessFields(data: BusinessIntakeData): FieldDef[] {
  return BUSINESS_FIELDS.filter((f) => !f.optional && !String(data[f.key] ?? '').trim());
}
