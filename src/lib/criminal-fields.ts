/**
 * The criminal defense case's field vocabulary. Same DB-free pattern as the
 * visa and university lists — definitions here, persistence in
 * criminal-intake.ts.
 *
 * Criminal intake is deliberately lighter than the commercial ones: a
 * detention or a charge is an emergency, so only what the lawyer's office
 * needs to take over is collected. There is no credit charge and no
 * document gate.
 */

export type CriminalField = {
  key: string;
  /** How the model refers to the field when asking. */
  label: string;
  /** Short form for any checklist UI. */
  short: string;
  /** Optional — never block the intake on it. */
  optional?: boolean;
};

export const CRIMINAL_FIELDS: CriminalField[] = [
  { key: 'fullName', label: 'full name', short: 'Full name' },
  { key: 'phone', label: 'mobile number with country code', short: 'Mobile number' },
  { key: 'citizenship', label: 'citizenship', short: 'Citizenship' },
  {
    key: 'situation',
    label: 'what happened — the situation in their own words, with date and place',
    short: 'What happened',
  },
  {
    key: 'charges',
    label: 'charges or allegations they are facing (e.g. working without permit, drug possession, arrest, deportation order)',
    short: 'Charges',
  },
  {
    key: 'custody',
    label: 'custody status — free, detained (where and since when), or arrest warrant',
    short: 'Custody status',
  },
  {
    key: 'location',
    label: 'city and district in Turkey where this is happening',
    short: 'Location',
  },
  { key: 'urgency', label: 'urgency — today, this week, or after', short: 'Urgency', optional: true },
  { key: 'extraInfo', label: 'anything else the lawyer should know', short: 'Extra info', optional: true },
];

export type CriminalIntakeData = Record<string, string>;

/** Which required fields are still unanswered. */
export function missingCriminalFields(data: CriminalIntakeData): CriminalField[] {
  return CRIMINAL_FIELDS.filter((f) => !f.optional && !String(data[f.key] ?? '').trim());
}
