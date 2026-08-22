/**
 * The visa application's field vocabulary — shared by the server (which saves
 * answers) and the client (which renders the checklist).
 *
 * Deliberately free of any database import. This list used to live in
 * visa-intake.ts, which imports `db`; a client component importing it from
 * there dragged the Neon driver into the browser bundle and blew up at module
 * evaluation. Definitions here, persistence there.
 */

export type IntakeField = {
  key: string;
  /**
   * How the model refers to the field when asking. Carries the hints that make
   * the question unambiguous ("as printed in the passport"), which is exactly
   * what you want in a question and exactly what you don't want on a card.
   */
  label: string;
  /** Short form for the UI checklist. */
  short: string;
  /** Optional — the form accepts an empty value, so never block on it. */
  optional?: boolean;
};

export const INTAKE_FIELDS: IntakeField[] = [
  // First, and deliberately so: the consulate, the appointment system and
  // the fee all follow from where the application is made, and every later
  // answer is wasted if it turns out we cannot serve that country.
  {
    key: 'applicationCountry',
    label: 'country you are applying from (where you will visit the Turkish consulate)',
    short: 'Applying from',
  },
  { key: 'nationality', label: 'nationality as printed in the passport', short: 'Nationality' },
  { key: 'firstName', label: 'given name (as printed in the passport)', short: 'Given name' },
  { key: 'lastName', label: 'surname (as printed in the passport)', short: 'Surname' },
  { key: 'gender', label: 'gender (Male or Female)', short: 'Gender' },
  { key: 'dateOfBirth', label: 'date of birth', short: 'Date of birth' },
  { key: 'placeOfBirth', label: 'place of birth', short: 'Place of birth' },
  { key: 'maritalStatus', label: 'marital status (Single or Married)', short: 'Marital status' },
  { key: 'fatherName', label: "father's full name", short: "Father's name" },
  { key: 'motherName', label: "mother's full name", short: "Mother's name" },
  { key: 'occupation', label: 'occupation (e.g. Student)', short: 'Occupation' },
  { key: 'passportNumber', label: 'passport number', short: 'Passport number' },
  { key: 'passportIssuedPlace', label: 'city where the passport was issued', short: 'Passport issued in' },
  { key: 'passportIssueDate', label: 'passport issue date', short: 'Passport issue date' },
  { key: 'passportExpiryDate', label: 'passport expiry date', short: 'Passport expiry date' },
  { key: 'email', label: 'email address', short: 'Email' },
  { key: 'phone', label: 'mobile number with country code', short: 'Mobile number' },
  { key: 'residenceAddress', label: 'home address', short: 'Home address' },
  { key: 'residenceCity', label: 'home city', short: 'Home city' },
  { key: 'residenceZipcode', label: 'postal code', short: 'Postal code', optional: true },
  { key: 'departureDate', label: 'planned travel date to Türkiye', short: 'Travel date' },
  { key: 'returnDate', label: 'planned return date', short: 'Return date', optional: true },
];

export type IntakeData = Record<string, string>;

/** Which required fields are still unanswered. */
export function missingFields(data: IntakeData): IntakeField[] {
  return INTAKE_FIELDS.filter((f) => !f.optional && !String(data[f.key] ?? '').trim());
}
