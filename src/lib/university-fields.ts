/**
 * The university application's field vocabulary — shared by the server (which
 * saves answers) and any client component that renders the checklist.
 *
 * Deliberately free of any database import, for the same reason the visa list
 * is: a client component importing from university-intake.ts would drag the
 * Neon driver into the browser bundle and blow up at module evaluation.
 * Definitions here, persistence there.
 *
 * The academic specifics come from the intake spec — academic history, grades,
 * intended field, budget, language level, preferred cities — plus the identity
 * basics a placement operator needs to actually reach the applicant.
 */

export type UniversityField = {
  key: string;
  /**
   * How the model refers to the field when asking. Carries the hints that make
   * the question unambiguous, exactly as the visa list does.
   */
  label: string;
  /** Short form for the UI checklist. */
  short: string;
  /** Optional — the form accepts an empty value, so never block on it. */
  optional?: boolean;
};

/**
 * The three answers that must exist before the document checklist is shown.
 *
 * A student who uploads an apostilled diploma and a tuition receipt before
 * picking a university has done the expensive, irreversible steps for a place
 * they may not want — the receipt in particular is issued by one named
 * university. So the choice comes first, and `getDocumentChecklist` refuses the
 * university checklist until these are answered. GPA and field of study sit in
 * the gate too, because they are what makes a suggestion worth anything.
 */
export const UNIVERSITY_CHOICE_KEYS = ['chosenUniversity', 'fieldOfStudy', 'grades'] as const;

export const UNIVERSITY_FIELDS: UniversityField[] = [
  {
    key: 'chosenUniversity',
    label:
      'which Turkish university they want to apply to — if they do not know yet, use suggest_universities and let them pick one from the list',
    short: 'Chosen university',
  },
  {
    key: 'fieldOfStudy',
    label: 'field they want to study (e.g. Computer Engineering, Business, Medicine)',
    short: 'Field of study',
  },
  {
    key: 'grades',
    label:
      'grades — GPA on a 4.0 scale, or their percentage average, saying which scale it is (e.g. "3.2/4.0" or "78%")',
    short: 'GPA / grades',
  },
  {
    key: 'studyLevel',
    label: 'level they are applying for — bachelor\'s, master\'s or PhD',
    short: 'Study level',
  },
  { key: 'firstName', label: 'given name', short: 'Given name' },
  { key: 'lastName', label: 'surname', short: 'Surname' },
  { key: 'dateOfBirth', label: 'date of birth', short: 'Date of birth' },
  { key: 'nationality', label: 'nationality', short: 'Nationality' },
  { key: 'email', label: 'email address', short: 'Email' },
  { key: 'phone', label: 'mobile number with country code', short: 'Mobile number' },
  {
    key: 'educationHistory',
    label: 'academic history — schools and universities attended, with years and the degree or diploma earned at each',
    short: 'Academic history',
  },
  {
    key: 'budgetUsd',
    label: 'annual budget in USD for tuition and living costs',
    short: 'Budget',
  },
  {
    key: 'languageLevel',
    label: 'language proficiency level (e.g. Turkish A2, English B2)',
    short: 'Language level',
  },
  {
    key: 'preferredCities',
    label: 'cities in Türkiye they prefer, comma-separated',
    short: 'Preferred cities',
  },
];

export type UniversityIntakeData = Record<string, string>;

/** Which required fields are still unanswered. */
export function missingUniversityFields(data: UniversityIntakeData): UniversityField[] {
  return UNIVERSITY_FIELDS.filter((f) => !f.optional && !String(data[f.key] ?? '').trim());
}

/**
 * Which of the pre-checklist answers are still outstanding. Empty means the
 * student has picked a university and the document list can be shown.
 */
export function missingUniversityChoice(data: UniversityIntakeData): UniversityField[] {
  return UNIVERSITY_FIELDS.filter(
    (f) =>
      (UNIVERSITY_CHOICE_KEYS as readonly string[]).includes(f.key) &&
      !String(data[f.key] ?? '').trim(),
  );
}

/** True once the student has named the university they are applying to. */
export function hasChosenUniversity(data: UniversityIntakeData): boolean {
  return Boolean(String(data.chosenUniversity ?? '').trim());
}
