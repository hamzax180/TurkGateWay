import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { db } from './db';
import { applicationDocuments, type ApplicationKind } from './schema';
import { ensureApplication } from './application-documents';

/**
 * form-docs.ts
 * Filled replica PDFs of the official application forms, built from the data
 * the agent collected in chat. Delivered as a downloadable file in the chat so
 * the applicant has the finished paperwork before (and after) visiting the
 * real portal.
 *
 * These are NOT government documents — the official processed document comes
 * from the portal itself, which the user downloads there (the dashboard
 * runbook animates where that download button is). These PDFs carry the same
 * fields and layout so nothing is missing when the form is copied across.
 */

export type FormKind =
  | 'ikamet'
  | 'ikamet_renewal'
  | 'visa'
  | 'insurance'
  | 'university'
  | 'business';

/** Which application row the generated PDF belongs to. */
const KIND_TO_APPLICATION: Record<FormKind, ApplicationKind> = {
  ikamet: 'ikamet',
  ikamet_renewal: 'ikamet',
  visa: 'visa_appointment',
  insurance: 'insurance',
  university: 'university',
  business: 'business',
};

const FORM_META: Record<FormKind, { title: string; note: string }> = {
  ikamet: {
    title: 'İKAMET BAŞVURU FORMU',
    note: 'Filled from your chat answers. Submit the official application at e-ikamet.goc.gov.tr.',
  },
  ikamet_renewal: {
    title: 'İKAMET UZATMA BAŞVURU FORMU',
    note: 'Filled from your chat answers. Submit the official renewal at e-ikamet.goc.gov.tr (Uzatma).',
  },
  visa: {
    title: 'STUDENT VISA APPLICATION FORM',
    note: 'Filled from your chat answers. The official form is submitted at the Turkish consulate / visa center.',
  },
  insurance: {
    title: 'STUDENT HEALTH INSURANCE APPLICATION',
    note: 'Filled from your chat answers. The policy is issued by the insurer (e.g. SGK / private insurers).',
  },
  university: {
    title: 'UNIVERSITY APPLICATION PACKET',
    note: 'Filled from your chat answers. Official registration happens at the university and YÖKSİS.',
  },
  business: {
    title: 'İŞYERİ AÇMA VE ÇALIŞMA RUHSATI BAŞVURU FORMU',
    note: 'Filled from your chat answers. The official application is submitted via e-Devlet to the district municipality.',
  },
};

/**
 * pdf-lib's standard fonts encode WinAnsi (Latin-1) only, and Turkish needs
 * six characters that fall outside it: ş Ş ğ Ğ ı İ. Every label on these forms
 * is Turkish, so drawing them raw threw `WinAnsi cannot encode "ş"` and the
 * whole document failed to render — which is why no filled form ever came out
 * of this module.
 *
 * Transliterating is the pragmatic fix: the labels are bilingual, so the
 * English half is untouched and the Turkish half stays readable. Embedding a
 * Unicode TTF would preserve the diacritics but means shipping a font file.
 *
 * Applicant values go through it too — a name like "Şahin" must not blow up
 * the form either.
 */
const WINANSI_SAFE: Record<string, string> = {
  'ş': 's', 'Ş': 'S',
  'ğ': 'g', 'Ğ': 'G',
  'ı': 'i', 'İ': 'I',
  '\u2019': "'", '\u2018': "'",
  '\u201c': '"', '\u201d': '"',
  '\u2013': '-', '\u2014': '-',
};

export function pdfSafe(text: string): string {
  let out = String(text ?? '').replace(/[şŞğĞıİ\u2018\u2019\u201c\u201d\u2013\u2014]/g, (c) => WINANSI_SAFE[c] ?? c);
  // Anything still outside Latin-1 (Cyrillic, Arabic, Persian names) would
  // throw as well. Strip accents where that yields ASCII, and drop whatever
  // remains rather than losing the entire document over one glyph.
  out = out.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  return out.replace(/[^\u0000-\u00ff]/g, '');
}

type Row = [string, string | undefined | null];

function rowsFor(kind: FormKind, data: Record<string, string>): Row[] {
  switch (kind) {
    case 'ikamet':
      return [
        ['Ad (Given name)', data.firstName],
        ['Soyad (Surname)', data.lastName],
        ['Pasaport No (Passport number)', data.passportNumber],
        ['Pasaport Geçerlilik (Passport expiry)', data.passportExpiry],
        ['Uyruk (Nationality)', data.nationality],
        ['Doğum Tarihi (Date of birth)', data.dateOfBirth],
        ['Baba Adı (Father\'s name)', data.fatherName],
        ['Anne Adı (Mother\'s name)', data.motherName],
        ['Cinsiyet (Gender)', data.gender],
        ['E-posta (Email)', data.email],
        ['Telefon (Phone)', data.phone],
        ['Türkiye\'deki Adres (Address in Türkiye)', data.addressInTr],
        ['Türkiye\'ye Giriş Tarihi (Entry date)', data.entryDate],
      ];
    case 'ikamet_renewal':
      return [
        ['İkamet No (Current permit number)', data.permitNumber],
        ['İkamet Bitiş Tarihi (Permit expiry)', data.permitExpiry],
        ...rowsFor('ikamet', data),
      ];
    case 'visa':
      return [
        ['Başvuru Ülkesi (Applying from)', data.applicationCountry],
        ['Uyruk (Nationality)', data.nationality],
        ['Ad (Given name)', data.firstName],
        ['Soyad (Surname)', data.lastName],
        ['Cinsiyet (Gender)', data.gender],
        ['Doğum Tarihi (Date of birth)', data.dateOfBirth],
        ['Doğum Yeri (Place of birth)', data.placeOfBirth],
        ['Medeni Durum (Marital status)', data.maritalStatus],
        ['Baba Adı (Father\'s name)', data.fatherName],
        ['Anne Adı (Mother\'s name)', data.motherName],
        ['Meslek (Occupation)', data.occupation],
        ['Pasaport No (Passport number)', data.passportNumber],
        ['Pasaport Veriliş Yeri (Issued in)', data.passportIssuedPlace],
        ['Pasaport Veriliş Tarihi (Issue date)', data.passportIssueDate],
        ['Pasaport Geçerlilik (Expiry date)', data.passportExpiryDate],
        ['E-posta (Email)', data.email],
        ['Telefon (Phone)', data.phone],
        ['İkamet Adresi (Home address)', data.residenceAddress],
        ['Şehir (City)', data.residenceCity],
        ['Posta Kodu (Postal code)', data.residenceZipcode],
        ['Türkiye\'ye Gidiş Tarihi (Travel date)', data.departureDate],
        ['Dönüş Tarihi (Return date)', data.returnDate],
      ];
    case 'insurance':
      return [
        ['Ad (Given name)', data.firstName],
        ['Soyad (Surname)', data.lastName],
        ['Doğum Tarihi (Date of birth)', data.dateOfBirth],
        ['Uyruk (Nationality)', data.nationality],
        ['Pasaport No (Passport number)', data.passportNumber],
        ['Üniversite (University)', data.university],
        ['Kayıt Tarihi (Enrollment date)', data.enrollmentDate],
        ['Başlangıç Ayı (Coverage start)', data.coverageStart],
        ['E-posta (Email)', data.email],
        ['Telefon (Phone)', data.phone],
      ];
    case 'university':
      return [
        ['Ad (Given name)', data.firstName],
        ['Soyad (Surname)', data.lastName],
        ['Doğum Tarihi (Date of birth)', data.dateOfBirth],
        ['Uyruk (Nationality)', data.nationality],
        ['E-posta (Email)', data.email],
        ['Telefon (Phone)', data.phone],
        ['Eğitim Geçmişi (Academic history)', data.educationHistory],
        ['Notlar (Grades)', data.grades],
        ['Bölüm (Field of study)', data.fieldOfStudy],
        ['Bütçe (Budget USD/year)', data.budgetUsd],
        ['Dil Seviyesi (Language level)', data.languageLevel],
        ['Tercih Edilen Şehirler (Preferred cities)', data.preferredCities],
      ];
    case 'business':
      return [
        ['İşletme Adı (Business name)', data.businessName],
        ['Faaliyet (Activity / NACE)', data.activity],
        ['İlçe (District)', data.district],
        ['Adres (Address)', data.address],
        ['Sahip Adı (Owner given name)', data.ownerFirstName],
        ['Sahip Soyadı (Owner surname)', data.ownerLastName],
        ['Pasaport / TCKN (Owner passport/TCKN)', data.ownerPassportOrTckn],
        ['Telefon (Phone)', data.phone],
        ['E-posta (Email)', data.email],
        ['Kira Durumu (Lease status)', data.leaseStatus],
      ];
  }
}

const ROW_HEIGHT = 34;
const PAGE_MARGIN = 50;
const PAGE_HEIGHT = 842;

/**
 * Build the filled PDF. Pure — no DB access, so it can be tested or reused
 * anywhere. Returns the bytes and a suggested filename.
 */
export async function generateFormPdf(kind: FormKind, data: Record<string, string>) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const meta = FORM_META[kind];
  const rows = rowsFor(kind, data);
  const dateStr = new Date().toISOString().slice(0, 10);

  const addPage = (start: number, end: number) => {
    const page = pdf.addPage([595.28, PAGE_HEIGHT]);
    const { height } = page.getSize();

    page.drawText(pdfSafe(meta.title), { x: PAGE_MARGIN, y: height - 60, size: 16, font: bold, color: rgb(0.1, 0.1, 0.15) });
    page.drawText(pdfSafe(`Düzenleme tarihi / Generated: ${dateStr}`), { x: PAGE_MARGIN, y: height - 80, size: 9, font, color: rgb(0.45, 0.45, 0.5) });
    page.drawText(pdfSafe(meta.note), { x: PAGE_MARGIN, y: height - 95, size: 8.5, font, color: rgb(0.55, 0.55, 0.6) });
    page.drawLine({
      start: { x: PAGE_MARGIN, y: height - 105 },
      end: { x: 595.28 - PAGE_MARGIN, y: height - 105 },
      thickness: 1,
      color: rgb(0.85, 0.85, 0.9),
    });

    let y = height - 135;
    for (const [label, value] of rows.slice(start, end)) {
      page.drawText(pdfSafe(label), { x: PAGE_MARGIN, y: y - 10, size: 9, font: bold, color: rgb(0.25, 0.25, 0.3) });
      page.drawText(value?.trim() ? pdfSafe(value.trim()) : '-', { x: PAGE_MARGIN + 190, y: y - 10, size: 10, font, color: rgb(0.05, 0.05, 0.1) });
      page.drawLine({
        start: { x: PAGE_MARGIN, y: y - ROW_HEIGHT + 12 },
        end: { x: 595.28 - PAGE_MARGIN, y: y - ROW_HEIGHT + 12 },
        thickness: 0.6,
        color: rgb(0.92, 0.92, 0.95),
      });
      y -= ROW_HEIGHT;
    }

    if (end >= rows.length) {
      page.drawText(
        pdfSafe('Bu belge TurkGateway ajanı tarafından sohbette verdiğiniz bilgilerden doldurulmuştur. Resmi başvuru devlet portalında yapılır.'),
        { x: PAGE_MARGIN, y: 30, size: 8, font, color: rgb(0.6, 0.6, 0.65) },
      );
      page.drawText(
        'This document was filled by the TurkGateway agent from your chat answers. The official application is submitted on the government portal.',
        { x: PAGE_MARGIN, y: 18, size: 8, font, color: rgb(0.6, 0.6, 0.65) },
      );
    }
  };

  const perPage = Math.max(1, Math.floor((PAGE_HEIGHT - 150) / ROW_HEIGHT));
  for (let start = 0; start < rows.length; start += perPage) {
    addPage(start, Math.min(rows.length, start + perPage));
  }

  const bytes = await pdf.save();
  const filename = `${kind}_application_${dateStr}.pdf`;
  return { bytes, filename };
}

/**
 * Persist a generated form against the session's application and return the
 * document id the download route serves.
 */
export async function storeGeneratedForm(opts: {
  sessionId: string;
  userId: number | null;
  kind: FormKind;
  filename: string;
  bytes: Uint8Array;
}) {
  const application = await ensureApplication(
    opts.sessionId,
    opts.userId,
    KIND_TO_APPLICATION[opts.kind],
  );

  const [doc] = await db
    .insert(applicationDocuments)
    .values({
      application_id: application.id,
      kind: `generated_${opts.kind}`,
      filename: opts.filename,
      mime_type: 'application/pdf',
      size_bytes: opts.bytes.byteLength,
      data: Buffer.from(opts.bytes),
    })
    .returning({ id: applicationDocuments.id });

  return { documentId: doc.id, applicationId: application.id };
}
