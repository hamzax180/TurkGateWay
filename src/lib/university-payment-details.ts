/**
 * Official tuition-payment details, per university.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS FILE IS FILLED IN BY HAND, FROM THE UNIVERSITY'S OWN OFFER LETTER OR
 * ADMISSIONS OFFICE. NOTHING HERE MAY BE GUESSED, DERIVED, OR MODEL-GENERATED.
 *
 * A student reads these numbers and then wires money. A wrong IBAN does not
 * produce a bad answer, it produces a lost international transfer that no one
 * can reverse. So the contract is deliberately strict:
 *
 *   - An entry exists only when someone has read it off an official document.
 *   - `verifiedOn` records when, and `verifiedFrom` records where from.
 *   - Anything not listed here returns null, and the agent then tells the
 *     student our team will send the official details — which is true, and is
 *     always better than a plausible-looking account number.
 *
 * The IBAN of every entry is checksum-checked at module load (see below), so a
 * mistyped digit fails fast at build/boot instead of on a student's screen.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Keys must match `name` in turkish-universities.ts exactly.
 */

export type UniversityPaymentDetails = {
  /**
   * What the student pays first, in the currency below — typically the
   * registration deposit or first instalment, NOT the full annual tuition.
   */
  firstPayment: number;
  currency: 'USD' | 'EUR' | 'TRY';
  /** Free-text, e.g. "first instalment of the 2026/2027 tuition". */
  firstPaymentNote: string;
  accountHolder: string;
  bankName: string;
  iban: string;
  swift?: string;
  /** e.g. "Write the student's full name and passport number as reference." */
  reference?: string;
  /** ISO date the details were last checked against an official source. */
  verifiedOn: string;
  /** Where they were read from, e.g. "offer letter 2026-03-11". */
  verifiedFrom: string;
};

/**
 * Add universities here as their details are confirmed. Empty is the correct
 * starting state: an empty registry makes the agent say "our team will send
 * you the payment details", which is honest. A populated registry with an
 * invented row would not be.
 *
 * Example of a completed entry — the shape, not real data:
 *
 *   'Altınbaş Üniversitesi': {
 *     firstPayment: 1000,
 *     currency: 'USD',
 *     firstPaymentNote: 'registration deposit, deducted from first-year tuition',
 *     accountHolder: 'Altınbaş Üniversitesi',
 *     bankName: '...',
 *     iban: 'TR...',
 *     swift: '...',
 *     reference: "Student's full name + passport number",
 *     verifiedOn: '2026-08-21',
 *     verifiedFrom: 'offer letter PDF, admissions office',
 *   },
 */
export const UNIVERSITY_PAYMENT_DETAILS: Record<string, UniversityPaymentDetails> = {
  // (intentionally empty — see the note above before adding anything)
};

/** ISO 13616 mod-97 check. Returns false for anything that is not a valid IBAN. */
export function isValidIban(raw: string): boolean {
  const iban = raw.replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$/.test(iban)) return false;

  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const digits = rearranged.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));

  // Chunked mod-97, because the number is far wider than a JS number.
  let remainder = 0;
  for (const digit of digits) {
    remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

/** Groups an IBAN in fours so a student can read it back without losing place. */
export function formatIban(iban: string): string {
  return iban.replace(/\s+/g, '').toUpperCase().replace(/(.{4})/g, '$1 ').trim();
}

/**
 * Payment details for a university, or null when we hold none.
 *
 * Null is a normal, expected answer — callers must handle it by promising the
 * details rather than producing them.
 */
export function paymentDetailsFor(universityName: string): UniversityPaymentDetails | null {
  const key = universityName.trim();
  const direct = UNIVERSITY_PAYMENT_DETAILS[key];
  if (direct) return direct;

  const folded = key.toLocaleLowerCase('tr');
  const match = Object.entries(UNIVERSITY_PAYMENT_DETAILS).find(
    ([name]) => name.toLocaleLowerCase('tr') === folded,
  );
  return match ? match[1] : null;
}

/** Money as the student should see it: "1,000 USD". */
export function formatAmount(amount: number, currency: string): string {
  return `${amount.toLocaleString('en-US')} ${currency}`;
}

// A bad IBAN in here is a lost transfer, so it fails at load rather than in a
// student's chat. Anything added above is checked the moment the module runs.
for (const [name, details] of Object.entries(UNIVERSITY_PAYMENT_DETAILS)) {
  if (!isValidIban(details.iban)) {
    throw new Error(
      `university-payment-details: IBAN for "${name}" fails its checksum — re-read it from the official document before deploying.`,
    );
  }
  if (!(details.firstPayment > 0)) {
    throw new Error(`university-payment-details: firstPayment for "${name}" must be a positive amount.`);
  }
}
