'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  FileDown,
  Loader2,
  MessageSquare,
  Zap,
} from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import Sidebar from '../components/Sidebar';
import Navbar from '../components/Navbar';
import MobileMenuButton from '../components/MobileMenuButton';
import Footer from '../components/Footer';

/**
 * Applications — everything the platform is running for this person.
 *
 * A chat only ever shows one conversation, so someone with a visa application
 * and an İkamet renewal in flight had nowhere to see both, no way to tell
 * which was waiting on them and which was waiting on us, and no route back to
 * the documents we generated. This is that view.
 */

type AppRow = {
  id: number;
  kind: string;
  service: string | null;
  status: string;
  sessionId: string;
  sessionTitle: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  total: number;
  uploadedCount: number;
  missing: string[];
  documents: { id: number; filename: string; uploadedAt: string | null }[];
  forms: { id: number; filename: string }[];
};

const COPY: Record<string, Record<string, string>> = {
  en: {
    title: 'My applications', subtitle: 'Every application we are running for you.',
    empty: 'Nothing running yet.', emptyBody: 'Ask an agent about a service and upload your documents — the automation starts by itself once the list is complete.',
    startOne: 'Start one in chat', documents: 'documents', ofTotal: '{done} of {total} documents',
    waitingOnYou: 'Waiting for your documents', queued: 'Queued for processing',
    running: 'Being processed', submitted: 'Submitted', done: 'Completed',
    yourForm: 'Your filled form', openChat: 'Open conversation', stillNeeded: 'Still needed',
    signedOut: 'Sign in to see your applications.', signedOutBody: 'Your applications are tied to your account — sign in and they will appear here.', signIn: 'Sign in',
  },
  tr: {
    title: 'Başvurularım', subtitle: 'Sizin için yürüttüğümüz tüm başvurular.',
    empty: 'Henüz çalışan bir şey yok.', emptyBody: 'Bir ajana hizmet hakkında sorun ve belgelerinizi yükleyin — liste tamamlanınca otomasyon kendiliğinden başlar.',
    startOne: 'Sohbette başlat', documents: 'belge', ofTotal: '{total} belgeden {done} tanesi',
    waitingOnYou: 'Belgeleriniz bekleniyor', queued: 'İşleme alındı',
    running: 'İşleniyor', submitted: 'Gönderildi', done: 'Tamamlandı',
    yourForm: 'Doldurulmuş formunuz', openChat: 'Sohbeti aç', stillNeeded: 'Hâlâ gerekli',
    signedOut: 'Başvurularınızı görmek için giriş yapın.', signedOutBody: 'Başvurularınız hesabınıza bağlıdır — giriş yaptığınızda burada görünür.', signIn: 'Giriş yap',
  },
  ar: {
    title: 'طلباتي', subtitle: 'كل الطلبات التي ننفذها لك.',
    empty: 'لا يوجد شيء قيد التشغيل بعد.', emptyBody: 'اسأل وكيلاً عن خدمة وارفع مستنداتك — تبدأ الأتمتة تلقائياً عند اكتمال القائمة.',
    startOne: 'ابدأ من الدردشة', documents: 'مستندات', ofTotal: '{done} من {total} مستندات',
    waitingOnYou: 'بانتظار مستنداتك', queued: 'في قائمة المعالجة',
    running: 'قيد المعالجة', submitted: 'تم الإرسال', done: 'مكتمل',
    yourForm: 'نموذجك المعبأ', openChat: 'فتح المحادثة', stillNeeded: 'لا يزال مطلوباً',
    signedOut: 'سجّل الدخول لعرض طلباتك.', signedOutBody: 'طلباتك مرتبطة بحسابك — سجّل الدخول وستظهر هنا.', signIn: 'تسجيل الدخول',
  },
  tk: {
    title: 'Meniň arzalarym', subtitle: 'Siziň üçin alyp barýan ähli arzalarymyz.',
    empty: 'Heniz işleýän zat ýok.', emptyBody: 'Agentden hyzmat barada soraň we resminamalaryňyzy ýükläň — sanaw dolanda awtomatlaşdyrma özi başlaýar.',
    startOne: 'Söhbetde başla', documents: 'resminama', ofTotal: '{total} resminamadan {done} sanysy',
    waitingOnYou: 'Resminamalaryňyza garaşylýar', queued: 'Nobatda',
    running: 'Işlenýär', submitted: 'Iberildi', done: 'Tamamlandy',
    yourForm: 'Doldurylan formaňyz', openChat: 'Söhbeti aç', stillNeeded: 'Ýene gerek',
    signedOut: 'Arzalaryňyzy görmek üçin giriň.', signedOutBody: 'Arzalaryňyz hasabyňyza baglydyr — girseňiz şu ýerde görüner.', signIn: 'Giriş',
  },
  ru: {
    title: 'Мои заявки', subtitle: 'Все заявки, которые мы ведём для вас.',
    empty: 'Пока ничего не запущено.', emptyBody: 'Спросите агента об услуге и загрузите документы — автоматизация запустится сама, когда список будет полным.',
    startOne: 'Начать в чате', documents: 'документов', ofTotal: '{done} из {total} документов',
    waitingOnYou: 'Ждём ваши документы', queued: 'В очереди на обработку',
    running: 'В обработке', submitted: 'Отправлено', done: 'Завершено',
    yourForm: 'Ваша заполненная анкета', openChat: 'Открыть чат', stillNeeded: 'Ещё нужно',
    signedOut: 'Войдите, чтобы увидеть свои заявки.', signedOutBody: 'Заявки привязаны к вашему аккаунту — войдите, и они появятся здесь.', signIn: 'Войти',
  },
};

const BASE_LANG: Record<string, string> = { az: 'tr', uz: 'tk', kk: 'ru', fa: 'ar' };

/** Service names people recognise, rather than the internal application kind. */
const KIND_LABEL: Record<string, Record<string, string>> = {
  en: {
    visa_appointment: 'Student visa', university: 'University registration',
    ikamet: 'Residence permit (İkamet)', insurance: 'Health insurance',
    business: 'Business licence', criminal_case: 'Legal defence',
  },
  tr: {
    visa_appointment: 'Öğrenci vizesi', university: 'Üniversite kaydı',
    ikamet: 'İkamet izni', insurance: 'Sağlık sigortası',
    business: 'İşyeri ruhsatı', criminal_case: 'Hukuki savunma',
  },
  ar: {
    visa_appointment: 'تأشيرة الطالب', university: 'التسجيل الجامعي',
    ikamet: 'تصريح الإقامة', insurance: 'التأمين الصحي',
    business: 'رخصة العمل', criminal_case: 'الدفاع القانوني',
  },
  tk: {
    visa_appointment: 'Talyp wizasy', university: 'Uniwersitet ýazgysy',
    ikamet: 'Ýaşaýyş rugsady', insurance: 'Saglyk ätiýaçlandyryşy',
    business: 'Iş rugsatnamasy', criminal_case: 'Hukuk goragy',
  },
  ru: {
    visa_appointment: 'Студенческая виза', university: 'Поступление в вуз',
    ikamet: 'Вид на жительство (İkamet)', insurance: 'Медицинская страховка',
    business: 'Лицензия на бизнес', criminal_case: 'Юридическая защита',
  },
};

/**
 * Status as the applicant experiences it: is this waiting on me, or on them?
 * `collecting` is the only state they can act on, so it is the only one shown
 * in an alerting colour.
 */
function statusView(row: AppRow, t: Record<string, string>) {
  if (row.status === 'collecting') {
    return { label: t.waitingOnYou, tone: 'text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/25', icon: Clock };
  }
  if (row.status === 'ready') {
    return { label: t.queued, tone: 'text-indigo-600 dark:text-indigo-400 bg-indigo-500/10 border-indigo-500/25', icon: Zap };
  }
  if (row.status === 'in_progress') {
    return { label: t.running, tone: 'text-indigo-600 dark:text-indigo-400 bg-indigo-500/10 border-indigo-500/25', icon: Loader2 };
  }
  if (row.status === 'submitted' || row.status === 'booked' || row.status === 'forwarded') {
    return { label: t.submitted, tone: 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/25', icon: CheckCircle2 };
  }
  return { label: t.done, tone: 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/25', icon: CheckCircle2 };
}

export default function ApplicationsPage() {
  const { language, isRTL } = useLanguage();
  const { token } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [rows, setRows] = useState<AppRow[] | null>(null);

  const t = COPY[BASE_LANG[language] ?? (COPY[language] ? language : 'en')] ?? COPY.en;
  const kindLabels = KIND_LABEL[BASE_LANG[language] ?? (KIND_LABEL[language] ? language : 'en')] ?? KIND_LABEL.en;

  const load = useCallback(async () => {
    // Signed out is a known answer, not a pending one. Returning early here
    // without touching `rows` left it null, and null is the spinner branch —
    // so a guest who opened this page watched it load forever.
    if (!token) {
      setRows([]);
      return;
    }
    try {
      const res = await fetch(`/api/applications/mine?lang=${language}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const d = await res.json();
        setRows(d.applications ?? []);
      } else {
        setRows([]);
      }
    } catch {
      setRows([]);
    }
  }, [token, language]);

  /**
   * Fetch the document with the bearer header, then hand the browser a blob.
   *
   * This was a plain <a href="/api/documents/id">, which cannot work: the route
   * authenticates from the Authorization header, and a browser navigating to a
   * URL sends cookies, never that header. Clicking the link opened a tab
   * showing {"detail":"Not authenticated"} every time.
   */
  const downloadForm = useCallback(
    async (docId: number, e: React.MouseEvent) => {
      e.preventDefault();
      if (!token) return;
      try {
        const res = await fetch(`/api/documents/${docId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const blob = await res.blob();
        const disposition = res.headers.get('Content-Disposition') ?? '';
        const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? 'document.pdf';
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } catch {
        /* the card stays as it was; nothing to roll back */
      }
    },
    [token],
  );

  useEffect(() => {
    load();
    // Applications move when an operator picks them up, so refresh while the
    // page is open rather than showing a snapshot that silently goes stale.
    const timer = setInterval(load, 20_000);
    return () => clearInterval(timer);
  }, [load]);

  return (
    <div
      className="flex h-screen bg-[var(--bg)] text-[var(--text)] transition-colors duration-500 overflow-hidden"
      dir={isRTL ? 'rtl' : 'ltr'}
    >
      <Sidebar
        currentSessionId={null}
        assistantType="student"
        onSessionSelect={(id) => {
          localStorage.setItem('TurkGateway_active_session_id', id);
          window.location.href = '/chat';
        }}
        onNewChat={() => { window.location.href = '/chat?new=true'; }}
        onDeleteSession={() => {}}
        token={token}
        mobileOpen={mobileMenuOpen}
        onMobileClose={() => setMobileMenuOpen(false)}
      />

      <main className="flex-1 flex flex-col min-w-0 relative overflow-y-auto slim-scroll">
        <Navbar isAppPage onMobileMenuClick={() => setMobileMenuOpen(true)} />
        <MobileMenuButton onClick={() => setMobileMenuOpen(true)} />

        <div className="w-full px-6 md:px-12 py-8 md:py-12">
          <div className="max-w-3xl mx-auto">
            <h1 className="text-3xl md:text-4xl font-semibold tracking-tight text-[var(--text)]">{t.title}</h1>
            <p className="mt-2 text-[15px] text-[var(--muted)]">{t.subtitle}</p>
          </div>

          <div className="max-w-3xl mx-auto mt-8 space-y-4">
            {rows === null && (
              <div className="flex items-center gap-2 text-[14px] text-[var(--muted)] py-8">
                <Loader2 size={15} className="animate-spin" />
              </div>
            )}

            {rows?.length === 0 && (
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-6 py-10 text-center">
                <p className="text-[16px] font-semibold text-[var(--text)]">
                  {token ? t.empty : t.signedOut}
                </p>
                <p className="mt-2 text-[14px] text-[var(--muted)] max-w-md mx-auto leading-relaxed">
                  {token ? t.emptyBody : t.signedOutBody}
                </p>
                <Link
                  href={token ? '/chat' : '/login'}
                  className="mt-5 inline-flex items-center gap-2 rounded-full bg-[var(--text)] px-5 py-2.5 text-[13px] font-medium text-[var(--bg)] no-underline hover:opacity-90 transition-opacity"
                >
                  <MessageSquare size={14} />
                  {token ? t.startOne : t.signIn}
                </Link>
              </div>
            )}

            {rows?.map((row, i) => {
              const view = statusView(row, t);
              const StatusIcon = view.icon;
              const pct = row.total ? Math.round((row.uploadedCount / row.total) * 100) : 0;

              return (
                <motion.div
                  key={row.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: i * 0.04 }}
                  className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden"
                >
                  <div className="px-5 py-4">
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                      <div className="min-w-0">
                        <h2 className="text-[16px] font-semibold text-[var(--text)]">
                          {kindLabels[row.kind] ?? row.kind}
                        </h2>
                        {row.sessionTitle && (
                          <p className="mt-0.5 text-[12.5px] text-[var(--muted)] truncate">{row.sessionTitle}</p>
                        )}
                      </div>
                      <span
                        className={`shrink-0 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11.5px] font-semibold ${view.tone}`}
                      >
                        <StatusIcon size={12} className={row.status === 'in_progress' ? 'animate-spin' : ''} />
                        {view.label}
                      </span>
                    </div>

                    {row.total > 0 && (
                      <div className="mt-4">
                        <div className="flex items-center justify-between gap-3 mb-1.5">
                          <span className="text-[12px] text-[var(--muted)] tabular-nums">
                            {t.ofTotal
                              .replace('{done}', String(row.uploadedCount))
                              .replace('{total}', String(row.total))}
                          </span>
                        </div>
                        <div className="h-1.5 rounded-full bg-[var(--surface-2)] overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-[width] duration-500 ${
                              pct === 100 ? 'bg-emerald-500' : 'bg-indigo-500'
                            }`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    )}

                    {row.missing.length > 0 && (
                      <p className="mt-3 text-[12.5px] text-[var(--muted)] leading-relaxed">
                        <span className="font-medium">{t.stillNeeded}:</span>{' '}
                        {row.missing.slice(0, 3).join(', ')}
                        {row.missing.length > 3 ? ` +${row.missing.length - 3}` : ''}
                      </p>
                    )}
                  </div>

                  <div className="px-5 py-3 border-t border-[var(--border)] flex flex-wrap items-center gap-x-5 gap-y-2">
                    {row.forms.map((form) => (
                      <a
                        key={form.id}
                        href={`/api/documents/${form.id}`}
                        onClick={(e) => downloadForm(form.id, e)}
                        className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-indigo-500 hover:text-indigo-400 transition-colors no-underline"
                      >
                        <FileDown size={13} />
                        {t.yourForm}
                      </a>
                    ))}

                    <span className="text-[12.5px] text-[var(--muted)]">
                      {row.documents.length} {t.documents}
                    </span>

                    <Link
                      href="/chat"
                      onClick={() => localStorage.setItem('TurkGateway_active_session_id', row.sessionId)}
                      className="ms-auto inline-flex items-center gap-1.5 text-[12.5px] font-medium text-[var(--text)] hover:opacity-70 transition-opacity no-underline"
                    >
                      {t.openChat}
                      <ArrowRight size={13} className={isRTL ? 'rotate-180' : ''} />
                    </Link>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>

        <Footer />
      </main>
    </div>
  );
}
