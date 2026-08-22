/**
 * document-checklists.ts
 * Deterministic "what do I need to upload" catalogs per service, keyed by
 * agent. This is the free, immediate answer an agent gives when the user says
 * "I want university registration" / "student visa" / "İkamet" / "I want to
 * open a business" — before any credit or intake.
 *
 * The tool output is model-facing: the agent renders the items natively in the
 * user's language, so ar/tk/az/uz/kk/fa/ru quality comes from the model rather
 * than from maintaining six parallel dictionaries by hand. The base four
 * languages are kept here as the ground truth.
 */

import type { ApplicationKind } from './schema';
import { CHECKLIST_RU } from './document-checklists.ru';

export type Lang4 = 'en' | 'tr' | 'ar' | 'tk';

/** Languages the upload card can render document names in. */
export type CardLang = Lang4 | 'ru';

export type ChecklistItem = {
  /** Document name. */
  title: Record<Lang4, string>;
  /** Where it comes from / who issues it. */
  whereToGet: Record<Lang4, string>;
  /**
   * Which application stage first requires this document.
   *
   * University registration runs in two stages: stage 1 applies to the
   * university on nothing but a passport and school transcripts — no apostille,
   * no notary, no tuition — and stage 2 begins once the university replies with
   * a first acceptance. Stage 2 shows EVERYTHING, stage 1 only its own items,
   * so a student never pays to apostille a diploma for a place they have not
   * been offered.
   *
   * Undefined means the document is required from the start, which is how every
   * single-stage checklist behaves.
   */
  stage?: 1 | 2;
};

export type ServiceChecklist = {
  id: string;
  agent: 'student' | 'permit';
  /** Names the model matches against, lowercase. */
  aliases: string[];
  /**
   * Words that disambiguate this checklist from a sibling sharing the same
   * aliases — "renew my ikamet" and "apply for ikamet" both name İkamet, and
   * only the verb says which of the two lists is wanted.
   *
   * Only counted when an alias already matched, so "renew my insurance" does
   * not get pulled into the İkamet renewal list by the verb alone.
   */
  intentWords?: string[];
  items: ChecklistItem[];
};

const t = (en: string, tr: string, ar: string, tk: string): Record<Lang4, string> => ({ en, tr, ar, tk });

// ---------------------------------------------------------------------------
// Student services
// ---------------------------------------------------------------------------

export const STUDENT_CHECKLISTS: ServiceChecklist[] = [
  {
    id: 'university_registration',
    agent: 'student',
    aliases: ['university', 'uni', 'registration', 'register', 'enroll', 'kayıt', 'üniversite', 'جامعة', 'تسجيل', 'университет', 'поступл', 'вуз', 'دانشگاه', 'ثبت نام', 'universitet'],
    items: [
      {
        title: t('Acceptance letter', 'Kabul mektubu', 'خطاب القبول', 'Kabul haty'),
        whereToGet: t(
          'Issued by the university\'s international admissions office',
          'Üniversitenin uluslararası öğrenci ofisi tarafından verilir',
          'تصدره إدارة القبول الدولي في الجامعة',
          'Uniwersitetiň halkara kabul edarasy tarapyndan berilýär',
        ),
      },
      {
        title: t('Passport (valid 6+ months) + notarized Turkish translation', 'Pasaport (6+ ay geçerli) + noter onaylı Türkçe tercüme', 'جواز السفر (صلاحية 6+ أشهر) + ترجمة تركية موثقة', 'Pasport (6+ aý möhletli) + notarial tassyklanan türk terjimesi'),
        whereToGet: t(
          'Passport from your country; translation from a Turkish notary',
          'Pasaport ülkenizden; tercüme Türk noterinden',
          'جواز السفر من بلدك؛ الترجمة من كاتب عدل تركي',
          'Pasport öz ýurduňyzdan; terjime türk notariusyndan',
        ),
      },
      {
        title: t('Apostilled high school diploma + certified translation', 'Apostil onaylı lise diploması + onaylı tercüme', 'شهادة الثانوية المؤبوستلة + ترجمة معتمدة', 'Apostil edilen orta mekdep diplomy + tassyklanan terjime'),
        whereToGet: t(
          'Apostille from your country\'s Ministry of Foreign Affairs',
          'Apostil, ülkenizin Dışişleri Bakanlığı\'ndan',
          'الأبوستيل من وزارة خارجية بلدك',
          'Apostil, öz ýurduňyzyň Daşary İşler Ministrliginden',
        ),
      },
      {
        title: t('Denklik (diploma equivalency) certificate', 'Denklik belgesi', 'شهادة المعادلة (Denklik)', 'Denklik (deňleşdirme) şahadatnamasy'),
        whereToGet: t(
          'Apply at e-denklik.meb.gov.tr, then visit the provincial MEB directorate',
          'e-denklik.meb.gov.tr\'den başvurun, sonra İl MEB Müdürlüğü\'ne gidin',
          'قدّم عبر e-denklik.meb.gov.tr ثم راجع مديرية التعليم الإقليمية',
          'e-denklik.meb.gov.tr saýtyndan arza beriň, soňra welaýat MEB müdirligine baryň',
        ),
      },
      {
        title: t('Tax number (Vergi Kimlik Numarası)', 'Vergi Kimlik Numarası', 'الرقم الضريبي', 'Salgyt belgisi (Vergi Kimlik Numarası)'),
        whereToGet: t(
          'Free at any Turkish tax office (Vergi Dairesi) with your passport',
          'Pasaportunuzla herhangi bir Vergi Dairesi\'nden ücretsiz',
          'مجاناً من أي مكتب ضرائب تركي بجواز سفرك',
          'Pasport bilen islendik Vergi Dairesinden mugt',
        ),
      },
      {
        title: t('6 biometric photos', '6 biyometrik fotoğraf', '6 صور بيومترية', '6 san biometrik surat'),
        whereToGet: t('Any photo studio in Türkiye', 'Türkiye\'deki herhangi bir fotoğraf stüdyosu', 'أي استوديو تصوير في تركيا', 'Türkiýedäki islendik surat studiýasy'),
      },
      {
        title: t('1-year health insurance policy', '1 yıllık sağlık sigortası poliçesi', 'وثيقة تأمين صحي لمدة عام', '1 ýyllyk saglyk ätiýaçlandyryş polisi'),
        whereToGet: t(
          'Private insurers, e.g. e-ikametsigorta.com (~650 TL/year)',
          'Özel sigortacılar, örn. e-ikametsigorta.com (~650 TL/yıl)',
          'شركات التأمين الخاصة مثل e-ikametsigorta.com (~650 TL/سنة)',
          'Hususy ätiýaçlandyryjylar, meselem e-ikametsigorta.com (~650 TL/ýyl)',
        ),
      },
      {
        title: t('Tuition fee receipt', 'Öğrenim ücreti makbuzu', 'إيصال الرسوم الدراسية', 'Okuw töleginiň kwitansiýasy'),
        whereToGet: t(
          'Issued by the university after paying tuition',
          'Öğrenim ücreti ödendikten sonra üniversiteden alınır',
          'تصدره الجامعة بعد دفع الرسوم',
          'Okuw tölegi tölenenden soň uniwersitet tarapyndan berilýär',
        ),
      },
    ],
  },
  {
    id: 'student_visa',
    agent: 'student',
    aliases: ['visa', 'student visa', 'vize', 'öğrenci vizesi', 'تأشيرة', 'wiza', 'виза', 'визу', 'ویزا', 'viza'],
    items: [
      {
        title: t('Acceptance/invitation letter', 'Kabul/davet mektubu', 'خطاب القبول/الدعوة', 'Kabul/çakylyk haty'),
        whereToGet: t('From the Turkish university you are admitted to', 'Kayıt olduğunuz Türk üniversitesinden', 'من الجامعة التركية المقبول فيها', 'Kabul edilen türk uniwersitetinden'),
      },
      {
        title: t('Passport (valid 6+ months)', 'Pasaport (6+ ay geçerli)', 'جواز السفر (صلاحية 6+ أشهر)', 'Pasport (6+ aý möhletli)'),
        whereToGet: t('Your country\'s passport authority', 'Ülkenizin pasaport kurumu', 'جهة إصدار جوازات السفر في بلدك', 'Öz ýurduňyzyň pasport edarasy'),
      },
      {
        title: t('2 biometric photos', '2 biyometrik fotoğraf', 'صورتان بيومتريتان', '2 san biometrik surat'),
        whereToGet: t('Photo studio (visa-size)', 'Fotoğraf stüdyosu (vize boyutu)', 'استوديو تصوير (بحجم التأشيرة)', 'Surat studiýasy (wiza ölçegi)'),
      },
      {
        title: t('Bank statement (min ~500 USD/month)', 'Banka hesap dökümü (en az ~500 USD/ay)', 'كشف حساب بنكي (500 دولار/شهر على الأقل)', 'Bank hasabaty (iň az ~500 USD/aý)'),
        whereToGet: t('From your bank, recent 3 months', 'Bankanızdan, son 3 aylık', 'من مصرفك، لآخر 3 أشهر', 'Bankyňyzdan, soňky 3 aýlyk'),
      },
      {
        title: t('Health insurance', 'Sağlık sigortası', 'التأمين الصحي', 'Saglyk ätiýaçlandyrmasy'),
        whereToGet: t('Private insurance covering the study period', 'Eğitim süresini kapsayan özel sigorta', 'تأمين خاص يغطي فترة الدراسة', 'Okuw möhletini gurşap alýan hususy ätiýaçlandyrma'),
      },
      {
        title: t('Visa application form + fee receipt', 'Vize başvuru formu + ücret makbuzu', 'نموذج طلب التأشيرة + إيصال الرسوم', 'Wiza arza formasy + töleg kwitansiýasy'),
        whereToGet: t('From the Turkish consulate / visa center (the agent fills it for you)', 'Türk konsolosluğundan / vize merkezinden (ajan sizin için doldurur)', 'من القنصلية التركية / مركز التأشيرات', 'Türk konsullygyndan / wiza merkezinden'),
      },
    ],
  },
  {
    id: 'ikamet_new',
    agent: 'student',
    aliases: ['ikamet', 'residence', 'residence permit', 'ikamet new', 'oturma izni', 'إقامة', 'ýaşaýyş', 'икамет', 'вид на жительство', 'внж', 'اقامت', 'ikamet başvuru'],
    items: [
      {
        title: t('İkamet application form (from e-ikamet)', 'İkamet başvuru formu (e-ikamet\'ten)', 'نموذج طلب الإقامة (من e-ikamet)', 'İkamet arza formasy (e-ikametden)'),
        whereToGet: t(
          'Generated by e-ikamet.goc.gov.tr after applying — the agent fills it with you',
          'Başvurudan sonra e-ikamet.goc.gov.tr üretir — ajan sizinle doldurur',
          'يُنشئه e-ikamet.goc.gov.tr بعد التقديم',
          'Arzadan soň e-ikamet.goc.gov.tr döredýär — agent siziň bilen doldurýar',
        ),
      },
      {
        title: t('Passport + copy', 'Pasaport + fotokopi', 'جواز السفر + نسخة', 'Pasport + nusgasy'),
        whereToGet: t('Original plus photocopies of the ID pages', 'Aslı ve kimlik sayfalarının fotokopileri', 'الأصل ونسخ من صفحات البيانات', 'Asly we şahsyýet sahypalarynyň nusgalary'),
      },
      {
        title: t('4 biometric photos', '4 biyometrik fotoğraf', '4 صور بيومترية', '4 san biometrik surat'),
        whereToGet: t('Photo studio, white background', 'Fotoğraf stüdyosu, beyaz arka plan', 'استوديو تصوير، خلفية بيضاء', 'Surat studiýasy, ak fon'),
      },
      {
        title: t('Student certificate (Öğrenci Belgesi)', 'Öğrenci Belgesi', 'شهادة الطالب (Öğrenci Belgesi)', 'Talyp şahadatnamasy (Öğrenci Belgesi)'),
        whereToGet: t('From your university\'s student affairs or e-Devlet', 'Üniversitenin öğrenci işlerinden veya e-Devlet\'ten', 'من شؤون الطلاب بالجامعة أو e-Devlet', 'Uniwersitetiň talyp işlerinden ýa-da e-Devletden'),
      },
      {
        title: t('Health insurance (1 year)', 'Sağlık sigortası (1 yıl)', 'التأمين الصحي (سنة واحدة)', 'Saglyk ätiýaçlandyrmasy (1 ýyl)'),
        whereToGet: t('Private insurer, ~650 TL/year', 'Özel sigortacı, ~650 TL/yıl', 'شركة تأمين خاصة، ~650 TL/سنة', 'Hususy ätiýaçlandyryjy, ~650 TL/ýyl'),
      },
      {
        title: t('Address proof: rental contract or dormitory letter', 'Adres kanıtı: kira sözleşmesi veya yurt belgesi', 'إثبات العنوان: عقد الإيجار أو خطاب السكن', 'Salgy subutnamasy: kärende şertnamasy ýa-da umumyýaşaýyş haty'),
        whereToGet: t('Notarized rental contract or dormitory administration letter', 'Noter onaylı kira sözleşmesi veya yurt idaresi yazısı', 'عقد إيجار موثق أو خطاب إدارة السكن', 'Notarial tassyklanan kärende şertnamasy ýa-da umumyýaşaýyş edarasy haty'),
      },
      {
        title: t('Tax number + card fee receipt', 'Vergi numarası + harç makbuzu', 'الرقم الضريبي + إيصال رسوم البطاقة', 'Salgyt belgisi + karta tölegi kwitansiýasy'),
        whereToGet: t('Tax office; fee paid online or at PTT', 'Vergi dairesi; harç online veya PTT\'den ödenir', 'مكتب الضرائب؛ الرسوم عبر الإنترنت أو PTT', 'Salgyt edarasy; töleg onlaýn ýa-da PTT-den'),
      },
    ],
  },
  {
    id: 'ikamet_renewal',
    agent: 'student',
    aliases: ['ikamet renewal', 'ikamet extend', 'uzatma', 'renew residence', 'تجديد الإقامة', 'uzaltma', 'ikamet', 'residence permit', 'икамет', 'вид на жительство', 'اقامت'],
    intentWords: ['renew', 'renewal', 'extend', 'extension', 'uzat', 'yenile', 'تجديد', 'täzele', 'продл', 'تمديد', 'تمدید'],
    items: [
      {
        title: t('Current İkamet card (number + expiry)', 'Mevcut İkamet kartı (numara + bitiş tarihi)', 'بطاقة الإقامة الحالية (الرقم + الانتهاء)', 'Häzirki İkamet kartasy (nomer + gutarýan senesi)'),
        whereToGet: t('The card you already hold', 'Elinizdeki mevcut kart', 'البطاقة التي تحملها حالياً', 'Eliňizdäki häzirki karta'),
      },
      {
        title: t('Updated student certificate', 'Güncel Öğrenci Belgesi', 'شهادة طالب محدثة', 'Täze Talyp şahadatnamasy'),
        whereToGet: t('University student affairs for the current term', 'Üniversite öğrenci işlerinden, güncel dönem', 'من شؤون الطلاب للفصل الحالي', 'Uniwersitet talyp işlerinden, häzirki möwsüm'),
      },
      {
        title: t('Valid health insurance', 'Geçerli sağlık sigortası', 'تأمين صحي ساري', 'Möhletli saglyk ätiýaçlandyrmasy'),
        whereToGet: t('Renewed policy covering the new permit period', 'Yeni izin dönemini kapsayan yenilenmiş poliçe', 'وثيقة مجددة تغطي فترة الإقامة الجديدة', 'Täze rugsat möhletini gurşap alýan polis'),
      },
      {
        title: t('Address proof (if address changed)', 'Adres kanıtı (adres değiştiyse)', 'إثبات العنوان (إذا تغير العنوان)', 'Salgy subutnamasy (salgy üýtgän bolsa)'),
        whereToGet: t('New rental contract or dormitory letter', 'Yeni kira sözleşmesi veya yurt belgesi', 'عقد إيجار جديد أو خطاب سكن', 'Täze kärende şertnamasy ýa-da umumyýaşaýyş haty'),
      },
      {
        title: t('Renewal application form (e-ikamet Uzatma)', 'Uzatma başvuru formu (e-ikamet Uzatma)', 'نموذج طلب التجديد (e-ikamet Uzatma)', 'Uzaltma arza formasy (e-ikamet Uzatma)'),
        whereToGet: t('Generated by e-ikamet.goc.gov.tr — apply before expiry, ideally 60 days ahead', 'e-ikamet.goc.gov.tr üretir — bitişten önce, ideal olarak 60 gün önceden başvurun', 'يُنشئه e-ikamet.goc.gov.tr — قدّم قبل الانتهاء، ويفضل قبل 60 يوماً', 'e-ikamet.goc.gov.tr döredýär — gutarmanka, ideal ýagdaýda 60 gün öň arza beriň'),
      },
      {
        title: t('4 biometric photos + card fee receipt', '4 biyometrik fotoğraf + harç makbuzu', '4 صور بيومترية + إيصال رسوم البطاقة', '4 san biometrik surat + karta tölegi kwitansiýasy'),
        whereToGet: t('Photo studio; fee online or PTT', 'Fotoğraf stüdyosu; harç online veya PTT', 'استوديو تصوير؛ الرسوم عبر الإنترنت أو PTT', 'Surat studiýasy; töleg onlaýn ýa-da PTT'),
      },
    ],
  },
  {
    id: 'health_insurance',
    agent: 'student',
    aliases: ['insurance', 'health insurance', 'sgk', 'sigorta', 'sağlık sigortası', 'تأمين صحي', 'ätiýaçlandyrma', 'страхов', 'медицинская страховка', 'بیمه', 'بيمه'],
    items: [
      {
        title: t('Passport + copy', 'Pasaport + fotokopi', 'جواز السفر + نسخة', 'Pasport + nusgasy'),
        whereToGet: t('Your passport', 'Pasaportunuz', 'جواز سفرك', 'Pasortyňyz'),
      },
      {
        title: t('Student certificate / enrollment proof', 'Öğrenci Belgesi / kayıt kanıtı', 'شهادة الطالب / إثبات التسجيل', 'Talyp şahadatnamasy / bellige alyş subutnamasy'),
        whereToGet: t('University student affairs or e-Devlet', 'Üniversite öğrenci işleri veya e-Devlet', 'شؤون الطلاب أو e-Devlet', 'Uniwersitet talyp işleri ýa-da e-Devlet'),
      },
      {
        title: t('Enrollment (kayıt) date', 'Kayıt tarihi', 'تاريخ التسجيل', 'Bellige alyş senesi'),
        whereToGet: t('Shown on your university registration', 'Üniversite kaydınızda yazılıdır', 'موجود في تسجيلك الجامعي', 'Uniwersitet bellige alşyňyzda görkezilýär'),
      },
      {
        title: t('Address in Türkiye', 'Türkiye\'deki adresiniz', 'عنوانك في تركيا', 'Türkiýedäki salgyňyz'),
        whereToGet: t('Rental contract or dormitory address', 'Kira sözleşmesi veya yurt adresi', 'عقد الإيجار أو عنوان السكن', 'Kärende şertnamasy ýa-da umumyýaşaýyş salgysy'),
      },
      {
        title: t('Premium payment (1 year)', 'Prim ödemesi (1 yıl)', 'دفع القسط (سنة واحدة)', 'Premiýa tölegi (1 ýyl)'),
        whereToGet: t('Paid to the insurer at application', 'Başvuruda sigortacıya ödenir', 'يُدفع لشركة التأمين عند التقديم', 'Arzada ätiýaçlandyryja tölenýär'),
      },
    ],
  },
  {
    id: 'denklik',
    agent: 'student',
    aliases: ['denklik', 'equivalency', 'diploma equivalency', 'denk', 'معادلة', 'deňleşdirme', 'денклик', 'признание диплома', 'ارزشیابی مدرك', 'معادل'],
    items: [
      {
        title: t('Apostilled diploma', 'Apostil onaylı diploma', 'الشهادة المؤبوستلة', 'Apostil edilen diplom'),
        whereToGet: t('Apostille from your country\'s foreign ministry', 'Ülkenizin Dışişleri Bakanlığı\'ndan apostil', 'الأبوستيل من وزارة الخارجية في بلدك', 'Öz ýurduňyzyň Daşary İşler ministrliginden apostil'),
      },
      {
        title: t('Apostilled transcripts', 'Apostil onaylı transkriptler', 'كشوف الدرجات المؤبوستلة', 'Apostil edilen transkriptler'),
        whereToGet: t('From your previous school, then apostilled', 'Önceki okulunuzdan, sonra apostil onaylı', 'من مدرستك السابقة ثم مؤبوستلة', 'Öňki mekdebiňizden, soň apostil edilen'),
      },
      {
        title: t('Certified Turkish translations', 'Noter onaylı Türkçe tercümeler', 'ترجمات تركية موثقة', 'Notarial tassyklanan türk terjimeleri'),
        whereToGet: t('From a Turkish notary (yeminli tercüman)', 'Türk noterinden (yeminli tercüman)', 'من كاتب عدل تركي (مترجم محلف)', 'Türk notariusyndan (yeminli tercüman)'),
      },
      {
        title: t('Passport copy', 'Pasaport fotokopisi', 'نسخة من جواز السفر', 'Pasport nusgasy'),
        whereToGet: t('ID pages of your passport', 'Pasaportunuzun kimlik sayfaları', 'صفحات البيانات من جواز سفرك', 'Pasortyňyzyň şahsyýet sahypalary'),
      },
      {
        title: t('e-denklik application + originals for the MEB visit', 'e-denklik başvurusu + MEB ziyareti için asıllar', 'طلب e-denklik + الأصول لزيارة MEB', 'e-denklik arzasy + MEB sapary üçin asyllar'),
        whereToGet: t('Upload at e-denklik.meb.gov.tr, then bring originals to İl MEB Müdürlüğü', 'e-denklik.meb.gov.tr\'ye yükleyin, asıllarla İl MEB Müdürlüğü\'ne gidin', 'ارفعه على e-denklik.meb.gov.tr ثم أحضر الأصول إلى مديرية التعليم', 'e-denklik.meb.gov.tr-e ýükläň, asyllar bilen welaýat MEB müdirligine baryň'),
      },
    ],
  },
  {
    id: 'dormitory',
    agent: 'student',
    aliases: ['dorm', 'dormitory', 'kyk', 'housing', 'yurt', 'سكن', 'umumyýaşaýyş', 'общежит', 'خوابگاه', 'yatakhane'],
    items: [
      {
        title: t('Student certificate (Öğrenci Belgesi)', 'Öğrenci Belgesi', 'شهادة الطالب', 'Talyp şahadatnamasy'),
        whereToGet: t('University student affairs / e-Devlet', 'Üniversite öğrenci işleri / e-Devlet', 'شؤون الطلاب / e-Devlet', 'Uniwersitet talyp işleri / e-Devlet'),
      },
      {
        title: t('Passport / İkamet', 'Pasaport / İkamet', 'جواز السفر / الإقامة', 'Pasport / İkamet'),
        whereToGet: t('Your ID documents', 'Kimlik belgeleriniz', 'وثائق هويتك', 'Şahsyýet resminamalaryňyz'),
      },
      {
        title: t('KYK application (e-Devlet, during the window)', 'KYK başvurusu (e-Devlet, başvuru döneminde)', 'طلب KYK (e-Devlet، خلال فترة التقديم)', 'KYK arzasy (e-Devlet, arza möhletinde)'),
        whereToGet: t('Apply on e-Devlet when the KYK window opens', 'KYK dönemi açıldığında e-Devlet\'ten başvurun', 'قدّم عبر e-Devlet عند فتح فترة KYK', 'KYK möhleti açylanda e-Devletden arza beriň'),
      },
      {
        title: t('Deposit (private dormitories)', 'Depozito (özel yurtlar)', 'التأمين المالي (السكنات الخاصة)', 'Zalog (hususy umumyýaşaýyşlar)'),
        whereToGet: t('Paid to the private dormitory at contract', 'Sözleşmede özel yurda ödenir', 'يُدفع للسكن الخاص عند العقد', 'Şertnamada hususy umumyýaşaýşa tölenýär'),
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Business services
// ---------------------------------------------------------------------------

export const PERMIT_CHECKLISTS: ServiceChecklist[] = [
  {
    id: 'restaurant_cafe',
    agent: 'permit',
    aliases: ['restaurant', 'cafe', 'coffee', 'food', 'bakery', 'kebab', 'lokanta', 'restoran', 'kafe', 'مطعم', 'مقهى'],
    items: [
      {
        title: t('Signed lease agreement', 'İmzalı kira sözleşmesi', 'عقد إيجار موقّع', 'Gol çekilen kärende şertnamasy'),
        whereToGet: t('From the property owner, notarized where required', 'Mülk sahibinden, gerektiğinde noter onaylı', 'من المالك، موثق عند الحاجة', 'Emläk eýesinden, gerek bolsa notarial tassyklanan'),
      },
      {
        title: t('Tax registration certificate (vergi levhası)', 'Vergi levhası', 'شهادة التسجيل الضريبي', 'Salgyt bellige alyş şahadatnamasy'),
        whereToGet: t('From the tax office after company registration', 'Şirket tescilinden sonra vergi dairesinden', 'من مكتب الضرائب بعد تسجيل الشركة', 'Kompaniýa bellige alynandan soň salgyt edarasyndan'),
      },
      {
        title: t('Floor plan (mimari proje)', 'Kat planı (mimari proje)', 'المخطط المعماري', 'Gat meýilnamasy (arhitektura taslamasy)'),
        whereToGet: t('From the building owner or a licensed architect', 'Bina sahibinden veya yetkili mimardan', 'من مالك المبنى أو مهندس مرخص', 'Bina eýesinden ýa-da ygtyýarly arhitektordan'),
      },
      {
        title: t('Fire safety report (İtfaiye Uygunluk)', 'İtfaiye Uygunluk Raporu', 'تقرير السلامة من الحريق', 'Ýangyn howpsuzlyk hasabaty'),
        whereToGet: t('Fire department inspection, booked via the district municipality', 'İtfaiye denetimi, ilçe belediyesi üzerinden randevu', 'تفتيش الإطفاء، يُحجز عبر البلدية', 'Ýangyn gullugy barlagy, etrap häkimiýeti arkaly belläň'),
      },
      {
        title: t('Chimney conformity (Baca Uygunluğu)', 'Baca Uygunluğu Belgesi', 'شهادة مطابقة المدخنة', 'Baca laýyklyk şahadatnamasy'),
        whereToGet: t('From the municipality / licensed chimney firm', 'Belediye / yetkili baca firmasından', 'من البلدية / شركة مداخن مرخصة', 'Häkimiýet / ygtyýarly baca firmasyndan'),
      },
      {
        title: t('Food registration (Gıda Sicil Belgesi)', 'Gıda Sicil Belgesi', 'شهادة السجل الغذائي', 'Azyk bellige alyş şahadatnamasy'),
        whereToGet: t('Register at tarim.gov.tr (Ministry of Agriculture)', 'tarim.gov.tr üzerinden (Tarım Bakanlığı)', 'سجّل عبر tarim.gov.tr', 'tarim.gov.tr arkaly bellige alyň'),
      },
      {
        title: t('TAPDK alcohol license (if serving alcohol)', 'TAPDK alkol ruhsatı (alkol sunulacaksa)', 'ترخيص TAPDK للكحول (إن وُجد)', 'TAPDK alkogol rugsady (alkogol berilse)'),
        whereToGet: t('TAPDK, federal — venue must be 100m+ from schools/mosques', 'TAPDK — işyeri okul/camiye 100m\'den uzak olmalı', 'TAPDK — يجب أن يبعد المحل 100م عن المدارس/المساجد', 'TAPDK — iş ýeri mekdep/metjitden 100m uzak bolmaly'),
      },
    ],
  },
  {
    id: 'retail_shop',
    agent: 'permit',
    aliases: ['retail', 'shop', 'store', 'market', 'boutique', 'clothing', 'dükkan', 'mağaza', 'perakende', 'متجر', 'بوتيك'],
    items: [
      {
        title: t('Signed lease agreement', 'İmzalı kira sözleşmesi', 'عقد إيجار موقّع', 'Gol çekilen kärende şertnamasy'),
        whereToGet: t('From the property owner', 'Mülk sahibinden', 'من المالك', 'Emläk eýesinden'),
      },
      {
        title: t('Tax registration certificate', 'Vergi levhası', 'شهادة التسجيل الضريبي', 'Salgyt bellige alyş şahadatnamasy'),
        whereToGet: t('From the tax office', 'Vergi dairesinden', 'من مكتب الضرائب', 'Salgyt edarasyndan'),
      },
      {
        title: t('Floor plan', 'Kat planı', 'المخطط المعماري', 'Gat meýilnamasy'),
        whereToGet: t('From the building owner or architect', 'Bina sahibi veya mimardan', 'من المالك أو المهندس', 'Bina eýesi ýa-da arhitektordan'),
      },
      {
        title: t('NACE code registration (MERSİS)', 'NACE kodu kaydı (MERSİS)', 'تسجيل كود NACE (MERSİS)', 'NACE kody belligi (MERSİS)'),
        whereToGet: t('Selected during company formation on MERSİS', 'Şirket kuruluşunda MERSİS\'te seçilir', 'يُختار عند تأسيس الشركة على MERSİS', 'Kompaniýa döredilende MERSİS-de saýlanýar'),
      },
      {
        title: t('İşyeri Açma ve Çalışma Ruhsatı application', 'İşyeri Açma ve Çalışma Ruhsatı başvurusu', 'طلب رخصة فتح وتشغيل المحل', 'İşyeri Açma ve Çalışma Ruhsatı arzasy'),
        whereToGet: t('Submitted via e-Devlet to the district municipality', 'e-Devlet üzerinden ilçe belediyesine', 'يُقدّم عبر e-Devlet إلى البلدية', 'e-Devlet arkaly etrap häkimiýetine'),
      },
    ],
  },
  {
    id: 'office_service',
    agent: 'permit',
    aliases: ['office', 'service', 'tech', 'software', 'consulting', 'agency', 'ofis', 'yazılım', 'danışmanlık', 'مكتب', 'استشارات'],
    items: [
      {
        title: t('Lease or virtual office agreement', 'Kira veya sanal ofis sözleşmesi', 'عقد إيجار أو مكتب افتراضي', 'Kärende ýa-da wirtual ofis şertnamasy'),
        whereToGet: t('Property owner or a virtual office provider', 'Mülk sahibi veya sanal ofis sağlayıcısı', 'المالك أو مزود مكتب افتراضي', 'Emläk eýesi ýa-da wirtual ofis üpjün edijisi'),
      },
      {
        title: t('Tax registration certificate', 'Vergi levhası', 'شهادة التسجيل الضريبي', 'Salgyt bellige alyş şahadatnamasy'),
        whereToGet: t('From the tax office', 'Vergi dairesinden', 'من مكتب الضرائب', 'Salgyt edarasyndan'),
      },
      {
        title: t('Share capital deposit receipt (LTD min 10,000 TL)', 'Sermaye yatırma makbuzu (LTD min 10.000 TL)', 'إيصال إيداع رأس المال (LTD حد أدنى 10,000 TL)', 'Paý kapitaly goýum kwitansiýasy (LTD iň az 10.000 TL)'),
        whereToGet: t('From the bank before Trade Registry submission', 'Ticaret Sicili başvurusundan önce bankadan', 'من البنك قبل تقديم السجل التجاري', 'Söwda Sicili arzasyndan öň bankdan'),
      },
      {
        title: t('Trade Registry certificate', 'Ticaret Sicili tasdiknamesi', 'شهادة السجل التجاري', 'Söwda Sicili şahadatnamasy'),
        whereToGet: t('Issued after registration at the Trade Registry Office', 'Ticaret Sicili tescilinden sonra verilir', 'تُصدر بعد التسجيل في السجل التجاري', 'Söwda Sicili belliginden soň berilýär'),
      },
      {
        title: t('İşyeri Açma ve Çalışma Ruhsatı application', 'İşyeri Açma ve Çalışma Ruhsatı başvurusu', 'طلب رخصة التشغيل', 'İşyeri Açma ve Çalışma Ruhsatı arzasy'),
        whereToGet: t('Submitted via e-Devlet to the district municipality', 'e-Devlet üzerinden ilçe belediyesine', 'يُقدّم عبر e-Devlet إلى البلدية', 'e-Devlet arkaly etrap häkimiýetine'),
      },
    ],
  },
  {
    id: 'company_formation',
    agent: 'permit',
    aliases: ['company', 'formation', 'ltd', 'incorporate', 'llc', 'şirket', 'kuruluş', 'شركة', 'تأسيس'],
    items: [
      {
        title: t('Passports of all shareholders (notarized translations)', 'Tüm hissedarların pasaportları (noter onaylı tercüme)', 'جوازات سفر جميع المساهمين (ترجمات موثقة)', 'Ähli paýdarlaryň pasportlary (notarial terjime)'),
        whereToGet: t('Originals + Turkish notary translations', 'Asıllar + Türk noteri tercümeleri', 'الأصول + ترجمات من كاتب العدل', 'Asyllar + türk notariusy terjimeleri'),
      },
      {
        title: t('Articles of Association (MERSİS PDF)', 'Ana Sözleşme (MERSİS PDF)', 'النظام الأساسي (PDF من MERSİS)', 'Tertipnama (MERSİS PDF)'),
        whereToGet: t('Auto-generated on MERSİS after name + NACE steps', 'MERSİS\'te unvan + NACE adımlarından sonra otomatik oluşur', 'يُنشأ تلقائياً على MERSİS بعد خطوات الاسم وNACE', 'MERSİS-de ad + NACE ädimlerinden soň awtomatik döredilýär'),
      },
      {
        title: t('Signature circulars (İmza Sirküleri)', 'İmza Sirküleri', 'تعميم التوقيعات', 'Gol sirkulýarlary'),
        whereToGet: t('Prepared at the notary during the notarization visit', 'Noter ziyaretinde noterde hazırlanır', 'تُعد لدى كاتب العدل', 'Notarius saparynda notariusda taýýarlanýar'),
      },
      {
        title: t('Share capital deposit receipt (min 10,000 TL)', 'Sermaye yatırma makbuzu (min 10.000 TL)', 'إيصال إيداع رأس المال (10,000 TL)', 'Paý kapitaly goýum kwitansiýasy (iň az 10.000 TL)'),
        whereToGet: t('From the bank, before Trade Registry submission', 'Ticaret Sicili başvurusundan önce bankadan', 'من البنك قبل التسجيل التجاري', 'Söwda Sicili arzasyndan öň bankdan'),
      },
      {
        title: t('Office address proof', 'Ofis adres kanıtı', 'إثبات عنوان المكتب', 'Ofis salgysy subutnamasy'),
        whereToGet: t('Lease or virtual office agreement', 'Kira veya sanal ofis sözleşmesi', 'عقد إيجار أو مكتب افتراضي', 'Kärende ýa-da wirtual ofis şertnamasy'),
      },
    ],
  },
  {
    id: 'work_permit',
    agent: 'permit',
    aliases: ['work permit', 'çalışma izni', 'work visa', 'تصريح عمل', 'iş rugsady'],
    items: [
      {
        title: t('Employment contract', 'İş sözleşmesi', 'عقد العمل', 'Iş şertnamasy'),
        whereToGet: t('Signed with the Turkish employer (the employer applies)', 'Türk işverenle imzalanır (başvuruyu işveren yapar)', 'موقّع مع صاحب العمل التركي (يتقدم هو بالطلب)', 'Türk iş beriji bilen gol çekilýär (arzany iş beriji berýär)'),
      },
      {
        title: t('Passport + translation', 'Pasaport + tercüme', 'جواز السفر + ترجمة', 'Pasport + terjime'),
        whereToGet: t('Passport original; translation from a Turkish notary', 'Pasaport aslı; tercüme Türk noterinden', 'الأصل؛ الترجمة من كاتب العدل', 'Asly; terjime türk notariusyndan'),
      },
      {
        title: t('Diploma (translated)', 'Diploma (tercümeli)', 'الشهادة الجامعية (مترجمة)', 'Diplom (terjime edilen)'),
        whereToGet: t('Your diploma with certified Turkish translation', 'Diplomanız ve onaylı Türkçe tercümesi', 'شهادتك مع ترجمة تركية معتمدة', 'Diplomyňyz we tassyklanan türk terjimesi'),
      },
      {
        title: t('Employer company documents', 'İşveren şirket belgeleri', 'وثائق شركة صاحب العمل', 'Iş berijiniň kompaniýa resminamalary'),
        whereToGet: t('Trade Registry certificate, tax plate, SGK records of the employer', 'İşverenin Ticaret Sicili, vergi levhası, SGK kayıtları', 'السجل التجاري واللوحة الضريبية وسجلات SGK', 'Iş berijiniň Söwda Sicili, salgyt tagtajygy, SGK ýazgylary'),
      },
    ],
  },
];

export const ALL_CHECKLISTS: ServiceChecklist[] = [...STUDENT_CHECKLISTS, ...PERMIT_CHECKLISTS];

/**
 * Which application a checklist's uploads belong to. Several checklists share
 * one application on purpose — Denklik and dormitory paperwork are part of the
 * same university file, not separate cases.
 */
export const CHECKLIST_APPLICATION_KIND: Record<string, ApplicationKind> = {
  university_registration: 'university',
  denklik: 'university',
  dormitory: 'university',
  student_visa: 'visa_appointment',
  ikamet_new: 'ikamet',
  ikamet_renewal: 'ikamet',
  health_insurance: 'insurance',
  restaurant_cafe: 'business',
  retail_shop: 'business',
  office_service: 'business',
  company_formation: 'business',
  work_permit: 'business',
};

/**
 * Stable per-item identifier, used as `application_documents.kind` so each
 * document on a checklist occupies its own row.
 *
 * Derived from the English title rather than hand-maintained, and suffixed
 * with the position so two similarly-named items can never collide. The index
 * means reordering a checklist's items would orphan already-uploaded files —
 * append new items rather than inserting them.
 */
export function itemKey(item: ChecklistItem, index: number): string {
  const slug = item.title.en
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 28)
    .replace(/-+$/, '');
  return `${slug}-${index}`;
}

/**
 * A checklist resolved for a language, with the keys uploads are filed under.
 *
 * Russian is served from the overrides file rather than the four-language
 * tuples; a missing override falls back to English so a new item can never
 * render blank.
 */
export function checklistView(checklist: ServiceChecklist, pick: CardLang) {
  return checklist.items.map((item, i) => {
    const key = itemKey(item, i);
    if (pick === 'ru') {
      const ru = CHECKLIST_RU[`${checklist.id}:${key}`];
      if (ru) return { key, title: ru.title, whereToGet: ru.whereToGet };
      return { key, title: item.title.en, whereToGet: item.whereToGet.en };
    }
    return { key, title: item.title[pick], whereToGet: item.whereToGet[pick] };
  });
}

/**
 * Fold a UI language onto one the catalogue actually carries.
 *
 * Kazakh goes to Russian, not Turkmen: both are Cyrillic-reading audiences,
 * and Latin-script Turkmen is unreadable to them. Azeri reads Turkish, Uzbek
 * reads Turkmen, and Persian shares Arabic script.
 */
export function pickLang(lang: string): CardLang {
  const base: Record<string, CardLang> = { az: 'tr', uz: 'tk', kk: 'ru', fa: 'ar', ru: 'ru' };
  if (base[lang]) return base[lang];
  return lang === 'tr' || lang === 'ar' || lang === 'tk' ? (lang as Lang4) : 'en';
}

export function checklistById(id: string): ServiceChecklist | null {
  return ALL_CHECKLISTS.find((c) => c.id === id) ?? null;
}

/**
 * Match a user phrase to a checklist. Keyword-based on purpose: this is the
 * free advisory path, so a wrong-but-adjacent match is a better outcome than
 * no list at all.
 */
/**
 * Fold a phrase to something matchable across the scripts the platform serves.
 *
 * Turkish is the trap: "İ".toLowerCase() is "i" + U+0307 (combining dot
 * above), so "İkamet" never contains the ASCII substring "ikamet" and every
 * Turkish-typed service name silently failed to match. Persian and Arabic
 * differ in letter forms for the same word, and diacritics are optional in
 * both, so those are folded together too.
 */
export function normalizeForMatch(input: string): string {
  return String(input ?? '')
    .toLowerCase()
    .normalize('NFKD')
    // combining marks: the dot from İ, and Arabic/Persian vowel points
    .replace(/[\u0300-\u036f\u064b-\u065f\u0670]/g, '')
    .replace(/ı/g, 'i')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/[ىی]/g, 'ي')
    .replace(/ک/g, 'ك')
    .replace(/\s+/g, ' ')
    .trim();
}

export function findChecklist(service: string, agent: string): ServiceChecklist | null {
  const q = normalizeForMatch(service);
  if (!q) return null;
  const pool = ALL_CHECKLISTS.filter((c) => (agent === 'student' || agent === 'permit') && c.agent === agent);
  let best: ServiceChecklist | null = null;
  let bestScore = 0;
  for (const checklist of pool) {
    let score = 0;
    for (const raw of checklist.aliases) {
      const alias = normalizeForMatch(raw);
      if (!alias) continue;
      if (q === alias) score += 5;
      else if (q.includes(alias)) score += 2;
    }
    // Intent decides between two lists for the same service. It cannot create
    // a match on its own — a checklist the user never named stays at zero.
    if (score > 0 && checklist.intentWords?.some((w) => q.includes(normalizeForMatch(w)))) {
      score += 10;
    }
    if (score > bestScore) {
      bestScore = score;
      best = checklist;
    }
  }
  return best;
}
