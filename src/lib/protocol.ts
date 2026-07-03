/**
 * protocol.ts
 * Hardcoded workflow step generators — zero API calls.
 * Ported from backend/utils/protocol.py
 */

type Lang = 'en' | 'tr' | 'ar';

interface Step {
  id: number;
  title: string;
  responsible: 'Human' | 'Agent' | 'Human/Agent' | 'Agent/Human';
  status: 'pending';
  notes: string;
  docs: string[];
}

interface WorkflowResult {
  execution_plan: { steps: Step[]; assigned_agents: string[] };
  combined_result: {
    permits: string[];
    agencies: string[];
    documents: string[];
    steps: { title: string; description: string; documents: string[] }[];
    timeline_days: number;
    summary: string;
    location: string;
    business_type: string;
  };
  assistant_type: string;
  last_updated: string;
}

// ---------------------------------------------------------------------------
// Manual instructions (ported from _AGENT_NOTES)
// ---------------------------------------------------------------------------
const AGENT_NOTES: Record<string, Record<Lang, string>> = {
  mersis_name: {
    en: '🔒 Do manually: Go to mersis.ticaret.gov.tr → log in via e-Devlet → click \'Ön Başvuru\' → type your desired company name → submit.',
    tr: '🔒 Manuel yapın: mersis.ticaret.gov.tr → e-Devlet ile giriş → \'Ön Başvuru\' → şirket unvanını girin → gönderin.',
    ar: '🔒 أكمل يدوياً: mersis.ticaret.gov.tr ← تسجيل الدخول عبر e-Devlet ← انقر Ön Başvuru ← أدخل اسم الشركة ← أرسل.',
  },
  mersis_nace: {
    en: '🔒 Do manually: Inside MERSİS after step 3, click \'Faaliyet Ekle\' → search keywords → select your NACE code (e.g. 56.10 Restaurant, 47.xx Retail, 62.01 Software).',
    tr: '🔒 Manuel yapın: MERSİS\'te 3. adımdan sonra \'Faaliyet Ekle\' → anahtar kelime arayın → NACE kodunu seçin.',
    ar: '🔒 أكمل يدوياً: في MERSİS بعد الخطوة 3 ← انقر Faaliyet Ekle ← ابحث بالكلمات المفتاحية ← اختر كود NACE.',
  },
  mersis_articles: {
    en: '🔒 Do manually: MERSİS auto-generates Articles after steps 3–4. Review on screen → download PDF → print 3 copies for your notary visit.',
    tr: '🔒 Manuel yapın: MERSİS Ana Sözleşme\'yi otomatik oluşturur. Belgeyi inceleyin → PDF indirin → 3 kopya yazdırın.',
    ar: '🔒 أكمل يدوياً: MERSİS يُنشئ العقد تلقائياً. راجع المستند ← حمّل PDF ← اطبع 3 نسخ.',
  },
  edevlet_permit: {
    en: '🔒 Do manually: Go to turkiye.gov.tr → search \'İşyeri Açma ve Çalışma Ruhsatı\' → select your district municipality → fill in business name, address, activity type → upload: signed lease, tax registration certificate, floor plan.',
    tr: '🔒 Manuel yapın: turkiye.gov.tr → \'İşyeri Açma ve Çalışma Ruhsatı\' arayın → ilçe belediyenizi seçin → bilgileri girin → yükleyin: kira sözleşmesi, vergi levhası, kat planı.',
    ar: '🔒 أكمل يدوياً: اذهب إلى turkiye.gov.tr ← ابحث عن İşyeri Açma ve Çalışma Ruhsatı ← اختر البلدية ← أدخل البيانات ← ارفع: عقد الإيجار، التسجيل الضريبي، مخطط الطابق.',
  },
  food_sicil: {
    en: '🔒 Do manually: Go to tarim.gov.tr → \'Gıda İşletmeci Kaydı\' → fill form (business name, address, NACE food code) → upload: lease, floor plan, tax registration.',
    tr: '🔒 Manuel yapın: tarim.gov.tr → \'Gıda İşletmeci Kaydı\' → formu doldurun → yükleyin: kira, kat planı, vergi levhası.',
    ar: '🔒 أكمل يدوياً: اذهب إلى tarim.gov.tr ← Gıda İşletmeci Kaydı ← أكمل النموذج ← ارفع: عقد الإيجار، مخطط الطابق.',
  },
};

function n(key: string, lang: Lang): string {
  return AGENT_NOTES[key]?.[lang] ?? AGENT_NOTES[key]?.['en'] ?? '';
}

// ---------------------------------------------------------------------------
// Detect business sub-type from query string
// ---------------------------------------------------------------------------
export function detectType(businessType: string): string {
  const bt = businessType.toLowerCase();
  if (/register_uni|student_kimlik|student_renew/.test(bt)) return bt;
  if (/student|öğrenci|university|kimlik|degree|academic|bachelor|master|phd|college/.test(bt)) return 'student';
  if (/contract|sözleşme|nda|agreement|clause|review|contract_review/.test(bt)) return 'lawyer_contract';
  if (/company|formation|incorporate|ltd|aş|mersis|company_formation|şirket/.test(bt)) return 'lawyer_company';
  if (/employment|fired|dismissed|severance|labour|labor|termination|işçi|kıdem|employment_law/.test(bt)) return 'lawyer_employment';
  if (/dispute|lawsuit|court|mediation|arabuluculuk|sue|ihtarname|legal_dispute/.test(bt)) return 'lawyer_dispute';
  if (/work permit|work visa|ikamet|residency|residence_permit|lawyer_residency/.test(bt)) return 'lawyer_residency';
  if (/lawyer|law|legal|hukuk|avukat|mahkeme/.test(bt)) return 'lawyer_contract';
  if (/cafe|kafe|restaur|lokanta|food|yemek|gıda|mutfak|pasta|bakery|fırın|döner|kebab|pizza|burger|bar|pub/.test(bt)) return 'food';
  if (/retail|perakende|shop|store|market|dükkan|mağaza|boutique|clothes|giyim|electronics/.test(bt)) return 'retail';
  if (/service|hizmet|consulting|danışman|office|ofis|tech|yazılım|software|agency|ajans|accounting|muhasebe|clinic|salon|hotel|otel|school|okul/.test(bt)) return 'service';
  return 'general';
}

// ---------------------------------------------------------------------------
// Step generators (ported from Python _steps_food, _steps_retail, etc.)
// ---------------------------------------------------------------------------
function stepsFood(lang: Lang): Step[] {
  return [
    { id: 1, title: { en: 'Obtain Turkish Tax Number', tr: 'Vergi Kimlik Numarası Al', ar: 'الحصول على الرقم الضريبي التركي' }[lang], responsible: 'Human', status: 'pending', notes: { en: 'Go to local tax office with passport (required for foreigners).', tr: 'Pasaportunuzla yerel vergi dairesine gidin.', ar: 'اذهب إلى مكتب الضرائب المحلي مع جواز السفر.' }[lang], docs: ['Passport'] },
    { id: 2, title: { en: 'Decide Company Type (LTD or Sole Prop.)', tr: 'Şirket Türüne Karar Ver', ar: 'تحديد نوع الشركة' }[lang], responsible: 'Human/Agent', status: 'pending', notes: { en: 'Sole Prop. for small cafes/restaurants; LTD for partnerships.', tr: 'Küçük kafe/restoran için şahıs, ortaklık için LTD.', ar: 'الملكية الفردية للمقاهي الصغيرة، LTD للشراكات.' }[lang], docs: [] },
    { id: 3, title: { en: 'Reserve Company Name via MERSİS', tr: 'MERSİS\'te Şirket Unvanını Rezerve Et', ar: 'حجز اسم الشركة عبر MERSİS' }[lang], responsible: 'Agent', status: 'pending', notes: n('mersis_name', lang), docs: ['e-Devlet Login'] },
    { id: 4, title: { en: 'Select NACE Code (Food & Beverage)', tr: 'NACE Kodu Seç (Gıda & İçecek)', ar: 'اختيار كود NACE (الغذاء والمشروبات)' }[lang], responsible: 'Agent', status: 'pending', notes: n('mersis_nace', lang), docs: [] },
    { id: 5, title: { en: 'Generate Articles of Association', tr: 'Ana Sözleşmeyi Oluştur', ar: 'إنشاء النظام الأساسي للشركة' }[lang], responsible: 'Agent', status: 'pending', notes: n('mersis_articles', lang), docs: ['MERSİS PDF'] },
    { id: 6, title: { en: 'Secure Business Premises', tr: 'İşyeri Tut', ar: 'تأمين مقر العمل' }[lang], responsible: 'Human', status: 'pending', notes: { en: 'Premises must meet fire, hygiene, and ventilation standards; obtain signed lease.', tr: 'Yangın, hijyen ve havalandırma standartlarına uygun kira sözleşmesi alın.', ar: 'يجب أن تستوفي المقر معايير الحريق والصحة؛ احصل على عقد إيجار موقّع.' }[lang], docs: ['Signed Lease Agreement'] },
    { id: 7, title: { en: 'Notarize Articles & Signatures', tr: 'Sözleşme ve İmzaları Noter Onaylı Yap', ar: 'تصديق العقد والتوقيعات لدى كاتب العدل' }[lang], responsible: 'Human', status: 'pending', notes: { en: 'Visit Turkish notary with printed Articles, IDs, and translations if needed.', tr: 'Basılı Ana Sözleşme ve kimliklerle noter ziyareti yapın.', ar: 'زر كاتب العدل التركي مع العقد المطبوع والهويات.' }[lang], docs: ['Notarized Articles', 'ID/Passport'] },
    { id: 8, title: { en: 'Submit Registration to Trade Registry', tr: 'Ticaret Siciline Tescil Başvurusu Yap', ar: 'تقديم التسجيل إلى السجل التجاري' }[lang], responsible: 'Human/Agent', status: 'pending', notes: { en: 'Go to local Trade Registry Office with: notarized Articles, shareholder list, lease, ID copies. Pay fee (~500–1,500 TL).', tr: 'Yerel Ticaret Sicili\'ne gidin. Ücret: ~500–1.500 TL.', ar: 'اذهب إلى السجل التجاري المحلي. ادفع ~500–1,500 TL.' }[lang], docs: ['Notarized Articles', 'Shareholder List', 'Lease', 'ID Copies'] },
    { id: 9, title: { en: 'Open Corporate Bank Account', tr: 'Kurumsal Banka Hesabı Aç', ar: 'فتح حساب بنكي للشركة' }[lang], responsible: 'Human', status: 'pending', notes: { en: 'After Trade Registry approval, open account at any Turkish bank (Ziraat, İş, Garanti, VakıfBank).', tr: 'Ticaret Sicili onayından sonra herhangi bir Türk bankasında hesap açın.', ar: 'بعد موافقة السجل التجاري، افتح حساباً في أي بنك تركي.' }[lang], docs: ['Trade Registry Certificate'] },
    { id: 10, title: { en: 'Register with Tax Office (VAT & Corp. Tax)', tr: 'Vergi Dairesine Kayıt (KDV & Kurumlar Vergisi)', ar: 'التسجيل في مكتب الضرائب' }[lang], responsible: 'Human', status: 'pending', notes: { en: 'Register VAT and corporate tax; receive official tax plate to display in premises.', tr: 'KDV ve kurumlar vergisi kaydı; vergi levhası alın.', ar: 'سجّل ضريبة القيمة المضافة؛ احصل على لوحة الضرائب.' }[lang], docs: ['Tax Registration Certificate'] },
    { id: 11, title: { en: 'Apply for İşyeri Açma ve Çalışma Ruhsatı', tr: 'İşyeri Açma ve Çalışma Ruhsatı Başvurusu', ar: 'التقدم بطلب رخصة فتح وتشغيل المحل' }[lang], responsible: 'Agent', status: 'pending', notes: n('edevlet_permit', lang), docs: ['Lease', 'Tax Certificate', 'Floor Plan'] },
    { id: 12, title: { en: 'Obtain Gıda Sicil / Food Registration', tr: 'Gıda Sicil Kaydı Al', ar: 'الحصول على سجل غذائي' }[lang], responsible: 'Agent/Human', status: 'pending', notes: n('food_sicil', lang), docs: ['Lease', 'Floor Plan', 'Tax Registration'] },
    { id: 13, title: { en: 'Pass Municipal Hygiene Inspection', tr: 'Belediye Hijyen Denetiminden Geç', ar: 'اجتياز فحص النظافة البلدي' }[lang], responsible: 'Human', status: 'pending', notes: { en: 'Inspector visits to check kitchen, ventilation, restrooms, and fire extinguishers on-site.', tr: 'Denetçi; mutfak, havalandırma, tuvalet ve yangın tüplerini denetler.', ar: 'يفحص المفتش المطبخ والتهوية ودورات المياه.' }[lang], docs: [] },
    { id: 14, title: { en: 'Fire Safety Certificate (İtfaiye)', tr: 'Yangın Güvenlik Sertifikası Al', ar: 'شهادة السلامة من الحريق' }[lang], responsible: 'Human', status: 'pending', notes: { en: 'Fire department inspects extinguishers, exits, and signage. Book via local fire station (İtfaiye).', tr: 'İtfaiye; tüpler, çıkışlar ve levhaları kontrol eder.', ar: 'تفحص الإطفاء الطفايات والمخارج.' }[lang], docs: ['Fire Safety Report'] },
    { id: 15, title: { en: 'Hire Accountant & Register Employees with SGK', tr: 'Muhasebeci Tut ve Çalışanları SGK\'ya Kaydet', ar: 'توظيف محاسب وتسجيل الموظفين في SGK' }[lang], responsible: 'Human', status: 'pending', notes: { en: 'Certified accountant (SMMM) required by law. Register all staff with SGK before first working day.', tr: 'Kanunla zorunlu SMMM. Tüm personeli ilk çalışma gününden önce SGK\'ya kaydedin.', ar: 'محاسب معتمد (SMMM) مطلوب قانونياً.' }[lang], docs: ['Employee SGK Forms'] },
    { id: 16, title: { en: 'Display Permits & Open for Business', tr: 'İzinleri Görünür Yere As ve Aç', ar: 'عرض التصاريح والافتتاح' }[lang], responsible: 'Human', status: 'pending', notes: { en: 'Post İşyeri Ruhsatı, Food Registration, and Fire Certificate visibly before serving first customer.', tr: 'Tüm belgeleri görünür yere asın.', ar: 'علّق جميع التصاريح بوضوح.' }[lang], docs: ['İşyeri Ruhsatı', 'Food Registration', 'Fire Certificate'] },
  ];
}

function stepsRetail(lang: Lang): Step[] {
  return [
    { id: 1, title: { en: 'Obtain Turkish Tax Number', tr: 'Vergi Kimlik Numarası Al', ar: 'الحصول على الرقم الضريبي التركي' }[lang], responsible: 'Human', status: 'pending', notes: { en: 'Go to local tax office with passport.', tr: 'Pasaportunuzla yerel vergi dairesine gidin.', ar: 'اذهب إلى مكتب الضرائب مع جواز السفر.' }[lang], docs: ['Passport'] },
    { id: 2, title: { en: 'Decide Company Type', tr: 'Şirket Türüne Karar Ver', ar: 'تحديد نوع الشركة' }[lang], responsible: 'Human/Agent', status: 'pending', notes: { en: 'Sole Prop. for single-owner shops; LTD for partnerships.', tr: 'Tekli sahiplik için şahıs, ortaklık için LTD.', ar: 'الملكية الفردية للمحلات الفردية.' }[lang], docs: [] },
    { id: 3, title: { en: 'Reserve Company Name via MERSİS', tr: 'MERSİS\'te Şirket Unvanını Rezerve Et', ar: 'حجز اسم الشركة عبر MERSİS' }[lang], responsible: 'Agent', status: 'pending', notes: n('mersis_name', lang), docs: ['e-Devlet Login'] },
    { id: 4, title: { en: 'Select NACE Code (Retail)', tr: 'NACE Kodu Seç (Perakende)', ar: 'اختيار كود NACE (التجزئة)' }[lang], responsible: 'Agent', status: 'pending', notes: n('mersis_nace', lang), docs: [] },
    { id: 5, title: { en: 'Generate Articles of Association', tr: 'Ana Sözleşmeyi Oluştur', ar: 'إنشاء النظام الأساسي للشركة' }[lang], responsible: 'Agent', status: 'pending', notes: n('mersis_articles', lang), docs: ['MERSİS PDF'] },
    { id: 6, title: { en: 'Lease Business Premises', tr: 'İşyeri Kirala', ar: 'استئجار مقر العمل' }[lang], responsible: 'Human', status: 'pending', notes: { en: 'Ensure zoning allows retail use; obtain signed lease.', tr: 'Bölge imar planına uygunluğu kontrol edin.', ar: 'تأكد من أن التصنيف يسمح بالتجزئة.' }[lang], docs: ['Signed Lease Agreement'] },
    { id: 7, title: { en: 'Notarize Articles & Signatures', tr: 'Sözleşme ve İmzaları Noter Onaylı Yap', ar: 'تصديق العقد والتوقيعات' }[lang], responsible: 'Human', status: 'pending', notes: { en: 'Visit Turkish notary with printed Articles and IDs.', tr: 'Basılı Ana Sözleşme ve kimliklerle noter ziyareti yapın.', ar: 'زر كاتب العدل مع العقد المطبوع والهويات.' }[lang], docs: ['Notarized Articles', 'ID/Passport'] },
    { id: 8, title: { en: 'Submit Registration to Trade Registry', tr: 'Ticaret Siciline Tescil', ar: 'التسجيل في السجل التجاري' }[lang], responsible: 'Human/Agent', status: 'pending', notes: { en: 'Go to Trade Registry Office with notarized Articles, lease, ID copies. Fee: ~500–1,500 TL.', tr: 'Ticaret Sicili\'ne gidin. Ücret: ~500–1.500 TL.', ar: 'اذهب إلى السجل التجاري. الرسوم: ~500–1,500 TL.' }[lang], docs: ['Notarized Articles', 'Lease', 'IDs'] },
    { id: 9, title: { en: 'Open Corporate Bank Account', tr: 'Kurumsal Banka Hesabı Aç', ar: 'فتح حساب بنكي' }[lang], responsible: 'Human', status: 'pending', notes: { en: 'Open at any Turkish bank after Trade Registry approval.', tr: 'Ticaret Sicili onayından sonra herhangi bir Türk bankasında açın.', ar: 'افتح في أي بنك تركي بعد التسجيل.' }[lang], docs: ['Trade Registry Certificate'] },
    { id: 10, title: { en: 'Register with Tax Office', tr: 'Vergi Dairesine Kayıt Ol', ar: 'التسجيل في مكتب الضرائب' }[lang], responsible: 'Human', status: 'pending', notes: { en: 'Register VAT and corporate tax; collect official tax plate.', tr: 'KDV ve kurumlar vergisi kaydı; vergi levhası alın.', ar: 'سجّل ضريبة القيمة المضافة؛ احصل على لوحة الضرائب.' }[lang], docs: ['Tax Registration Certificate'] },
    { id: 11, title: { en: 'Apply for İşyeri Açma ve Çalışma Ruhsatı', tr: 'İşyeri Açma ve Çalışma Ruhsatı Başvurusu', ar: 'التقدم بطلب رخصة التشغيل' }[lang], responsible: 'Agent', status: 'pending', notes: n('edevlet_permit', lang), docs: ['Lease', 'Tax Certificate', 'Floor Plan'] },
    { id: 12, title: { en: 'Hire Accountant & Register Employees with SGK', tr: 'Muhasebeci Tut ve SGK Kaydı', ar: 'توظيف محاسب وتسجيل الموظفين في SGK' }[lang], responsible: 'Human', status: 'pending', notes: { en: 'Certified accountant (SMMM) required. Register employees before first working day.', tr: 'Kanunla zorunlu SMMM. Çalışanları SGK\'ya kaydedin.', ar: 'محاسب معتمد مطلوب.' }[lang], docs: ['Employee SGK Forms'] },
    { id: 13, title: { en: 'Open Store for Business', tr: 'Mağazayı Açın', ar: 'افتتاح المتجر' }[lang], responsible: 'Human', status: 'pending', notes: { en: 'Display İşyeri Ruhsatı visibly; begin trading only after all approvals.', tr: 'İşyeri Ruhsatı\'nı görünür yere asın.', ar: 'علّق رخصة المحل بوضوح.' }[lang], docs: ['İşyeri Ruhsatı'] },
  ];
}

function stepsService(lang: Lang): Step[] {
  return [
    { id: 1, title: { en: 'Obtain Turkish Tax Number', tr: 'Vergi Kimlik Numarası Al', ar: 'الحصول على الرقم الضريبي التركي' }[lang], responsible: 'Human', status: 'pending', notes: { en: 'Go to local tax office with passport (required for foreigners).', tr: 'Pasaportunuzla yerel vergi dairesine gidin.', ar: 'اذهب إلى مكتب الضرائب مع جواز السفر.' }[lang], docs: ['Passport'] },
    { id: 2, title: { en: 'Decide Company Type (LTD or A.Ş.)', tr: 'Şirket Türüne Karar Ver (LTD/A.Ş.)', ar: 'تحديد نوع الشركة (LTD أو A.Ş.)' }[lang], responsible: 'Human/Agent', status: 'pending', notes: { en: 'LTD suits most consulting/tech firms; A.Ş. for larger investor-backed companies.', tr: 'LTD çoğu danışmanlık/teknoloji şirketine uygundur.', ar: 'LTD مناسبة لمعظم شركات الاستشارات والتكنولوجيا.' }[lang], docs: [] },
    { id: 3, title: { en: 'Reserve Company Name via MERSİS', tr: 'MERSİS\'te Şirket Unvanını Rezerve Et', ar: 'حجز اسم الشركة عبر MERSİS' }[lang], responsible: 'Agent', status: 'pending', notes: n('mersis_name', lang), docs: [] },
    { id: 4, title: { en: 'Select NACE Code (Service Sector)', tr: 'NACE Kodu Seç (Hizmet Sektörü)', ar: 'اختيار كود NACE (قطاع الخدمات)' }[lang], responsible: 'Agent', status: 'pending', notes: n('mersis_nace', lang), docs: [] },
    { id: 5, title: { en: 'Generate Articles of Association', tr: 'Ana Sözleşmeyi Oluştur', ar: 'إنشاء النظام الأساسي' }[lang], responsible: 'Agent', status: 'pending', notes: n('mersis_articles', lang), docs: ['MERSİS PDF'] },
    { id: 6, title: { en: 'Secure Office Address', tr: 'Ofis Adresi Temin Et', ar: 'تأمين عنوان المكتب' }[lang], responsible: 'Human', status: 'pending', notes: { en: 'Physical or virtual office address accepted. Ensure it\'s verifiable for tax inspection.', tr: 'Fiziksel veya sanal ofis adresi kabul edilir.', ar: 'مكتب فعلي أو افتراضي مقبول للتسجيل.' }[lang], docs: ['Lease or Virtual Office Agreement'] },
    { id: 7, title: { en: 'Notarize Articles & Signatures', tr: 'Sözleşme ve İmzaları Noter Onaylı Yap', ar: 'تصديق العقد لدى كاتب العدل' }[lang], responsible: 'Human', status: 'pending', notes: { en: 'Visit Turkish notary with printed Articles, IDs, and translations.', tr: 'Basılı Ana Sözleşme ve kimliklerle noter ziyareti yapın.', ar: 'زر كاتب العدل مع العقد والهويات.' }[lang], docs: ['Notarized Articles', 'IDs'] },
    { id: 8, title: { en: 'Deposit Share Capital (LTD min. 10,000 TL)', tr: 'Sermayeyi Bankaya Yatır (LTD min. 10.000 TL)', ar: 'إيداع رأس المال (LTD الحد الأدنى 10,000 TL)' }[lang], responsible: 'Human', status: 'pending', notes: { en: 'Deposit minimum share capital to a bank escrow account before Trade Registry submission.', tr: 'Ticaret Sicili başvurusundan önce asgari sermayeyi bankaya yatırın.', ar: 'أودع الحد الأدنى لرأس المال قبل التسجيل في السجل التجاري.' }[lang], docs: ['Bank Deposit Receipt'] },
    { id: 9, title: { en: 'Submit Registration to Trade Registry', tr: 'Ticaret Siciline Tescil Başvurusu', ar: 'تقديم التسجيل في السجل التجاري' }[lang], responsible: 'Human/Agent', status: 'pending', notes: { en: 'Submit to local Trade Registry with all notarized documents. Fee: ~500–1,500 TL.', tr: 'Yerel Ticaret Sicili\'ne tüm belgeleri teslim edin.', ar: 'قدّم في السجل التجاري المحلي مع جميع المستندات.' }[lang], docs: ['Notarized Articles', 'Lease', 'Deposit Receipt'] },
    { id: 10, title: { en: 'Open Corporate Bank Account', tr: 'Kurumsal Banka Hesabı Aç', ar: 'فتح حساب بنكي' }[lang], responsible: 'Human', status: 'pending', notes: { en: 'Open business account at any Turkish bank after Trade Registry approval.', tr: 'Ticaret Sicili onayından sonra herhangi bir Türk bankasında hesap açın.', ar: 'افتح حساباً في أي بنك تركي.' }[lang], docs: ['Trade Registry Certificate'] },
    { id: 11, title: { en: 'Register with Tax Office', tr: 'Vergi Dairesine Kayıt Ol', ar: 'التسجيل في مكتب الضرائب' }[lang], responsible: 'Human', status: 'pending', notes: { en: 'Register VAT and corporate tax; obtain tax plate for display.', tr: 'KDV ve kurumlar vergisi kaydı; vergi levhası alın.', ar: 'سجّل الضرائب واحصل على لوحة الضرائب.' }[lang], docs: ['Tax Plate'] },
    { id: 12, title: { en: 'Apply for İşyeri Açma ve Çalışma Ruhsatı', tr: 'İşyeri Açma ve Çalışma Ruhsatı Başvurusu', ar: 'التقدم بطلب رخصة التشغيل' }[lang], responsible: 'Agent', status: 'pending', notes: n('edevlet_permit', lang), docs: ['Lease', 'Tax Certificate', 'Floor Plan'] },
    { id: 13, title: { en: 'Register Employees with SGK & Hire Accountant', tr: 'SGK Kaydı ve Muhasebeci', ar: 'تسجيل الموظفين في SGK وتوظيف محاسب' }[lang], responsible: 'Human', status: 'pending', notes: { en: 'Certified accountant (SMMM) required. Register all employees with SGK before day one.', tr: 'Kanunla zorunlu SMMM. Çalışanları SGK\'ya kaydedin.', ar: 'محاسب معتمد مطلوب. سجّل الموظفين في SGK.' }[lang], docs: ['SGK Forms'] },
    { id: 14, title: { en: 'Launch Business Operations', tr: 'İşletmeyi Açın', ar: 'بدء العمليات التجارية' }[lang], responsible: 'Human', status: 'pending', notes: { en: 'Display İşyeri Ruhsatı and tax plate visibly; begin operations only after all permits received.', tr: 'Tüm izinler alındıktan sonra işletmeyi açın.', ar: 'ابدأ العمليات بعد الحصول على جميع التصاريح.' }[lang], docs: ['İşyeri Ruhsatı', 'Tax Plate'] },
  ];
}

function stepsStudent(lang: Lang): Step[] {
  return [
    { id: 1, title: { en: 'Obtain University Acceptance Letter', tr: 'Üniversite Kabul Mektubu Al', ar: 'الحصول على خطاب القبول الجامعي' }[lang], responsible: 'Human', status: 'pending', notes: { en: 'Get your official acceptance letter from the university\'s international admissions office.', tr: 'Üniversitenin uluslararası öğrenci ofisinden resmi kabul mektubu alın.', ar: 'احصل على خطاب القبول الرسمي من مكتب القبول الدولي.' }[lang], docs: ['Acceptance Letter'] },
    { id: 2, title: { en: 'Apply for Student Visa (Öğrenci Vizesi)', tr: 'Öğrenci Vizesi Başvurusu Yap', ar: 'التقدم بطلب تأشيرة طالب' }[lang], responsible: 'Human', status: 'pending', notes: { en: 'Apply at the Turkish Embassy/Consulate in your home country. Required: acceptance letter, passport, photos, bank statement, health insurance.', tr: 'Kendi ülkenizdeki Türk Büyükelçiliği/Konsolosluğuna başvurun.', ar: 'تقدّم في السفارة التركية في بلدك. مطلوب: خطاب القبول، جواز السفر، الصور، كشف حساب بنكي، تأمين صحي.' }[lang], docs: ['Acceptance Letter', 'Passport', '2 Biometric Photos', 'Bank Statement', 'Health Insurance'] },
    { id: 3, title: { en: 'Apostille & Translate High School Diploma', tr: 'Lise Diplomasını Apostille Yaptır ve Tercüme Et', ar: 'أبوستيل وترجمة شهادة الثانوية' }[lang], responsible: 'Human', status: 'pending', notes: { en: 'Get Apostille stamp on your diploma from your home country\'s Ministry of Foreign Affairs, then get a certified Turkish translation in Turkey.', tr: 'Diploma üzerine Apostille damgası alın; ardından Türkçe noter onaylı tercüme yaptırın.', ar: 'احصل على ختم الأبوستيل من وزارة خارجية بلدك، ثم احصل على ترجمة تركية معتمدة.' }[lang], docs: ['Apostilled Diploma', 'Certified Turkish Translation'] },
    { id: 4, title: { en: 'Apply for Denklik (Diploma Equivalency)', tr: 'Denklik Başvurusu Yap (MEB)', ar: 'التقدم بطلب الدنكلك (معادلة الشهادة)' }[lang], responsible: 'Human', status: 'pending', notes: { en: 'Apply at e-denklik.meb.gov.tr. Upload apostilled diploma and transcripts. Then visit the nearest Provincial Directorate of National Education (İl MEB Müdürlüğü).', tr: 'e-denklik.meb.gov.tr\'den başvurun. Apostilli diploma ve transkriptleri yükleyin.', ar: 'قدّم طلبك على e-denklik.meb.gov.tr. ارفع الشهادة المؤبوستلة والكشف الدراسي.' }[lang], docs: ['Apostilled Diploma', 'Transcripts', 'Passport Copy', 'Turkish Translation'] },
    { id: 5, title: { en: 'Get Turkish Tax Number (Vergi Numarası)', tr: 'Türk Vergi Numarası Al', ar: 'الحصول على الرقم الضريبي التركي' }[lang], responsible: 'Human', status: 'pending', notes: { en: 'Visit any local tax office (Vergi Dairesi) with your passport. Free, takes ~30 minutes.', tr: 'Pasaportunuzla herhangi bir vergi dairesine gidin. Ücretsiz, ~30 dakika sürer.', ar: 'زر أي مكتب ضرائب محلي مع جواز سفرك. مجاني، يستغرق ~30 دقيقة.' }[lang], docs: ['Passport'] },
    { id: 6, title: { en: 'Complete University Registration', tr: 'Üniversite Kaydını Tamamla', ar: 'إتمام التسجيل الجامعي' }[lang], responsible: 'Human', status: 'pending', notes: { en: 'Submit all original documents to Student Affairs. Complete online pre-registration on YÖKSİS/university portal. Pay tuition.', tr: 'Öğrenci İşleri\'ne tüm orijinal belgeleri teslim edin. YÖKSİS\'te ön kayıt yapın. Öğrenim ücretini ödeyin.', ar: 'سلّم جميع المستندات الأصلية لشؤون الطلاب. أكمل التسجيل المسبق على YÖKSİS. ادفع الرسوم الدراسية.' }[lang], docs: ['Acceptance Letter', 'Denklik Certificate', 'Passport + Translation', '6 Biometric Photos', 'Tuition Receipt'] },
    { id: 7, title: { en: 'Buy Health Insurance for İkamet', tr: 'İkamet için Sağlık Sigortası Al', ar: 'شراء التأمين الصحي للإقامة' }[lang], responsible: 'Human', status: 'pending', notes: { en: 'Purchase a 1-year private health insurance policy. Recommended: e-ikametsigorta.com (~650 TL/year). You need this before applying for İkamet.', tr: 'e-ikametsigorta.com\'dan 1 yıllık sigorta alın (~650 TL/yıl). İkamet başvurusu için zorunludur.', ar: 'اشتر وثيقة تأمين صحي لمدة عام من e-ikametsigorta.com (~650 TL/سنة). مطلوبة للإقامة.' }[lang], docs: ['Health Insurance Policy (1 year)'] },
    { id: 8, title: { en: 'Apply for Student Residence Permit (İkamet)', tr: 'Öğrenci İkamet İzni Başvurusu Yap', ar: 'التقدم بطلب تصريح إقامة الطالب (إيكامت)' }[lang], responsible: 'Agent', status: 'pending', notes: { en: '🔒 Apply online at e-ikamet.goc.gov.tr within 30 days of arrival. The agent will fill the form, arrange the card fee payment, and book your appointment at Göç İdaresi.', tr: '🔒 Türkiye\'ye gelişten itibaren 30 gün içinde e-ikamet.goc.gov.tr\'den başvurun.', ar: '🔒 تقدّم عبر الإنترنت على e-ikamet.goc.gov.tr خلال 30 يوماً من الوصول.' }[lang], docs: ['Passport', 'Öğrenci Belgesi', 'Health Insurance', 'Rental Contract or Dorm Letter', 'Tax Number', '4 Biometric Photos', 'İkamet Fee Receipt'] },
    { id: 9, title: { en: 'Attend Göç İdaresi Appointment', tr: 'Göç İdaresi Randevusuna Git', ar: 'حضور موعد إدارة الهجرة' }[lang], responsible: 'Human', status: 'pending', notes: { en: 'Attend your appointment at the Provincial Migration Office (İl Göç İdaresi) with all original documents. Your İkamet card will be mailed to your Turkish address.', tr: 'İl Göç İdaresi\'ndeki randevunuza tüm orijinal belgelerle gidin. Kimlik kartı adresinize gönderilecek.', ar: 'احضر موعدك في مديرية الهجرة الإقليمية مع جميع المستندات الأصلية.' }[lang], docs: ['All Original Documents'] },
    { id: 10, title: { en: 'Apply for Student İstanbulkart (Transport Card)', tr: 'Öğrenci İstanbulkart Başvurusu Yap', ar: 'التقدم بطلب بطاقة المواصلات الطلابية' }[lang], responsible: 'Human', status: 'pending', notes: { en: 'After YÖKSİS registration, apply via the İstanbulkart app or visit a main application center. Brings: student certificate, passport, 1 photo.', tr: 'YÖKSİS kaydından sonra İstanbulkart uygulaması veya merkezi bir başvuru noktasından başvurun.', ar: 'بعد تسجيل YÖKSİS، تقدّم عبر تطبيق İstanbulkart.' }[lang], docs: ['Öğrenci Belgesi', 'Passport/İkamet', '1 Passport Photo'] },
  ];
}

function stepsLawyerCompany(lang: Lang): Step[] {
  return [
    { id: 1, title: { en: 'Reserve Company Name on MERSİS', tr: 'MERSİS\'te Şirket Unvanı Rezerve Et', ar: 'حجز اسم الشركة على MERSİS' }[lang], responsible: 'Agent', status: 'pending', notes: n('mersis_name', lang), docs: ['e-Devlet Login'] },
    { id: 2, title: { en: 'Select Company Type & NACE Code', tr: 'Şirket Türü ve NACE Kodu Seç', ar: 'اختيار نوع الشركة وكود NACE' }[lang], responsible: 'Human/Agent', status: 'pending', notes: { en: 'LLC (Ltd. Şti.) is standard for foreigners. Min capital 10,000 TL. Select NACE activity code on MERSİS.', tr: 'LLC (Ltd. Şti.) yabancılar için standarttır. Asgari sermaye 10.000 TL.', ar: 'LLC (Ltd. Şti.) هي الخيار القياسي للأجانب. رأس المال الأدنى 10,000 TL.' }[lang], docs: [] },
    { id: 3, title: { en: 'Generate Articles of Association', tr: 'Ana Sözleşmeyi Oluştur', ar: 'إنشاء النظام الأساسي للشركة' }[lang], responsible: 'Agent', status: 'pending', notes: n('mersis_articles', lang), docs: ['MERSİS PDF Articles'] },
    { id: 4, title: { en: 'Prepare Shareholder Documents', tr: 'Hissedar Belgelerini Hazırla', ar: 'إعداد وثائق المساهمين' }[lang], responsible: 'Human', status: 'pending', notes: { en: 'All shareholders need: notarized passport translations, Signature Circular (İmza Sirküleri), and photos.', tr: 'Tüm hissedarlar: noter onaylı pasaport tercümesi, İmza Sirküleri ve fotoğraf gerektirir.', ar: 'جميع المساهمين يحتاجون: ترجمة جواز السفر الموثّقة، توقيع دائري (İmza Sirküleri)، وصور.' }[lang], docs: ['Notarized Passport Translations', 'Signature Circulars', 'Photos'] },
    { id: 5, title: { en: 'Notarize Articles at Turkish Notary', tr: 'Türk Noterinde Sözleşmeyi Onaylat', ar: 'توثيق العقد لدى كاتب العدل التركي' }[lang], responsible: 'Human', status: 'pending', notes: { en: 'All founders must appear in person at a Turkish notary. Bring: printed Articles, IDs/passports, translations.', tr: 'Tüm kurucuların Türk noterinde bizzat bulunması gerekir.', ar: 'يجب أن يحضر جميع المؤسسين شخصياً لدى كاتب العدل التركي.' }[lang], docs: ['Printed Articles (3 copies)', 'All Shareholder IDs'] },
    { id: 6, title: { en: 'Submit to Trade Registry (Ticaret Sicili)', tr: 'Ticaret Siciline Tescil Başvurusu', ar: 'التسجيل في السجل التجاري' }[lang], responsible: 'Human/Agent', status: 'pending', notes: { en: 'Submit all notarized documents + registration fee (~500–1,500 TL) to the local Trade Registry Office. Agent assists with document review.', tr: 'Yerel Ticaret Sicili Müdürlüğü\'ne tüm noterde onaylı belgeler + ücret (~500–1.500 TL).', ar: 'قدّم جميع المستندات الموثّقة + رسوم التسجيل (~500–1,500 TL) للسجل التجاري.' }[lang], docs: ['Notarized Articles', 'Shareholder List', 'Lease', 'ID Copies'] },
    { id: 7, title: { en: 'Open Corporate Bank Account', tr: 'Kurumsal Banka Hesabı Aç', ar: 'فتح حساب بنكي للشركة' }[lang], responsible: 'Human', status: 'pending', notes: { en: 'Open at any major Turkish bank. Bring: Trade Registry certificate, Articles, IDs. Deposit minimum share capital (10,000 TL).', tr: 'Herhangi bir büyük Türk bankasında açın. Asgari sermayeyi (10.000 TL) yatırın.', ar: 'افتح في أي بنك تركي رئيسي. أودع الحد الأدنى لرأس المال (10,000 TL).' }[lang], docs: ['Trade Registry Certificate', 'Articles', 'IDs'] },
    { id: 8, title: { en: 'Tax Office Registration (Vergi Dairesi)', tr: 'Vergi Dairesi Kaydı', ar: 'التسجيل في مكتب الضرائب' }[lang], responsible: 'Human', status: 'pending', notes: { en: 'Register with local Vergi Dairesi for corporate income tax, VAT, and withholding tax. Receive official tax plate.', tr: 'Yerel Vergi Dairesi\'nde kurumlar vergisi, KDV ve stopaj kaydı yapın.', ar: 'سجّل في مكتب الضرائب المحلي لضريبة الدخل والقيمة المضافة.' }[lang], docs: ['Trade Registry Certificate', 'Bank Account Confirmation'] },
    { id: 9, title: { en: 'SGK Employer Registration', tr: 'SGK İşveren Kaydı', ar: 'تسجيل صاحب العمل في SGK' }[lang], responsible: 'Human', status: 'pending', notes: { en: 'Register as employer with SGK (Social Security). Required before hiring first employee.', tr: 'SGK\'ya işveren olarak kayıt olun. İlk işçiyi işe almadan önce zorunludur.', ar: 'سجّل كصاحب عمل في SGK قبل توظيف أول موظف.' }[lang], docs: ['Tax Registration', 'Trade Registry Certificate'] },
    { id: 10, title: { en: 'Appoint Certified Accountant (SMMM)', tr: 'Serbest Muhasebeci Mali Müşavir (SMMM) Tut', ar: 'تعيين محاسب معتمد (SMMM)' }[lang], responsible: 'Human', status: 'pending', notes: { en: 'Turkish law requires all companies to have a certified accountant (SMMM). They handle monthly tax filings and payroll.', tr: 'Türk hukuku tüm şirketlerin SMMM muhasebeci tutmasını zorunlu kılar.', ar: 'يشترط القانون التركي أن تمتلك جميع الشركات محاسباً معتمداً (SMMM).' }[lang], docs: ['SMMM Service Agreement'] },
  ];
}

// ---------------------------------------------------------------------------
// Master workflow builder
// ---------------------------------------------------------------------------
export function buildWorkflow(
  query: string,
  assistantType: string,
  language: string,
  location: string,
): WorkflowResult | null {
  const lang = (['en', 'tr', 'ar'].includes(language) ? language : 'en') as Lang;
  const type = detectType(query + ' ' + assistantType);

  let steps: Step[] = [];
  let permits: string[] = [];
  let agencies: string[] = [];
  let documents: string[] = [];
  let timelineDays = 30;
  let summary = '';
  let businessType = query;

  if (type === 'food') {
    steps = stepsFood(lang);
    permits = ['İşyeri Açma ve Çalışma Ruhsatı', 'Gıda Sicil Belgesi', 'İtfaiye Uygunluk Raporu'];
    agencies = ['Vergi Dairesi', 'Trade Registry (Ticaret Sicili)', 'District Municipality (Belediye)', 'Ministry of Agriculture (Tarım)', 'Fire Department (İtfaiye)'];
    documents = ['Passport + Notarized Translation', 'Signed Lease Agreement', 'Tax Number Certificate', 'NACE Registration', 'Floor Plan', 'Health Insurance'];
    timelineDays = 45;
    summary = `Opening a food business in ${location} requires ~45 days. The main steps are company formation, municipal permit application, food registration, and fire safety inspection.`;
    businessType = 'Cafe & Restaurant';
  } else if (type === 'retail') {
    steps = stepsRetail(lang);
    permits = ['İşyeri Açma ve Çalışma Ruhsatı'];
    agencies = ['Vergi Dairesi', 'Trade Registry (Ticaret Sicili)', 'District Municipality (Belediye)'];
    documents = ['Passport + Translation', 'Signed Lease', 'Tax Certificate', 'NACE Code', 'Floor Plan'];
    timelineDays = 20;
    summary = `Opening a retail shop in ${location} takes ~20 days. Key steps: company registration, operating license, and tax registration.`;
    businessType = 'Retail Shop';
  } else if (type === 'service') {
    steps = stepsService(lang);
    permits = ['İşyeri Açma ve Çalışma Ruhsatı'];
    agencies = ['Vergi Dairesi', 'Trade Registry (Ticaret Sicili)', 'District Municipality (Belediye)'];
    documents = ['Passport + Translation', 'Office Lease or Virtual Office Agreement', 'Tax Certificate', 'Share Capital Deposit Receipt'];
    timelineDays = 15;
    summary = `Setting up a service/office business in ${location} takes ~15 days. Key steps: company formation via MERSİS, Trade Registry, and operating permit.`;
    businessType = 'Office & Tech';
  } else if (type === 'student' || assistantType === 'student') {
    steps = stepsStudent(lang);
    permits = ['Student Visa (Öğrenci Vizesi)', 'Student Residence Permit (İkamet)', 'Denklik Certificate'];
    agencies = ['Turkish Embassy/Consulate', 'Ministry of Education (MEB)', 'University Student Affairs', 'Migration Office (Göç İdaresi)', 'Tax Office (Vergi Dairesi)'];
    documents = ['Acceptance Letter', 'Apostilled Diploma', 'Denklik Certificate', 'Health Insurance', 'Passport', '4 Biometric Photos', 'Tax Number', 'Rental Contract'];
    timelineDays = 90;
    summary = `The student setup process in Turkey takes ~90 days. Key milestones: visa, diploma equivalency (Denklik), university registration, and İkamet (residence permit).`;
    businessType = 'Student Registration';
  } else if (type === 'lawyer_company' || assistantType === 'lawyer') {
    steps = stepsLawyerCompany(lang);
    permits = ['Trade Registry Certificate', 'Tax Registration', 'Operating License (if applicable)'];
    agencies = ['MERSİS Portal', 'Turkish Notary', 'Trade Registry Office', 'Tax Office', 'SGK'];
    documents = ['Shareholders\' Passports (notarized translations)', 'Signature Circulars', 'Articles of Association', 'Share Capital Deposit Receipt'];
    timelineDays = 10;
    summary = `Company formation in Turkey takes ~10 business days once all documents are ready. The LLC (Ltd. Şti.) structure is recommended for most foreign entrepreneurs.`;
    businessType = 'Company Formation';
  } else {
    // Fallback to general service steps
    steps = stepsService(lang);
    timelineDays = 20;
    summary = `Business setup in ${location} typically takes 15–30 days depending on the type.`;
  }

  const phaseSteps = steps.slice(0, Math.ceil(steps.length / 3));

  return {
    assistant_type: assistantType,
    last_updated: new Date().toISOString(),
    execution_plan: {
      steps,
      assigned_agents: [`${assistantType.charAt(0).toUpperCase() + assistantType.slice(1)} Agent`, 'Permit Specialist'],
    },
    combined_result: {
      permits,
      agencies,
      documents,
      steps: [
        { title: { en: 'Company Setup', tr: 'Şirket Kuruluşu', ar: 'إنشاء الشركة' }[lang], description: { en: 'Register your legal entity and tax number.', tr: 'Yasal varlığınızı ve vergi numaranızı kaydedin.', ar: 'سجّل كيانك القانوني ورقمك الضريبي.' }[lang], documents: documents.slice(0, 2) },
        { title: { en: 'Permit Application', tr: 'Ruhsat Başvurusu', ar: 'طلب التصريح' }[lang], description: { en: 'Apply for operating licenses at the district municipality.', tr: 'İlçe belediyesinde işyeri ruhsatı için başvurun.', ar: 'تقدّم بطلب تراخيص التشغيل في البلدية.' }[lang], documents: documents.slice(2, 4) },
        { title: { en: 'Inspections & Final Permits', tr: 'Denetimler ve Son İzinler', ar: 'عمليات التفتيش والتصاريح النهائية' }[lang], description: { en: 'Pass required inspections and collect final permits.', tr: 'Gerekli denetimlerden geçin ve son izinleri alın.', ar: 'اجتز عمليات التفتيش المطلوبة.' }[lang], documents: permits },
      ],
      timeline_days: timelineDays,
      summary,
      location,
      business_type: businessType,
    },
  };
}
