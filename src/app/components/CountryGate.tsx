'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useLanguage } from '../context/LanguageContext';

/**
 * CountryGate — the first-visit screen.
 *
 * Editorial and quiet: the site's own warm paper, the TurkGateway wordmark, and
 * ten evenly-sized flag tiles that sway gently. Choosing a country is stored
 * once — the gate is never shown again on that device.
 *
 * The canvas is deliberately warm *white* whatever the site theme is, so the
 * entry moment is always the same. Every colour is a local token below, so
 * making it follow the theme later means pointing these at var(--bg) & co.
 */

const GATE = {
  bg: 'radial-gradient(ellipse at 50% -10%, #fffdfa 0%, #faf8f4 55%, #f3eee5 100%)',
  surface: '#fffdfa',
  text: '#1d1a15',
  muted: '#6b6357',
  border: 'rgba(66, 52, 34, 0.12)',
};

/**
 * Every language the platform speaks, greeting you in its own script. This is
 * the emotional job of the screen — before anyone reads a word of English they
 * should see their own language already waiting for them — so it is the
 * largest thing on the page after the wordmark, not a footnote.
 *
 * The order alternates scripts (Latin, Arabic, Cyrillic) so no single writing
 * system clumps together as the line cycles.
 */
const HELLOS = [
  { text: 'Merhaba', lang: 'tr', dir: 'ltr' },
  { text: 'مرحبا', lang: 'ar', dir: 'rtl' },
  { text: 'Hello', lang: 'en', dir: 'ltr' },
  { text: 'Salam', lang: 'tk', dir: 'ltr' },
  { text: 'Привет', lang: 'ru', dir: 'ltr' },
  { text: 'سلام', lang: 'fa', dir: 'rtl' },
  { text: 'Salam', lang: 'az', dir: 'ltr' },
  { text: 'Сәлем', lang: 'kk', dir: 'ltr' },
  { text: 'Assalomu alaykum', lang: 'uz', dir: 'ltr' },
] as const;

/**
 * What the platform actually does, named on the way in. Always in this order,
 * so the list reads the same in every language:
 * residence · visa · university · insurance · business · legal.
 */
const SERVICES: Record<string, string[]> = {
  en: ['Residence permit', 'Visa appointment', 'University registration', 'Health insurance', 'Business licence', 'Legal defence'],
  tr: ['İkamet izni', 'Vize randevusu', 'Üniversite kaydı', 'Sağlık sigortası', 'İşyeri ruhsatı', 'Hukuki savunma'],
  ar: ['تصريح الإقامة', 'موعد التأشيرة', 'التسجيل الجامعي', 'التأمين الصحي', 'رخصة العمل', 'الدفاع القانوني'],
  tk: ['Ýaşaýyş rugsady', 'Wiza duşuşygy', 'Uniwersitet ýazgysy', 'Saglyk ätiýaçlandyryşy', 'Iş rugsatnamasy', 'Hukuk goragy'],
  az: ['Yaşayış icazəsi', 'Viza görüşü', 'Universitet qeydiyyatı', 'Tibbi sığorta', 'Biznes lisenziyası', 'Hüquqi müdafiə'],
  uz: ['Yashash ruxsatnomasi', 'Viza uchrashuvi', 'Universitetga roʻyxatdan oʻtish', 'Tibbiy sugʻurta', 'Biznes litsenziyasi', 'Huquqiy himoya'],
  kk: ['Тұру рұқсаты', 'Виза кездесуі', 'Университетке тіркелу', 'Медициналық сақтандыру', 'Бизнес лицензиясы', 'Құқықтық қорғау'],
  fa: ['اجازه اقامت', 'وقت سفارت', 'ثبت‌نام دانشگاه', 'بیمه درمانی', 'مجوز کسب‌وکار', 'دفاع حقوقی'],
  ru: ['Вид на жительство', 'Запись на визу', 'Поступление в вуз', 'Медицинская страховка', 'Лицензия на бизнес', 'Юридическая защита'],
};

type Country = { code: string; name: string; flag: string };

const COUNTRIES: Country[] = [
  { code: 'TM', name: 'Turkmenistan', flag: '/flags/tm.svg' },
  { code: 'AZ', name: 'Azerbaijan', flag: '/flags/az.svg' },
  { code: 'UZ', name: 'Uzbekistan', flag: '/flags/uz.svg' },
  { code: 'KZ', name: 'Kazakhstan', flag: '/flags/kz.svg' },
  { code: 'IR', name: 'Iran', flag: '/flags/ir.svg' },
  { code: 'IQ', name: 'Iraq', flag: '/flags/iq.svg' },
  { code: 'SY', name: 'Syria', flag: '/flags/sy.svg' },
  { code: 'EG', name: 'Egypt', flag: '/flags/eg.svg' },
  { code: 'SA', name: 'Saudi Arabia', flag: '/flags/sa.svg' },
  { code: 'AE', name: 'UAE', flag: '/flags/ae.svg' },
];

// All nine languages the switcher offers — az/uz/kk/fa/ru used to fall back to
// English on the very first screen a visitor ever sees.
const COPY: Record<string, Record<string, string>> = {
  en: {
    subtitle: 'Where are you joining us from?',
    inside: 'It looks like you are in Türkiye',
    turkeyCta: 'I am already in Türkiye',
  },
  tr: {
    subtitle: 'Bize nereden katılıyorsunuz?',
    inside: 'Görünüşe göre Türkiye’desiniz',
    turkeyCta: 'Zaten Türkiye’deyim',
  },
  ar: {
    subtitle: 'من أين تنضم إلينا؟',
    inside: 'يبدو أنك داخل تركيا',
    turkeyCta: 'أنا بالفعل في تركيا',
  },
  tk: {
    subtitle: 'Bize nireden goşulýarsyňyz?',
    inside: 'Siz Türkiýede ýaly görünýär',
    turkeyCta: 'Men eýýäm Türkiýede',
  },
  az: {
    subtitle: 'Bizə haradan qoşulursunuz?',
    inside: 'Deyəsən siz Türkiyədəsiniz',
    turkeyCta: 'Mən artıq Türkiyədəyəm',
  },
  uz: {
    subtitle: 'Bizga qayerdan qoʻshilyapsiz?',
    inside: 'Siz Turkiyada koʻrinasiz',
    turkeyCta: 'Men allaqachon Turkiyadaman',
  },
  kk: {
    subtitle: 'Бізге қай жерден қосылып отырсыз?',
    inside: 'Сіз Түркияда сияқтысыз',
    turkeyCta: 'Мен Түркиядамын',
  },
  fa: {
    subtitle: 'از کجا به ما می‌پیوندید؟',
    inside: 'به نظر می‌رسد در ترکیه هستید',
    turkeyCta: 'من هم‌اکنون در ترکیه هستم',
  },
  ru: {
    subtitle: 'Откуда вы к нам присоединяетесь?',
    inside: 'Похоже, вы находитесь в Турции',
    turkeyCta: 'Я уже в Турции',
  },
};

export default function CountryGate({
  onSelect,
  onContinue,
  inTurkey,
}: {
  onSelect: (country: Country) => void;
  onContinue?: () => void;
  inTurkey: boolean;
}) {
  const { language } = useLanguage();
  const copy = COPY[language] ?? COPY.en;
  const isRTL = language === 'ar' || language === 'fa';

  // The greeting rotates rather than listing all nine at once: one word at a
  // time can be set large enough to carry the page, and the change is what
  // makes a visitor notice their own language appear.
  const [helloIndex, setHelloIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setHelloIndex((i) => (i + 1) % HELLOS.length), 1800);
    return () => clearInterval(timer);
  }, []);

  const hello = HELLOS[helloIndex];
  const services = SERVICES[language] ?? SERVICES.en;

  // The Türkiye option is always reachable — geo detection only decides whether
  // it leads the page or sits quietly under the grid, never whether it exists.
  const turkeyButton = (
    <motion.button
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.98 }}
      onClick={onContinue}
      className={`inline-flex items-center gap-2.5 rounded-full px-6 py-3 text-[13px] font-medium transition-colors cursor-pointer ${
        inTurkey
          ? 'text-[#faf8f4] border border-transparent'
          : 'border hover:bg-[#f3eee5]'
      }`}
      style={
        inTurkey
          ? { background: GATE.text }
          : { background: GATE.surface, borderColor: GATE.border, color: GATE.text }
      }
    >
      <img src="/flags/tr.svg" alt="" aria-hidden className="h-4 w-[21px] rounded-[2px] object-cover" />
      {copy.turkeyCta}
    </motion.button>
  );

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4 }}
      className="fixed inset-0 z-[100] overflow-y-auto"
      dir={isRTL ? 'rtl' : 'ltr'}
      style={{ background: GATE.bg, color: GATE.text }}
    >
      <div className="relative min-h-full flex items-center justify-center px-5 py-12">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="w-full max-w-4xl"
        >
          {/* Greeting — one language at a time, big enough to lead the page */}
          <div className="h-[52px] md:h-[68px] flex items-center justify-center overflow-hidden">
            <AnimatePresence mode="wait">
              <motion.span
                key={hello.lang}
                initial={{ opacity: 0, y: 14, filter: 'blur(6px)' }}
                animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                exit={{ opacity: 0, y: -14, filter: 'blur(6px)' }}
                transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                dir={hello.dir}
                lang={hello.lang}
                className="block text-center text-[34px] md:text-[46px] leading-none font-light tracking-[-0.01em] select-none"
                style={{ color: GATE.muted }}
              >
                {hello.text}
              </motion.span>
            </AnimatePresence>
          </div>

          {/* Wordmark */}
          <h1
            className="font-claude mt-6 text-center text-5xl md:text-7xl font-medium tracking-[-0.02em] select-none"
            dir="ltr"
          >
            <span className="text-red-500">TURK</span>
            <span style={{ color: GATE.text }}>GATEWAY</span>
          </h1>

          <p className="mt-5 text-center text-base md:text-lg" style={{ color: GATE.muted }}>
            {copy.subtitle}
          </p>

          {/* Geo-detected Türkiye visitors get the shortcut up front */}
          {inTurkey && (
            <div className="mt-8 flex flex-col items-center gap-3">
              <p className="text-[13px]" style={{ color: GATE.muted }}>
                {copy.inside}
              </p>
              {turkeyButton}
            </div>
          )}

          {/* Country grid — every tile identical, so the grid actually lines up */}
          <div className="mt-10 md:mt-12 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-6 md:gap-8">
            {COUNTRIES.map((country, i) => (
              <motion.button
                key={country.code}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 + i * 0.04, duration: 0.4, ease: 'easeOut' }}
                whileHover={{ y: -4 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => onSelect(country)}
                className="group flex flex-col items-center gap-3 bg-transparent border-0 p-0 cursor-pointer"
              >
                <span className="[perspective:700px]">
                  <span
                    className="block w-[88px] md:w-[112px] aspect-[4/3] rounded-xl overflow-hidden border transition-shadow"
                    style={{
                      borderColor: GATE.border,
                      background: GATE.surface,
                      boxShadow: '0 2px 10px rgba(66, 52, 34, 0.06)',
                    }}
                  >
                    <img
                      src={country.flag}
                      alt=""
                      aria-hidden
                      className="flag-sway w-full h-full object-cover"
                      style={{ animationDelay: `${i * 0.5}s` }}
                      draggable={false}
                    />
                  </span>
                </span>
                <span
                  className="text-[13px] font-medium text-center leading-tight transition-colors group-hover:text-red-500"
                  style={{ color: GATE.text }}
                >
                  {country.name}
                </span>
              </motion.button>
            ))}
          </div>

          {/* Türkiye shortcut for everyone else */}
          {!inTurkey && <div className="mt-12 flex justify-center">{turkeyButton}</div>}

          {/* What we actually do — the greeting above says hello, this says why
              the visitor is here. Hairline separators rather than pills, so it
              stays a quiet closing line and does not compete with the flags. */}
          <div className="mt-14 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 px-2">
            {services.map((service, i) => (
              <span key={service} className="flex items-center gap-3">
                {i > 0 && (
                  <span className="h-3 w-px" style={{ background: GATE.border }} aria-hidden />
                )}
                <span className="text-[13px] md:text-[14px] font-light" style={{ color: GATE.muted }}>
                  {service}
                </span>
              </span>
            ))}
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}
