/**
 * Private (vakıf / foundation) universities in Türkiye.
 *
 * GENERATED FILE — do not edit by hand.
 * Source: universities/turkey_private_university_emails.xlsx
 * Regenerate: python scripts/generate-universities.py
 *
 * Only facts that came from the universities' own sites are here: name, city,
 * website, and the admissions contact. Tuition figures and GPA thresholds are
 * deliberately absent — we do not hold verified numbers for them, and inventing
 * an entry requirement a student then plans around would be worse than saying
 * we need to check. `emailStatus` says whether the contact address was read off
 * the site ('confirmed') or inferred from that site's own address pattern
 * ('inferred'); never auto-send to an inferred address without checking it.
 */

export type TurkishUniversity = {
  name: string;
  city: string;
  website: string;
  /** Admissions / international office contact. Server-side use only. */
  email: string;
  emailStatus: 'confirmed' | 'inferred';
  /** Which office the address belongs to, e.g. "International Admissions". */
  office: string;
};

export const TURKISH_UNIVERSITIES: TurkishUniversity[] = [
  { name: 'Acıbadem Mehmet Ali Aydınlar Üniversitesi', city: 'İstanbul', website: 'https://acibadem.edu.tr', email: 'international.admissions@acibadem.edu.tr', emailStatus: 'confirmed', office: 'International Admissions' },
  { name: 'Alanya Üniversitesi', city: 'Antalya', website: 'https://alanyauniversity.edu.tr', email: 'info@alanyauniversity.edu.tr', emailStatus: 'confirmed', office: 'General' },
  { name: 'Altınbaş Üniversitesi', city: 'İstanbul', website: 'https://altinbas.edu.tr', email: 'international@altinbas.edu.tr', emailStatus: 'confirmed', office: 'International Office' },
  { name: 'Ankara Bilim Üniversitesi', city: 'Ankara', website: 'https://ankarabilim.edu.tr', email: 'info@ankarabilim.edu.tr', emailStatus: 'inferred', office: 'General' },
  { name: 'Ankara Medipol Üniversitesi', city: 'Ankara', website: 'https://ankaramedipol.edu.tr', email: 'info@ankaramedipol.edu.tr', emailStatus: 'inferred', office: 'General' },
  { name: 'Antalya Belek Üniversitesi', city: 'Antalya', website: 'https://belek.edu.tr', email: 'info@belek.edu.tr', emailStatus: 'inferred', office: 'General' },
  { name: 'Antalya Bilim Üniversitesi', city: 'Antalya', website: 'https://antalya.edu.tr', email: 'info@antalya.edu.tr', emailStatus: 'confirmed', office: 'General' },
  { name: 'Atılım Üniversitesi', city: 'Ankara', website: 'https://atilim.edu.tr', email: 'ic@atilim.edu.tr', emailStatus: 'confirmed', office: 'International Relations Directorate' },
  { name: 'Avrasya Üniversitesi', city: 'Trabzon', website: 'https://avrasya.edu.tr', email: 'iletisim@avrasya.edu.tr', emailStatus: 'confirmed', office: 'General' },
  { name: 'Bahçeşehir Üniversitesi (BAU)', city: 'İstanbul', website: 'https://bau.edu.tr', email: 'intoffice@int.bau.edu.tr', emailStatus: 'confirmed', office: 'BAU International Office' },
  { name: 'Başkent Üniversitesi', city: 'Ankara', website: 'https://baskent.edu.tr', email: 'webmaster@baskent.edu.tr', emailStatus: 'inferred', office: 'General (technical)' },
  { name: 'Beykoz Üniversitesi', city: 'İstanbul', website: 'https://beykoz.edu.tr', email: 'international@beykoz.edu.tr', emailStatus: 'inferred', office: 'International Office' },
  { name: 'Bezm-i Âlem Vakıf Üniversitesi', city: 'İstanbul', website: 'https://bezmialem.edu.tr', email: 'info@bezmialem.edu.tr', emailStatus: 'confirmed', office: 'General' },
  { name: 'Biruni Üniversitesi', city: 'İstanbul', website: 'https://biruni.edu.tr', email: 'info@biruni.edu.tr', emailStatus: 'confirmed', office: 'General' },
  { name: 'Demiroğlu Bilim Üniversitesi', city: 'İstanbul', website: 'https://demiroglu.bilim.edu.tr', email: 'info@demiroglu.bilim.edu.tr', emailStatus: 'inferred', office: 'General' },
  { name: 'Doğuş Üniversitesi', city: 'İstanbul', website: 'https://dogus.edu.tr', email: 'international@dogus.edu.tr', emailStatus: 'confirmed', office: 'International Relations Office' },
  { name: 'Fatih Sultan Mehmet Vakıf Üniversitesi', city: 'İstanbul', website: 'https://fsm.edu.tr', email: 'international@fsm.edu.tr', emailStatus: 'inferred', office: 'Directorate of International Relations' },
  { name: 'Fenerbahçe Üniversitesi', city: 'İstanbul', website: 'https://fbu.edu.tr', email: 'admission@fbu.edu.tr', emailStatus: 'confirmed', office: 'Admissions' },
  { name: 'Haliç Üniversitesi', city: 'İstanbul', website: 'https://halic.edu.tr', email: 'info@halic.edu.tr', emailStatus: 'confirmed', office: 'General' },
  { name: 'Hasan Kalyoncu Üniversitesi', city: 'Gaziantep', website: 'https://hku.edu.tr', email: 'info@hku.edu.tr', emailStatus: 'confirmed', office: 'General' },
  { name: 'Işık Üniversitesi', city: 'İstanbul', website: 'https://isikun.edu.tr', email: 'uidb@isikun.edu.tr', emailStatus: 'confirmed', office: 'International Relations / Erasmus Office' },
  { name: 'KTO Karatay Üniversitesi', city: 'Konya', website: 'https://karatay.edu.tr', email: 'info@karatay.edu.tr', emailStatus: 'inferred', office: 'General' },
  { name: 'Kadir Has Üniversitesi', city: 'İstanbul', website: 'https://khas.edu.tr', email: 'global@khas.edu.tr', emailStatus: 'inferred', office: 'Erasmus & Exchange / Global Office' },
  { name: 'Kapadokya Üniversitesi', city: 'Nevşehir', website: 'https://kapadokya.edu.tr', email: 'info@kapadokya.edu.tr', emailStatus: 'confirmed', office: 'General' },
  { name: 'Kocaeli Sağlık ve Teknoloji Üniversitesi', city: 'Kocaeli', website: 'https://kocaelisaglik.edu.tr', email: 'intoffice@kocaelisaglik.edu.tr', emailStatus: 'confirmed', office: 'International Office' },
  { name: 'Konya Gıda ve Tarım Üniversitesi', city: 'Konya', website: 'https://gidatarim.edu.tr', email: 'info@gidatarim.edu.tr', emailStatus: 'confirmed', office: 'General' },
  { name: 'Koç Üniversitesi', city: 'İstanbul', website: 'https://ku.edu.tr', email: 'international@ku.edu.tr', emailStatus: 'inferred', office: 'Student Recruitment Directorate' },
  { name: 'Lokman Hekim Üniversitesi', city: 'Ankara', website: 'https://lokmanhekim.edu.tr', email: 'international@lokmanhekim.edu.tr', emailStatus: 'inferred', office: 'Office of International Affairs' },
  { name: 'MEF Üniversitesi', city: 'İstanbul', website: 'https://mef.edu.tr', email: 'international.admissions@mef.edu.tr', emailStatus: 'confirmed', office: 'International Admissions' },
  { name: 'Maltepe Üniversitesi', city: 'İstanbul', website: 'https://maltepe.edu.tr', email: 'info@maltepe.edu.tr', emailStatus: 'inferred', office: 'General' },
  { name: 'Mudanya Üniversitesi', city: 'Bursa', website: 'https://mudanya.edu.tr', email: 'bilgi@mudanya.edu.tr', emailStatus: 'confirmed', office: 'General' },
  { name: 'Nuh Naci Yazgan Üniversitesi', city: 'Kayseri', website: 'https://nny.edu.tr', email: 'info@nny.edu.tr', emailStatus: 'inferred', office: 'General' },
  { name: 'OSTİM Teknik Üniversitesi', city: 'Ankara', website: 'https://ostimteknik.edu.tr', email: 'info@ostimteknik.edu.tr', emailStatus: 'inferred', office: 'General' },
  { name: 'Piri Reis Üniversitesi', city: 'İstanbul', website: 'https://pirireis.edu.tr', email: 'bilgi@pirireis.edu.tr', emailStatus: 'confirmed', office: 'General' },
  { name: 'SANKO Üniversitesi', city: 'Gaziantep', website: 'https://sanko.edu.tr', email: 'info@sanko.edu.tr', emailStatus: 'confirmed', office: 'General' },
  { name: 'Sabancı Üniversitesi', city: 'İstanbul', website: 'https://sabanciuniv.edu', email: 'iro-crm@sabanciuniv.edu', emailStatus: 'confirmed', office: 'International Relations Office (CRM/recruitment)' },
  { name: 'TED Üniversitesi', city: 'Ankara', website: 'https://tedu.edu.tr', email: 'ipo@tedu.edu.tr', emailStatus: 'confirmed', office: 'International Programs Office' },
  { name: 'TOBB Ekonomi ve Teknoloji Üniversitesi (TOBB ETÜ)', city: 'Ankara', website: 'https://etu.edu.tr', email: 'international@etu.edu.tr', emailStatus: 'confirmed', office: 'International Office' },
  { name: 'Toros Üniversitesi', city: 'Mersin', website: 'https://toros.edu.tr', email: 'info@toros.edu.tr', emailStatus: 'confirmed', office: 'General' },
  { name: 'Türk Hava Kurumu Üniversitesi', city: 'Ankara', website: 'https://thk.edu.tr', email: 'info@thk.edu.tr', emailStatus: 'inferred', office: 'General' },
  { name: 'Ufuk Üniversitesi', city: 'Ankara', website: 'https://ufuk.edu.tr', email: 'international@ufuk.edu.tr', emailStatus: 'confirmed', office: 'International Student Office' },
  { name: 'Yaşar Üniversitesi', city: 'İzmir', website: 'https://yasar.edu.tr', email: 'international@yasar.edu.tr', emailStatus: 'inferred', office: 'International Relations & Programs Office' },
  { name: 'Yeditepe Üniversitesi', city: 'İstanbul', website: 'https://yeditepe.edu.tr', email: 'international.agreements@yeditepe.edu.tr', emailStatus: 'confirmed', office: 'International Agreements & Partnerships' },
  { name: 'Yüksek İhtisas Üniversitesi', city: 'Ankara', website: 'https://yuksekihtisasuniversitesi.edu.tr', email: 'info@yuksekihtisasuniversitesi.edu.tr', emailStatus: 'inferred', office: 'General' },
  { name: 'Çankaya Üniversitesi', city: 'Ankara', website: 'https://cankaya.edu.tr', email: 'webadmin@cankaya.edu.tr', emailStatus: 'inferred', office: 'General (technical)' },
  { name: 'Çağ Üniversitesi', city: 'Mersin', website: 'https://cag.edu.tr', email: 'info@cag.edu.tr', emailStatus: 'inferred', office: 'General' },
  { name: 'Özyeğin Üniversitesi', city: 'İstanbul', website: 'https://ozyegin.edu.tr', email: 'info@ozyegin.edu.tr', emailStatus: 'confirmed', office: 'General' },
  { name: 'Üsküdar Üniversitesi', city: 'İstanbul', website: 'https://uskudar.edu.tr', email: 'international@uskudar.edu.tr', emailStatus: 'confirmed', office: 'International Office' },
  { name: 'İbn Haldun Üniversitesi', city: 'İstanbul', website: 'https://ihu.edu.tr', email: 'internationalstudents@ihu.edu.tr', emailStatus: 'confirmed', office: 'International Office (Admissions)' },
  { name: 'İhsan Doğramacı Bilkent Üniversitesi', city: 'Ankara', website: 'https://bilkent.edu.tr', email: 'ir@bilkent.edu.tr', emailStatus: 'confirmed', office: 'International Relations Office' },
  { name: 'İstanbul 29 Mayıs Üniversitesi', city: 'İstanbul', website: 'https://29mayis.edu.tr', email: '29mayis@29mayis.edu.tr', emailStatus: 'confirmed', office: 'General' },
  { name: 'İstanbul Arel Üniversitesi', city: 'İstanbul', website: 'https://arel.edu.tr', email: 'int.office@arel.edu.tr', emailStatus: 'confirmed', office: 'International Office' },
  { name: 'İstanbul Atlas Üniversitesi', city: 'İstanbul', website: 'https://atlas.edu.tr', email: 'info@atlas.edu.tr', emailStatus: 'inferred', office: 'General' },
  { name: 'İstanbul Aydın Üniversitesi', city: 'İstanbul', website: 'https://aydin.edu.tr', email: 'international@aydin.edu.tr', emailStatus: 'confirmed', office: 'International Admissions' },
  { name: 'İstanbul Beykent Üniversitesi', city: 'İstanbul', website: 'https://beykent.edu.tr', email: 'international@beykent.edu.tr', emailStatus: 'inferred', office: 'International Office' },
  { name: 'İstanbul Bilgi Üniversitesi', city: 'İstanbul', website: 'https://bilgi.edu.tr', email: 'international@bilgi.edu.tr', emailStatus: 'confirmed', office: 'International Admissions (Undergraduate)' },
  { name: 'İstanbul Esenyurt Üniversitesi', city: 'İstanbul', website: 'https://esenyurt.edu.tr', email: 'international@esenyurt.edu.tr', emailStatus: 'inferred', office: 'International Students Office' },
  { name: 'İstanbul Galata Üniversitesi', city: 'İstanbul', website: 'https://galata.edu.tr', email: 'info@galata.edu.tr', emailStatus: 'confirmed', office: 'International Office' },
  { name: 'İstanbul Gedik Üniversitesi', city: 'İstanbul', website: 'https://gedik.edu.tr', email: 'international@gedik.edu.tr', emailStatus: 'confirmed', office: 'International Office' },
  { name: 'İstanbul Gelişim Üniversitesi', city: 'İstanbul', website: 'https://gelisim.edu.tr', email: 'bilgi@gelisim.edu.tr', emailStatus: 'confirmed', office: 'General' },
  { name: 'İstanbul Kent Üniversitesi', city: 'İstanbul', website: 'https://kent.edu.tr', email: 'international@kent.edu.tr', emailStatus: 'confirmed', office: 'International Office' },
  { name: 'İstanbul Kültür Üniversitesi', city: 'İstanbul', website: 'https://iku.edu.tr', email: 'yob@iku.edu.tr', emailStatus: 'confirmed', office: 'International Office (full-time students)' },
  { name: 'İstanbul Medipol Üniversitesi', city: 'İstanbul', website: 'https://medipol.edu.tr', email: 'info@medipol.edu.tr', emailStatus: 'inferred', office: 'General' },
  { name: 'İstanbul Nişantaşı Üniversitesi', city: 'İstanbul', website: 'https://nisantasi.edu.tr', email: 'info@nisantasi.edu.tr', emailStatus: 'inferred', office: 'General' },
  { name: 'İstanbul Okan Üniversitesi', city: 'İstanbul', website: 'https://okan.edu.tr', email: 'info@okan.edu.tr', emailStatus: 'inferred', office: 'General' },
  { name: 'İstanbul Rumeli Üniversitesi', city: 'İstanbul', website: 'https://rumeli.edu.tr', email: 'info@rumeli.edu.tr', emailStatus: 'inferred', office: 'General' },
  { name: 'İstanbul Sabahattin Zaim Üniversitesi', city: 'İstanbul', website: 'https://izu.edu.tr', email: 'info@izu.edu.tr', emailStatus: 'inferred', office: 'General' },
  { name: 'İstanbul Sağlık ve Teknoloji Üniversitesi', city: 'İstanbul', website: 'https://istun.edu.tr', email: 'info@istun.edu.tr', emailStatus: 'confirmed', office: 'General' },
  { name: 'İstanbul Ticaret Üniversitesi', city: 'İstanbul', website: 'https://ticaret.edu.tr', email: 'info@ticaret.edu.tr', emailStatus: 'inferred', office: 'General' },
  { name: 'İstanbul Topkapı Üniversitesi', city: 'İstanbul', website: 'https://topkapi.edu.tr', email: 'internationalstudent@topkapi.edu.tr', emailStatus: 'confirmed', office: 'International Relations Office' },
  { name: 'İstanbul Yeni Yüzyıl Üniversitesi', city: 'İstanbul', website: 'https://yeniyuzyil.edu.tr', email: 'info@yeniyuzyil.edu.tr', emailStatus: 'inferred', office: 'General' },
  { name: 'İstinye Üniversitesi', city: 'İstanbul', website: 'https://istinye.edu.tr', email: 'info@istinye.edu.tr', emailStatus: 'confirmed', office: 'General' },
  { name: 'İzmir Ekonomi Üniversitesi', city: 'İzmir', website: 'https://ieu.edu.tr', email: 'info@ieu.edu.tr', emailStatus: 'inferred', office: 'General' },
  { name: 'İzmir Tınaztepe Üniversitesi', city: 'İzmir', website: 'https://tinaztepe.edu.tr', email: 'info@tinaztepe.edu.tr', emailStatus: 'inferred', office: 'General' },
];

/** Distinct cities, most universities first — used to offer real choices. */
export function universityCities(): { city: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const u of TURKISH_UNIVERSITIES) {
    counts.set(u.city, (counts.get(u.city) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([city, count]) => ({ city, count }))
    .sort((a, b) => b.count - a.count || a.city.localeCompare(b.city));
}

/** Case- and diacritic-insensitive match, so "gelisim" finds "Gelişim". */
function fold(s: string): string {
  return s
    .toLocaleLowerCase('tr')
    .replace(/ı/g, 'i').replace(/İ/g, 'i')
    .replace(/ş/g, 's').replace(/ğ/g, 'g')
    .replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Resolves what the student typed to a university on the list.
 * Returns null rather than a near-miss: registering the wrong university is
 * far worse than asking them to confirm which one they meant.
 */
export function findUniversity(input: string): TurkishUniversity | null {
  const q = fold(input);
  if (q.length < 3) return null;

  const exact = TURKISH_UNIVERSITIES.find((u) => fold(u.name) === q);
  if (exact) return exact;

  const hits = TURKISH_UNIVERSITIES.filter((u) => {
    const name = fold(u.name);
    return name.includes(q) || q.includes(fold(u.name.split(' ')[0]));
  });
  return hits.length === 1 ? hits[0] : null;
}

/** Every university whose name contains the query, for "did you mean" lists. */
export function searchUniversities(input: string, limit = 8): TurkishUniversity[] {
  const q = fold(input);
  if (q.length < 2) return [];
  return TURKISH_UNIVERSITIES.filter((u) => fold(u.name).includes(q)).slice(0, limit);
}

/** Universities in a city, for suggestions. Empty when the city is unknown. */
export function universitiesInCity(city: string, limit = 10): TurkishUniversity[] {
  const q = fold(city);
  if (!q) return [];
  return TURKISH_UNIVERSITIES.filter((u) => fold(u.city) === q).slice(0, limit);
}
