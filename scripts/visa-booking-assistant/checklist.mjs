/**
 * checklist.mjs
 * Required-documents list for the Türkiye Student Visa (Ashgabat, Tömer &
 * Student Visa track), sourced from Mosaic Visa's own published requirements.
 * Printed before the browser opens so you can confirm you actually have
 * everything ready — this script does not verify or upload any of it.
 */

export const REQUIRED_DOCUMENTS = [
  {
    title: '1. Passport',
    items: [
      'Original passport and one photocopy.',
      'Valid for at least 8 months beyond intended entry, with at least 2 blank visa pages.',
      'Copies of previous passports and previously issued visas, if available.',
    ],
  },
  {
    title: '2. Biometric Photographs',
    items: [
      'Two (2) recent biometric photographs, 5x6cm, white background, issued within the last 6 months.',
    ],
  },
  {
    title: '3. Valid ID and Residency Status',
    items: [
      'Turkmen citizens: original + copy of national ID (internal passport), plus birth/marriage/divorce certificates with Turkish translations.',
      'Non-Turkmen residents: residence permit valid at least 3 months from the application date, original + copy.',
    ],
  },
  {
    title: '4. Educational Documentation',
    items: [
      'Letter of acceptance / enrollment confirmation / official invitation from the Turkish institution (Turkish or English), still valid on the submission date.',
      'Secondary School Graduation Certificate (High School Diploma).',
      'Current students: valid Öğrenci Belgesi, valid İkamet İzni, and an official Transkript.',
      "Master's applicants: Bachelor's Degree Diploma or equivalent.",
    ],
  },
  {
    title: '5. Financial Support and Sponsorship',
    items: [
      'Applications without a sponsor will not be accepted.',
      'Turkish citizen sponsor: notarized Taahhütname, employment certificate with salary (last 3 months), or 3 months of bank statements.',
      'Turkmen citizen sponsor: notarized sponsorship declaration + employment certificate with salary, both with Turkish translations.',
    ],
  },
  {
    title: '6. Minor Applicants (Under 18)',
    items: [
      'Original notarized parental consent / power of attorney signed by both parents, with Turkish translation.',
      "Applicant's birth certificate and, where applicable, parental death certificate(s), with Turkish translations.",
    ],
  },
  {
    title: '7. Additional Supporting Documents',
    items: [
      'Property ownership documents (Tapu) in Turkmenistan or Türkiye, if applicable.',
      'Recent bank statements.',
      'Vehicle ownership documents, if applicable.',
      'Copies of previous Turkish residence permits, if applicable.',
      "Copies of first-degree relatives' residence/permit documents in Türkiye, if applicable.",
    ],
  },
];

export const LEGALIZATION_ORDER = [
  'State Notary of Turkmenistan',
  'Ministry of Justice of Turkmenistan',
  'Ministry of Foreign Affairs of Turkmenistan',
  'Embassy of the Republic of Türkiye in Ashgabat',
];

export function printChecklist() {
  console.log('\n📋 Required documents — Türkiye Student Visa (Ashgabat)\n' + '─'.repeat(60));
  for (const section of REQUIRED_DOCUMENTS) {
    console.log(`\n${section.title}`);
    for (const item of section.items) console.log(`  • ${item}`);
  }
  console.log('\nDocuments in sections 1–7 must be legalized in this order:');
  LEGALIZATION_ORDER.forEach((step, i) => console.log(`  ${i + 1}. ${step}`));
  console.log('\n' + '─'.repeat(60));
  console.log('This is a reminder only — the script does not check or upload documents.\n');
}
