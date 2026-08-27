/**
 * document-checklists.ru.ts
 * Russian document names for every checklist.
 *
 * The base catalogue in document-checklists.ts carries four languages, and the
 * original design let the model translate the rest in its prose reply. The
 * upload card broke that assumption: it renders the raw dictionary, so a
 * Russian speaker was handed a Russian answer above a list of English document
 * names — and Kazakh, folded onto Turkmen, got Latin script it cannot read.
 *
 * Russian fixes both, since Kazakh speakers read Russian far more readily than
 * Latin Turkmen. It lives in its own file, keyed by service and item, so the
 * four-language tuples stay untouched and another language can be added the
 * same way.
 */

export type RuEntry = { title: string; whereToGet: string };

/** Keyed `${checklistId}:${itemKey}` — item keys are unique only per checklist. */
export const CHECKLIST_RU: Record<string, RuEntry> = {
  // ── university_registration ───────────────────────────────────────────────
  'university_registration:acceptance-letter-0': {
    title: 'Письмо о зачислении',
    whereToGet: 'Выдаётся отделом по приёму иностранных студентов университета',
  },
  'university_registration:passport-valid-6-months-nota-1': {
    title: 'Паспорт (действителен 6+ месяцев) + нотариальный перевод на турецкий',
    whereToGet: 'Паспорт — в вашей стране; перевод — у турецкого нотариуса',
  },
  'university_registration:apostilled-high-school-diplo-2': {
    title: 'Аттестат о среднем образовании с апостилем + заверенный перевод',
    whereToGet: 'Апостиль — в МИД вашей страны',
  },
  'university_registration:denklik-diploma-equivalency-3': {
    title: 'Свидетельство о признании диплома (Denklik)',
    whereToGet: 'Подать на e-denklik.meb.gov.tr, затем посетить областное управление MEB',
  },
  'university_registration:tax-number-vergi-kimlik-numa-4': {
    title: 'Налоговый номер (Vergi Kimlik Numarası)',
    whereToGet: 'Бесплатно в любой налоговой инспекции (Vergi Dairesi) с паспортом',
  },
  'university_registration:6-biometric-photos-5': {
    title: '6 биометрических фотографий',
    whereToGet: 'Любое фотоателье в Турции',
  },
  'university_registration:1-year-health-insurance-poli-6': {
    title: 'Полис медицинского страхования на 1 год',
    whereToGet: 'Частные страховщики, напр. e-ikametsigorta.com (~650 TL в год)',
  },
  'university_registration:tuition-fee-receipt-7': {
    title: 'Квитанция об оплате обучения',
    whereToGet: 'Выдаётся университетом после оплаты',
  },

  // ── student_visa ──────────────────────────────────────────────────────────
  'student_visa:acceptance-invitation-letter-0': {
    title: 'Письмо о зачислении / приглашение',
    whereToGet: 'От турецкого университета, куда вы зачислены',
  },
  'student_visa:passport-valid-6-months-1': {
    title: 'Паспорт (действителен 6+ месяцев)',
    whereToGet: 'Паспортный орган вашей страны',
  },
  'student_visa:2-biometric-photos-2': {
    title: '2 биометрические фотографии',
    whereToGet: 'Фотоателье (визовый формат)',
  },
  'student_visa:bank-statement-min-500-usd-m-3': {
    title: 'Выписка из банка (минимум ~500 USD в месяц)',
    whereToGet: 'В вашем банке, за последние 3 месяца',
  },
  'student_visa:health-insurance-4': {
    title: 'Медицинская страховка',
    whereToGet: 'Частная страховка на весь период обучения',
  },
  'student_visa:visa-application-form-fee-re-5': {
    title: 'Анкета на визу + квитанция об оплате сбора',
    whereToGet: 'В консульстве Турции / визовом центре (агент заполнит её за вас)',
  },

  // ── ikamet_new ────────────────────────────────────────────────────────────
  'ikamet_new:i-kamet-application-form-fro-0': {
    title: 'Заявление на ВНЖ (İkamet) с портала e-ikamet',
    whereToGet: 'Мы открываем e-ikamet.goc.gov.tr здесь и заполняем вместе с вами — на середине портал присылает одноразовую ссылку, и открыть её нужно в том же окне',
  },
  'ikamet_new:passport-copy-1': {
    title: 'Паспорт + копия',
    whereToGet: 'Оригинал и копии страниц с данными',
  },
  'ikamet_new:4-biometric-photos-2': {
    title: '4 биометрические фотографии',
    whereToGet: 'Фотоателье, белый фон',
  },
  'ikamet_new:student-certificate-renci-be-3': {
    title: 'Справка студента (Öğrenci Belgesi)',
    whereToGet: 'В студенческом отделе университета или на e-Devlet',
  },
  'ikamet_new:health-insurance-1-year-4': {
    title: 'Медицинская страховка (на 1 год)',
    whereToGet: 'Частный страховщик, ~650 TL в год',
  },
  'ikamet_new:address-proof-rental-contrac-5': {
    title: 'Подтверждение адреса: договор аренды или справка из общежития',
    whereToGet: 'Нотариально заверенный договор аренды или письмо администрации общежития',
  },
  'ikamet_new:tax-number-card-fee-receipt-6': {
    title: 'Налоговый номер + квитанция об оплате карты',
    whereToGet: 'Налоговая инспекция; сбор оплачивается онлайн или в PTT',
  },

  // ── ikamet_renewal ────────────────────────────────────────────────────────
  'ikamet_renewal:current-i-kamet-card-number-0': {
    title: 'Действующая карта İkamet (номер + срок действия)',
    whereToGet: 'Карта, которая у вас уже есть',
  },
  'ikamet_renewal:updated-student-certificate-1': {
    title: 'Обновлённая справка студента',
    whereToGet: 'Студенческий отдел университета за текущий семестр',
  },
  'ikamet_renewal:valid-health-insurance-2': {
    title: 'Действующая медицинская страховка',
    whereToGet: 'Продлённый полис на весь новый срок разрешения',
  },
  'ikamet_renewal:address-proof-if-address-cha-3': {
    title: 'Подтверждение адреса (если адрес изменился)',
    whereToGet: 'Новый договор аренды или справка из общежития',
  },
  'ikamet_renewal:renewal-application-form-e-i-4': {
    title: 'Заявление на продление (e-ikamet Uzatma)',
    whereToGet: 'Мы открываем e-ikamet.goc.gov.tr здесь и заполняем вместе с вами — подавайте до истечения срока, лучше за 60 дней',
  },
  'ikamet_renewal:4-biometric-photos-card-fee-5': {
    title: '4 биометрические фотографии + квитанция за карту',
    whereToGet: 'Фотоателье; сбор онлайн или в PTT',
  },

  // ── health_insurance ──────────────────────────────────────────────────────
  'health_insurance:passport-copy-0': {
    title: 'Паспорт + копия',
    whereToGet: 'Ваш паспорт',
  },
  'health_insurance:student-certificate-enrollme-1': {
    title: 'Справка студента / подтверждение зачисления',
    whereToGet: 'Студенческий отдел университета или e-Devlet',
  },
  'health_insurance:enrollment-kay-t-date-2': {
    title: 'Дата зачисления (kayıt)',
    whereToGet: 'Указана в документах о регистрации в университете',
  },
  'health_insurance:address-in-t-rkiye-3': {
    title: 'Адрес в Турции',
    whereToGet: 'Договор аренды или адрес общежития',
  },
  'health_insurance:premium-payment-1-year-4': {
    title: 'Оплата страхового взноса (за 1 год)',
    whereToGet: 'Оплачивается страховщику при подаче заявления',
  },

  // ── denklik ───────────────────────────────────────────────────────────────
  'denklik:apostilled-diploma-0': {
    title: 'Диплом с апостилем',
    whereToGet: 'Апостиль в МИД вашей страны',
  },
  'denklik:apostilled-transcripts-1': {
    title: 'Транскрипты с апостилем',
    whereToGet: 'Из вашего учебного заведения, затем апостиль',
  },
  'denklik:certified-turkish-translatio-2': {
    title: 'Заверенные переводы на турецкий',
    whereToGet: 'У турецкого нотариуса (yeminli tercüman)',
  },
  'denklik:passport-copy-3': {
    title: 'Копия паспорта',
    whereToGet: 'Страницы с личными данными',
  },
  'denklik:e-denklik-application-origin-4': {
    title: 'Заявление e-denklik + оригиналы для визита в MEB',
    whereToGet: 'Загрузите на e-denklik.meb.gov.tr, затем принесите оригиналы в İl MEB Müdürlüğü',
  },

  // ── dormitory ─────────────────────────────────────────────────────────────
  'dormitory:student-certificate-renci-be-0': {
    title: 'Справка студента (Öğrenci Belgesi)',
    whereToGet: 'Студенческий отдел университета / e-Devlet',
  },
  'dormitory:passport-i-kamet-1': {
    title: 'Паспорт / ВНЖ (İkamet)',
    whereToGet: 'Ваши документы, удостоверяющие личность',
  },
  'dormitory:kyk-application-e-devlet-dur-2': {
    title: 'Заявление в KYK (через e-Devlet, в период подачи)',
    whereToGet: 'Подать на e-Devlet, когда откроется период приёма заявок KYK',
  },
  'dormitory:deposit-private-dormitories-3': {
    title: 'Залог (для частных общежитий)',
    whereToGet: 'Оплачивается частному общежитию при заключении договора',
  },

  // ── restaurant_cafe ───────────────────────────────────────────────────────
  'restaurant_cafe:signed-lease-agreement-0': {
    title: 'Подписанный договор аренды',
    whereToGet: 'От собственника помещения, при необходимости нотариально заверенный',
  },
  'restaurant_cafe:tax-registration-certificate-1': {
    title: 'Свидетельство о налоговой регистрации (vergi levhası)',
    whereToGet: 'В налоговой инспекции после регистрации компании',
  },
  'restaurant_cafe:floor-plan-mimari-proje-2': {
    title: 'Поэтажный план (mimari proje)',
    whereToGet: 'От собственника здания или лицензированного архитектора',
  },
  'restaurant_cafe:fire-safety-report-i-tfaiye-3': {
    title: 'Заключение пожарной безопасности (İtfaiye Uygunluk)',
    whereToGet: 'Проверка пожарной службы, заявка через районный муниципалитет',
  },
  'restaurant_cafe:chimney-conformity-baca-uygu-4': {
    title: 'Заключение о дымоходе (Baca Uygunluğu)',
    whereToGet: 'От муниципалитета / лицензированной фирмы по дымоходам',
  },
  'restaurant_cafe:food-registration-g-da-sicil-5': {
    title: 'Регистрация пищевого производства (Gıda Sicil Belgesi)',
    whereToGet: 'Регистрация на tarim.gov.tr (Министерство сельского хозяйства)',
  },
  'restaurant_cafe:tapdk-alcohol-license-if-ser-6': {
    title: 'Лицензия TAPDK на алкоголь (если подаёте алкоголь)',
    whereToGet: 'TAPDK — заведение должно быть в 100+ м от школ и мечетей',
  },

  // ── retail_shop ───────────────────────────────────────────────────────────
  'retail_shop:signed-lease-agreement-0': {
    title: 'Подписанный договор аренды',
    whereToGet: 'От собственника помещения',
  },
  'retail_shop:tax-registration-certificate-1': {
    title: 'Свидетельство о налоговой регистрации',
    whereToGet: 'В налоговой инспекции',
  },
  'retail_shop:floor-plan-2': {
    title: 'Поэтажный план',
    whereToGet: 'От собственника здания или архитектора',
  },
  'retail_shop:nace-code-registration-mersi-3': {
    title: 'Регистрация кода NACE (MERSİS)',
    whereToGet: 'Выбирается при регистрации компании в MERSİS',
  },
  'retail_shop:i-yeri-a-ma-ve-al-ma-ruhsat-4': {
    title: 'Заявление на разрешение на открытие и работу (İşyeri Açma ve Çalışma Ruhsatı)',
    whereToGet: 'Подаётся через e-Devlet в районный муниципалитет',
  },

  // ── office_service ────────────────────────────────────────────────────────
  'office_service:lease-or-virtual-office-agre-0': {
    title: 'Договор аренды или виртуального офиса',
    whereToGet: 'Собственник помещения или провайдер виртуального офиса',
  },
  'office_service:tax-registration-certificate-1': {
    title: 'Свидетельство о налоговой регистрации',
    whereToGet: 'В налоговой инспекции',
  },
  'office_service:share-capital-deposit-receip-2': {
    title: 'Квитанция о внесении уставного капитала (LTD — минимум 10 000 TL)',
    whereToGet: 'В банке, до подачи в Торговый реестр',
  },
  'office_service:trade-registry-certificate-3': {
    title: 'Свидетельство Торгового реестра',
    whereToGet: 'Выдаётся после регистрации в Управлении торгового реестра',
  },
  'office_service:i-yeri-a-ma-ve-al-ma-ruhsat-4': {
    title: 'Заявление на разрешение на открытие и работу (İşyeri Açma ve Çalışma Ruhsatı)',
    whereToGet: 'Подаётся через e-Devlet в районный муниципалитет',
  },

  // ── company_formation ─────────────────────────────────────────────────────
  'company_formation:passports-of-all-shareholder-0': {
    title: 'Паспорта всех учредителей (с нотариальными переводами)',
    whereToGet: 'Оригиналы + переводы у турецкого нотариуса',
  },
  'company_formation:articles-of-association-mers-1': {
    title: 'Устав компании (PDF из MERSİS)',
    whereToGet: 'Формируется в MERSİS после выбора названия и кода NACE',
  },
  'company_formation:signature-circulars-i-mza-si-2': {
    title: 'Образцы подписей (İmza Sirküleri)',
    whereToGet: 'Оформляются у нотариуса во время визита для заверения',
  },
  'company_formation:share-capital-deposit-receip-3': {
    title: 'Квитанция о внесении уставного капитала (минимум 10 000 TL)',
    whereToGet: 'В банке, до подачи в Торговый реестр',
  },
  'company_formation:office-address-proof-4': {
    title: 'Подтверждение адреса офиса',
    whereToGet: 'Договор аренды или виртуального офиса',
  },

  // ── work_permit ───────────────────────────────────────────────────────────
  'work_permit:employment-contract-0': {
    title: 'Трудовой договор',
    whereToGet: 'Подписывается с турецким работодателем (заявление подаёт работодатель)',
  },
  'work_permit:passport-translation-1': {
    title: 'Паспорт + перевод',
    whereToGet: 'Оригинал паспорта; перевод у турецкого нотариуса',
  },
  'work_permit:diploma-translated-2': {
    title: 'Диплом (с переводом)',
    whereToGet: 'Ваш диплом с заверенным переводом на турецкий',
  },
  'work_permit:employer-company-documents-3': {
    title: 'Документы компании-работодателя',
    whereToGet: 'Свидетельство Торгового реестра, налоговая карта, записи SGK работодателя',
  },
};
