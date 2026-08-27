/**
 * Matching uploaded files to the portal's upload fields.
 *
 * e-İkamet asks for several documents on one page, each with its own file
 * input and its own Turkish label. Attaching the wrong scan to the wrong slot
 * is not a cosmetic mistake — it is a rejected application weeks later — so a
 * file is only ever attached when the label maps unambiguously to one of the
 * documents you listed. Anything uncertain is left empty and reported, exactly
 * like an unrecognised text field.
 */

import { existsSync } from 'node:fs';
import { basename } from 'node:path';

/**
 * Turkish and English label fragments for each document slot.
 *
 * Matching is on the label the portal actually shows. Every pattern here is
 * anchored on words that identify one specific document — deliberately narrow,
 * because a loose pattern that matches two slots would attach the same file
 * twice and leave a real requirement empty.
 */
export const DOCUMENT_MATCHERS = [
  {
    key: 'passport',
    patterns: [/pasaport/i, /passport/i, /seyahat belge/i, /travel document/i],
    // "pasaport fotokopisi" and "pasaport sureti" are the same document.
    label: 'Passport',
  },
  {
    key: 'photo',
    patterns: [/biyometrik/i, /fotoğraf/i, /fotograf/i, /\bphoto/i, /vesikalık/i],
    label: 'Biometric photo',
  },
  {
    key: 'insurance',
    patterns: [/sağlık sigorta/i, /saglik sigorta/i, /health insurance/i, /\bsigorta/i, /\binsurance/i],
    label: 'Health insurance policy',
  },
  {
    key: 'studentCertificate',
    patterns: [/öğrenci belge/i, /ogrenci belge/i, /student certificate/i, /öğrencilik/i, /enrol/i],
    label: 'Student certificate',
  },
  {
    key: 'addressProof',
    patterns: [
      /adres/i, /address/i, /kira sözleşme/i, /kira sozlesme/i,
      /rental/i, /tenancy/i, /yurt belge/i, /dormitory/i, /accommodation/i,
    ],
    label: 'Proof of address',
  },
  {
    key: 'feeReceipt',
    patterns: [/harç/i, /harc\b/i, /dekont/i, /makbuz/i, /receipt/i, /fee payment/i, /ödeme belge/i],
    label: 'Fee receipt',
  },
  {
    key: 'previousPermit',
    patterns: [/mevcut ikamet/i, /önceki ikamet/i, /onceki ikamet/i, /existing residence/i, /previous residence/i, /ikamet kart/i],
    label: 'Previous residence permit',
  },
];

/**
 * Fold Turkish letters onto ASCII before matching.
 *
 * JavaScript's /i flag does NOT fold the Turkish dotted capital İ (U+0130) or
 * dotless ı (U+0131) onto ASCII "i" — Unicode simple case folding leaves them
 * alone. So /ikamet/i silently fails to match "İkamet", which is how the
 * portal actually writes it. That miss is invisible: the field just stays
 * empty and the applicant submits without the document.
 */
export function fold(s) {
  return String(s)
    .replace(/İ/g, 'i').replace(/I/g, 'i').replace(/ı/g, 'i')
    .replace(/Ş/g, 's').replace(/ş/g, 's')
    .replace(/Ğ/g, 'g').replace(/ğ/g, 'g')
    .replace(/Ü/g, 'u').replace(/ü/g, 'u')
    .replace(/Ö/g, 'o').replace(/ö/g, 'o')
    .replace(/Ç/g, 'c').replace(/ç/g, 'c')
    .toLowerCase();
}

/**
 * Which document belongs in a field with this label.
 *
 * Returns null when nothing matches, and — importantly — also when MORE than
 * one matcher matches. An ambiguous label means we cannot tell which scan the
 * portal wants, and guessing is the failure mode this whole module exists to
 * prevent.
 */
export function matchDocument(label) {
  if (!label) return null;
  const folded = fold(label);
  const hits = DOCUMENT_MATCHERS.filter((m) =>
    m.patterns.some((re) => new RegExp(fold(re.source), re.flags).test(folded)),
  );
  return hits.length === 1 ? hits[0] : null;
}

/**
 * The document paths from applicant.json, minus the `_note` keys the template
 * carries for humans, and minus anything blank.
 */
export function usableDocuments(applicant) {
  const docs = applicant?.documents ?? {};
  const out = {};
  for (const [key, value] of Object.entries(docs)) {
    if (key.startsWith('_')) continue;
    const path = String(value ?? '').trim();
    if (path) out[key] = path;
  }
  return out;
}

/**
 * Report on what you gave us, before a browser is opened: which documents are
 * present, which paths do not exist on disk, and which are still missing.
 * Checking up front means a wrong path surfaces now rather than as a silently
 * skipped upload twenty minutes into the form.
 */
export function auditDocuments(applicant) {
  const provided = usableDocuments(applicant);
  const isExtension = String(applicant?.applicationType ?? '').toLowerCase() === 'extension';

  const present = [];
  const broken = [];
  for (const [key, path] of Object.entries(provided)) {
    const matcher = DOCUMENT_MATCHERS.find((m) => m.key === key);
    const label = matcher?.label ?? key;
    if (existsSync(path)) present.push({ key, label, path, file: basename(path) });
    else broken.push({ key, label, path });
  }

  const missing = DOCUMENT_MATCHERS.filter((m) => {
    if (provided[m.key]) return false;
    // Only extensions are asked for the card they already hold.
    if (m.key === 'previousPermit') return isExtension;
    return true;
  }).map((m) => ({ key: m.key, label: m.label }));

  return { present, broken, missing };
}


/**
 * The first two letters of a name, as the portal's two-character boxes want
 * them.
 *
 * The entry page identifies you by the opening letters of your names rather
 * than the whole thing, in a box with `maxlength="2"` and an uppercasing
 * class. Punctuation and spaces are dropped first so a surname written
 * "Al-Ahdal" gives AL, matching how the card prints it.
 *
 * Upper-casing is the plain Unicode one, not the Turkish locale rule: these
 * are foreign nationals' names, and a Turkish fold would turn the "i" of
 * "Ibrahim" into a dotted "İ" that does not appear on their passport.
 */
export function initials(name) {
  const letters = String(name ?? '').replace(/[^\p{L}]/gu, '');
  return letters ? letters.slice(0, 2).toUpperCase() : null;
}

/**
 * Every given name, which is what this portal's "Name" box wants.
 *
 * A card reads e.g. AHMED OMAR HASAN / AL-SAYED: three given names in one box,
 * the surname in the next. `firstName` alone would under-fill it and
 * `fullName` would repeat the surname the neighbouring box already holds, so
 * it is the full name with the surname taken off the end. When the two do not
 * line up — the surname is not actually how the full name ends — it falls back
 * to the given name rather than cutting the string anyway. A name is not a
 * place to be approximately right.
 */
export function givenNames(applicant) {
  const full = String(applicant?.fullName ?? '').trim();
  const last = String(applicant?.lastName ?? '').trim();
  if (full && last && full.toLowerCase().endsWith(last.toLowerCase())) {
    const withoutSurname = full.slice(0, full.length - last.length).trim();
    if (withoutSurname) return withoutSurname;
  }
  return String(applicant?.firstName ?? '').trim() || null;
}

/**
 * Fields on the e-İkamet form whose label admits exactly one answer.
 *
 * These bypass the model entirely. Identity fields are the wrong place for a
 * judgement call: the country dropdown carries ~200 options, and a model asked
 * to return one exact option string from that list can reasonably answer SKIP
 * — which leaves a mandatory field blank with no explanation. The label here
 * says precisely what belongs in it, so it is resolved directly.
 *
 * `key` names a field in applicant.json.
 */
export const IKAMET_FIELD_MATCHERS = [
  // The surname box is listed BEFORE the given-name one on purpose. Matching
  // stops at the first pattern that hits, and a label reading "...of Your Last
  // Name" must never be answered by a rule written for "...of Your Name".
  {
    key: 'lastName',
    patterns: [
      /first two letters of your (last name|surname)/i,
      /soyad[ıi]n[ıi]z[ıi]n ilk iki harf/i,
    ],
    derive: (a) => initials(a.lastName),
  },
  {
    key: 'firstName',
    patterns: [/first two letters of your name/i, /ad[ıi]n[ıi]z[ıi]n ilk iki harf/i],
    derive: (a) => initials(a.firstName),
  },
  {
    key: 'nationality',
    patterns: [
      /country of nationality/i,
      /^uyruk/i,
      /nationality/i,
      /uyru[gğ]u/i,
      // How the portal writes it in Turkish — "Vatandaşı Olduğunuz Ülke".
      /vatanda[sş][ıi] oldu[gğ]unuz/i,
      /tabiiyet/i,
    ],
  },
  {
    key: 'foreignerIdNumber',
    patterns: [/foreigners? id/i, /yabanc[ıi] kimlik/i, /y\.?k\.?n/i],
  },
  {
    key: 'residenceCardSerialNo',
    patterns: [
      /card serial number/i,
      /seri numaras/i,
      /^seri no/i,
      // "İkamet İzin Kartı Seri", the Turkish label.
      /kart[ıi] seri/i,
      /izin kart[ıi] seri/i,
    ],
  },
  // ── Personal Information 1, the step after the e-mail verification link ──
  //
  // These get matchers rather than being left to the model because each has
  // exactly one right answer and the plausible wrong answers are bad ones:
  // "Name" on this page means every given name and sits beside its own surname
  // box, and "Previous Surname" sits directly under both — a box the portal's
  // own tooltip says to leave blank, with three given names next to it that a
  // reasonable guess would happily reach for.
  {
    key: 'givenNames',
    patterns: [/^name$/i, /^ad[ıi]?$/i, /^first name/i, /given name/i],
    derive: (a) => givenNames(a),
  },
  {
    key: 'lastName',
    patterns: [/his\/?her last name/i, /^last name$/i, /^surname$/i, /^soyad[ıi]?$/i],
  },
  {
    // With no `previousSurname` in applicant.json this resolves to nothing and
    // the box is left alone — which is the entire reason for naming it.
    key: 'previousSurname',
    patterns: [/previous surname/i, /previous last name/i, /[oö]nceki soyad/i, /eski soyad/i],
  },
  { key: 'fatherName', patterns: [/father'?s? name/i, /baba ad/i] },
  { key: 'motherName', patterns: [/mother'?s? name/i, /anne ad/i] },
  {
    key: 'residenceCardNo',
    patterns: [
      /residence permit card number/i,
      /kart numaras[ıi]/i,
      /belge no/i,
      // "İkamet İzin Kartı No". Safe next to the SERIAL box of nearly the
      // same name only because the never-fill list is consulted before this
      // one — the ordering is load-bearing, not incidental.
      /izin kart[ıi] no/i,
    ],
  },
  { key: 'passportNumber', patterns: [/passport (no|number)/i, /pasaport (no|numaras)/i] },
  { key: 'passportType', patterns: [/passport type/i, /pasaport t[uü]r/i] },
  { key: 'email', patterns: [/e-?mail/i, /e-?posta/i] },
  { key: 'phone', patterns: [/cell phone/i, /mobile/i, /cep telefon/i, /^telefon/i] },
  {
    key: 'changeProvinceOfResidence',
    patterns: [/change my province/i, /il de[gğ]i[sş]/i, /il[ıi]m[ıi] de[gğ]i[sş]/i],
  },
  { key: 'communicationPreference', patterns: [/communication preference/i, /ileti[sş]im tercih/i] },
];


/**
 * Boxes the assistant must never write into, however confidently it could.
 *
 * Only the image verification box remains here. Reading it is a bot check, and
 * defeating one is not something this tool does; it is named explicitly so it
 * is reported as the applicant's to type rather than appearing in the run as
 * an unexplained failure.
 *
 * The card SERIAL number used to be on this list, on the reasoning that the
 * letter prefix is the applicant's to type. It is filled now, at the
 * applicant's request, from `residenceCardSerialNo` — it is printed on the
 * card they are holding, exactly like the card number beside it.
 */
export const IKAMET_NEVER_FILL = [
  /characters you see/i,
  /verification code/i,
  /g[uü]venlik kodu/i,
  /do[gğ]rulama kodu/i,
  /captcha/i,
  // "Resimde görüntülenen karakterleri, resmin yanındaki boşluğa giriniz."
  /resimde g[oö]r[uü]nt[uü]lenen/i,
  /resimdeki karakter/i,
];

/**
 * Why a field was left blank, for the report at each pause.
 *
 * "Still empty" covers two completely different situations — a box the
 * assistant is not allowed to touch, and one it tried and could not fill —
 * and running them together makes the second kind invisible. Anything on the
 * never-fill list, plus the declaration checkbox, is waiting for the applicant
 * by design; everything else is a gap worth looking at.
 */
export function isYoursByDesign(label) {
  const patterns = [...IKAMET_NEVER_FILL, /read,? understood/i, /okudum/i, /beyan/i];
  // Tested against the folded label as well as the raw one, for the same
  // reason the engine does: /i does not fold the dotted capital İ, so a
  // Turkish label would otherwise slip past every pattern here.
  return patterns.some((re) => re.test(label) || re.test(fold(label)));
}
