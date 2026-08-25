/**
 * Translating a stored İkamet application into what the assistant expects.
 *
 * Two vocabularies grew up apart and now have to meet. The web side collects
 * answers under the keys in `ikamet-fields.ts` and keeps documents as bytes in
 * `application_documents`; the assistant in `scripts/ikamet-assistant` was
 * written for a hand-edited `applicant.json` with its own names and absolute
 * paths on disk. Neither is wrong, and neither is worth rewriting to match the
 * other — the difference is small, and it belongs in one file that says so.
 *
 * Both maps live here together on purpose. They drift for the same reason (a
 * field or a checklist item changes) and a mismatch in either produces the same
 * silent failure: a box the portal wanted, left empty, noticed weeks later.
 */

import type { IkametIntakeData } from './ikamet-fields';

/**
 * Where the two field vocabularies disagree. Anything absent from this table
 * is already spelled the same on both sides and passes straight through.
 */
const FIELD_RENAMES: Record<string, string> = {
  passportExpiry: 'passportExpiryDate',
  addressInTr: 'addressInTurkey',
  // The portal calls the number printed on the current card the "Card No",
  // which is what a renewal is asked for. Intake calls the same thing the
  // permit number.
  permitNumber: 'residenceCardNo',
};

/**
 * The applicant object the assistant's matchers and Qwen pass both read.
 *
 * `fullName` is derived rather than asked for, exactly as the CLI's
 * `loadApplicant` derives it, because `givenNames()` in `documents.mjs` needs
 * it to work out what belongs in the portal's "Name" box — that box wants every
 * given name, and the only way to know where the given names end is to take the
 * surname off the end of the full name.
 */
export function toAssistantApplicant(
  data: IkametIntakeData,
  isExtension: boolean,
): Record<string, string> {
  const applicant: Record<string, string> = {};

  for (const [key, value] of Object.entries(data)) {
    const text = String(value ?? '').trim();
    if (!text) continue;
    applicant[FIELD_RENAMES[key] ?? key] = text;
  }

  if (!applicant.fullName && applicant.firstName && applicant.lastName) {
    applicant.fullName = `${applicant.firstName} ${applicant.lastName}`.trim();
  }

  // Decides which form opens and which documents the portal asks for, so it is
  // set from the service the applicant actually chose rather than guessed at
  // from whether a permit number happens to be present.
  applicant.applicationType = isExtension ? 'extension' : 'first';

  return applicant;
}

/**
 * Which uploaded document belongs in which of the assistant's document slots.
 *
 * The keys are `application_documents.kind`, which `itemKey()` derives from a
 * checklist item's English title plus ITS INDEX — so inserting an item into
 * either İkamet checklist silently renumbers everything after it and orphans
 * this table along with the uploads themselves. `document-checklists.ts` says
 * to append rather than insert; this map is the second reason why.
 *
 * The values are the keys `matchDocument()` in the assistant resolves portal
 * upload labels to. A kind that is absent here is not attached and is reported
 * as the applicant's to attach — the rule that whole module exists to enforce,
 * because the wrong scan in the wrong slot is a rejection weeks later, not a
 * cosmetic error.
 */
export const DOCUMENT_KIND_MAP: Record<string, string> = {
  // ikamet_new — İlk Başvuru
  'passport-copy-1': 'passport',
  '4-biometric-photos-2': 'photo',
  'student-certificate-renci-be-3': 'studentCertificate',
  'health-insurance-1-year-4': 'insurance',
  'address-proof-rental-contrac-5': 'addressProof',
  'tax-number-card-fee-receipt-6': 'feeReceipt',

  // ikamet_renewal — Uzatma
  'current-i-kamet-card-number-0': 'previousPermit',
  'updated-student-certificate-1': 'studentCertificate',
  'valid-health-insurance-2': 'insurance',
  'address-proof-if-address-cha-3': 'addressProof',
  // This item is two documents in one row ("4 biometric photos + card fee
  // receipt"). It resolves to the photo only: one file cannot be attached to
  // two slots, and leaving the fee receipt for the applicant is the honest
  // outcome — the assistant names every slot it left empty at each pause.
  '4-biometric-photos-card-fee-5': 'photo',

  // 'i-kamet-application-form-fro-0' and 'renewal-application-form-e-i-4' map
  // to nothing deliberately: that form is what the portal produces at the end
  // of this run, not an upload it asks for at the start.
};

/** The document slot an uploaded file belongs in, or null to leave it alone. */
export function documentSlotFor(kind: string): string | null {
  return DOCUMENT_KIND_MAP[kind] ?? null;
}
