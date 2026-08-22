'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Check, CircleDashed, FileDown, Loader2, LogIn, PlayCircle, Upload, X, Zap } from 'lucide-react';
import AutomationViewer from './AutomationViewer';

/**
 * The live document checklist for a service, rendered inline in the chat.
 *
 * The agent names everything the service needs in a single message rather than
 * dragging it out one document per turn, and this is the standing record of
 * that list. Each row turns green the moment its file lands, so the applicant
 * can see at a glance what is done and what is left — and when the last one
 * turns green the application is `ready` and the automation is offered.
 *
 * Upload state is never inferred from what happened in this tab: every action
 * round-trips and the server's checklist status is the only source of truth,
 * so a reload (or a second device) shows exactly what has actually been filed.
 */

export type ChecklistItemStatus = {
  key: string;
  title: string;
  whereToGet: string;
  uploaded: boolean;
  filename: string | null;
  uploadedAt: string | null;
};

export type ChecklistStatus = {
  service: string;
  kind: string;
  items: ChecklistItemStatus[];
  uploadedCount: number;
  total: number;
  complete: boolean;
  status: string;
  applicationId: number | null;
};

/** The initial payload the agent streams — no upload state yet. */
export type ChecklistSeed = {
  service: string;
  agent: string;
  items: { key?: string; title: string; whereToGet: string }[];
};

type Copy = {
  title: string;
  progress: string;
  upload: string;
  uploading: string;
  replace: string;
  remove: string;
  signIn: string;
  signInCta: string;
  complete: string;
  completeBody: string;
  startAutomation: string;
  automationRunning: string;
  automationStarted: string;
  formReady: string;
  needDetails: string;
  runNow: string;
  watching: string;
  reading: string;
  slow: string;
  fillThese: string;
  save: string;
  saving: string;
  failed: string;
};

const COPY: Record<string, Copy> = {
  en: {
    title: 'Documents needed',
    progress: '{done} of {total} uploaded',
    upload: 'Upload',
    uploading: 'Uploading…',
    replace: 'Replace',
    remove: 'Remove',
    signIn: 'Sign in to upload your documents.',
    signInCta: 'Sign in',
    complete: 'All documents received',
    completeBody: 'Everything on this list is in. We can start the application for you now.',
    startAutomation: 'Queued for processing',
    automationRunning: 'Automation running…',
    automationStarted: 'Automation started',
    formReady: 'Your filled application form is ready',
    needDetails: 'Still needed before we can fill your form: {fields}',
    runNow: 'Book my appointment now',
    watching: 'Watch it happen',
    reading: 'Reading your documents…',
    slow: 'This takes up to half a minute the first time.',
    fillThese: 'A few details aren’t printed on any document. Add them and we can book:',
    save: 'Save and continue',
    saving: 'Saving…',
    failed: 'Upload failed',
  },
  tr: {
    title: 'Gerekli belgeler',
    progress: '{total} belgeden {done} tanesi yüklendi',
    upload: 'Yükle',
    uploading: 'Yükleniyor…',
    replace: 'Değiştir',
    remove: 'Kaldır',
    signIn: 'Belgelerinizi yüklemek için giriş yapın.',
    signInCta: 'Giriş yap',
    complete: 'Tüm belgeler alındı',
    completeBody: 'Listedeki her şey tamam. Başvurunuzu şimdi başlatabiliriz.',
    startAutomation: 'İşleme alındı',
    automationRunning: 'Otomasyon çalışıyor…',
    automationStarted: 'Otomasyon başladı',
    formReady: 'Doldurulmuş başvuru formunuz hazır',
    needDetails: 'Formunuzu doldurmadan önce gerekenler: {fields}',
    runNow: 'Randevumu şimdi al',
    watching: 'İzle',
    reading: 'Belgeleriniz okunuyor…',
    slow: 'İlk seferde yarım dakika kadar sürebilir.',
    fillThese: 'Bazı bilgiler hiçbir belgede yazmıyor. Ekleyin, randevuyu alalım:',
    save: 'Kaydet ve devam et',
    saving: 'Kaydediliyor…',
    failed: 'Yükleme başarısız',
  },
  ar: {
    title: 'المستندات المطلوبة',
    progress: 'تم رفع {done} من {total}',
    upload: 'رفع',
    uploading: 'جارٍ الرفع…',
    replace: 'استبدال',
    remove: 'إزالة',
    signIn: 'سجّل الدخول لرفع مستنداتك.',
    signInCta: 'تسجيل الدخول',
    complete: 'تم استلام جميع المستندات',
    completeBody: 'كل ما في القائمة مكتمل. يمكننا بدء طلبك الآن.',
    startAutomation: 'في قائمة المعالجة',
    automationRunning: 'الأتمتة قيد التشغيل…',
    automationStarted: 'بدأت الأتمتة',
    formReady: 'نموذج طلبك المعبأ جاهز',
    needDetails: 'ما زال مطلوباً قبل تعبئة النموذج: {fields}',
    runNow: 'احجز موعدي الآن',
    watching: 'شاهد العملية',
    reading: 'جارٍ قراءة مستنداتك…',
    slow: 'قد يستغرق هذا نصف دقيقة في المرة الأولى.',
    fillThese: 'بعض التفاصيل غير مطبوعة في أي مستند. أضفها لنحجز:',
    save: 'حفظ ومتابعة',
    saving: 'جارٍ الحفظ…',
    failed: 'فشل الرفع',
  },
  tk: {
    title: 'Gerekli resminamalar',
    progress: '{total} resminamadan {done} sanysy ýüklendi',
    upload: 'Ýükle',
    uploading: 'Ýüklenýär…',
    replace: 'Çalyş',
    remove: 'Aýyr',
    signIn: 'Resminamalaryňyzy ýüklemek üçin ulgama giriň.',
    signInCta: 'Giriň',
    complete: 'Ähli resminamalar alyndy',
    completeBody: 'Sanawdaky ähli zat taýýar. Arzaňyzy indi başladyp bileris.',
    startAutomation: 'Gaýtadan işlemek nobatynda',
    automationRunning: 'Awtomatlaşdyrma işleýär…',
    automationStarted: 'Awtomatlaşdyrma başlady',
    formReady: 'Doldurylan arza formaňyz taýýar',
    needDetails: 'Formaňyzy doldurmazdan öň gerek: {fields}',
    runNow: 'Duşuşygymy indi belle',
    watching: 'Syn et',
    reading: 'Resminamalaryňyz okalýar…',
    slow: 'Ilkinji gezek ýarym minuda çenli dowam edip biler.',
    fillThese: 'Käbir maglumatlar hiç bir resminamada ýok. Goşuň, duşuşyk belläli:',
    save: 'Ýatda sakla we dowam et',
    saving: 'Saklanýar…',
    failed: 'Ýükleme şowsuz',
  },
  ru: {
    title: 'Необходимые документы',
    progress: 'загружено {done} из {total}',
    upload: 'Загрузить',
    uploading: 'Загрузка…',
    replace: 'Заменить',
    remove: 'Удалить',
    signIn: 'Войдите в аккаунт, чтобы загрузить документы.',
    signInCta: 'Войти',
    complete: 'Все документы получены',
    completeBody: 'Всё из списка на месте. Мы можем начать оформление вашей заявки.',
    startAutomation: 'В очереди на обработку',
    automationRunning: 'Идёт обработка…',
    automationStarted: 'Обработка запущена',
    formReady: 'Ваша заполненная анкета готова',
    needDetails: 'Ещё нужно, чтобы заполнить анкету: {fields}',
    runNow: 'Записаться на приём',
    watching: 'Смотреть',
    reading: 'Читаем ваши документы…',
    slow: 'В первый раз это занимает до полуминуты.',
    fillThese: 'Некоторых данных нет ни в одном документе. Добавьте их, и мы запишем:',
    save: 'Сохранить и продолжить',
    saving: 'Сохранение…',
    failed: 'Не удалось загрузить',
  },
};

/**
 * Fold a UI language onto one the card has strings for. Kazakh goes to
 * Russian rather than Turkmen — the same Cyrillic-reading logic the document
 * catalogue uses, so the card's chrome and its document names agree.
 */
const BASE_LANG: Record<string, keyof typeof COPY> = {
  az: 'tr',
  uz: 'tk',
  kk: 'ru',
  fa: 'ar',
};

export default function DocumentChecklistCard({
  seed,
  sessionId,
  token,
  language = 'en',
  onComplete,
  onSignIn,
}: {
  seed: ChecklistSeed;
  sessionId: string | null;
  token: string | null;
  language?: string;
  /** Fired once, when the last document lands. */
  onComplete?: (status: ChecklistStatus) => void;
  /** Opens the login modal — guests cannot upload without an account. */
  onSignIn?: () => void;
}) {
  const t = COPY[BASE_LANG[language] ?? (COPY[language] ? language : 'en')] ?? COPY.en;

  const [status, setStatus] = useState<ChecklistStatus | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Server says this service is not paid for — show nothing to upload to. */
  const [locked, setLocked] = useState(false);
  const announced = useRef(false);
  const automating = useRef(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [automation, setAutomation] = useState<{
    started: boolean;
    missing: { key: string; label: string }[];
    form: { documentId: number; filename: string } | null;
  } | null>(null);
  /** What the applicant is typing into the gap-filling form. */
  const [details, setDetails] = useState<Record<string, string>>({});
  const [savingDetails, setSavingDetails] = useState(false);

  const authed = Boolean(token && sessionId && !sessionId.startsWith('guest-'));

  // Pull the real state on mount: the conversation may be reopened long after
  // the agent listed the documents, with some already uploaded.
  //
  // Re-checked on every restore, not only on mount. The browser's back button
  // returns a cached page with React state intact and fires no request, so a
  // card built before the service was paid for would still be sitting there
  // showing its documents. Leaving for the pricing page and pressing Back was
  // enough to read the paid list. `pageshow` fires on a bfcache restore, and
  // visibilitychange covers a tab being returned to.
  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;

    const check = () => {
      const params = new URLSearchParams({ session_id: sessionId, service: seed.service, lang: language });
      fetch(`/api/applications/checklist?${params}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        cache: 'no-store',
      })
        .then(async (r) => {
          if (cancelled) return;
          if (r.status === 402) {
            // Not paid for. Withhold the documents rather than showing a list
            // that cannot be uploaded to.
            setLocked(true);
            setStatus(null);
            return;
          }
          setLocked(false);
          const d = await r.json().catch(() => null);
          if (d?.status) setStatus(d.status);
        })
        .catch(() => {});
    };

    check();
    const onShow = (e: PageTransitionEvent) => { if (e.persisted) check(); };
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    window.addEventListener('pageshow', onShow);
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      window.removeEventListener('pageshow', onShow);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [sessionId, seed.service, language, token]);

  /**
   * The last document landing is the trigger — the applicant should not have
   * to find and press a button to start what they already asked for. Guarded
   * by a ref so a re-render cannot fire it twice.
   */
  // While the documents are being read there is nothing to show but a
  // spinner, and a spinner that never moves reads as a hang. Counting the
  // seconds makes it obvious that it is still working.
  useEffect(() => {
    if (!status?.complete || automation !== null) return;
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [status?.complete, automation]);

  useEffect(() => {
    if (!status?.complete || announced.current) return;
    announced.current = true;
    onComplete?.(status);

    if (!sessionId || !token || automating.current) return;
    automating.current = true;

    fetch('/api/applications/automate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ session_id: sessionId, service: seed.service, lang: language }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setAutomation({ started: Boolean(d.started), missing: d.missing ?? [], form: d.form ?? null });
        if (d.status) setStatus(d.status);
      })
      .catch(() => {
        // The documents are filed and the application is queued regardless;
        // only the confirmation line is lost.
      });
  }, [status, onComplete, sessionId, token, seed.service, language]);

  const upload = useCallback(
    async (key: string, file: File) => {
      if (!key || !sessionId || !token) return;
      setBusyKey(key);
      setError(null);

      const form = new FormData();
      form.append('session_id', sessionId);
      form.append('service', seed.service);
      form.append('item_key', key);
      form.append('lang', language);
      form.append('file', file);

      try {
        const res = await fetch('/api/applications/checklist', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: form,
        });
        const data = await res.json().catch(() => null);
        if (res.ok && data?.status) setStatus(data.status);
        else setError(data?.detail ?? t.failed);
      } catch {
        setError(t.failed);
      } finally {
        setBusyKey(null);
      }
    },
    [sessionId, token, seed.service, language, t.failed],
  );

  /**
   * Save details no document carries — an email address is not printed on a
   * passport, so extraction can never find one.
   */
  const saveDetails = useCallback(async () => {
    if (!sessionId || !token || savingDetails) return;
    const values = Object.fromEntries(
      Object.entries(details).filter(([, v]) => v.trim()),
    );
    if (!Object.keys(values).length) return;

    setSavingDetails(true);
    setError(null);
    try {
      const res = await fetch('/api/applications/details', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ session_id: sessionId, service: seed.service, values }),
      });
      const d = await res.json().catch(() => null);
      if (res.ok) {
        setAutomation((prev) => (prev ? { ...prev, missing: d?.missing ?? [] } : prev));
        setDetails({});
      } else {
        setError(d?.detail ?? t.failed);
      }
    } catch {
      setError(t.failed);
    } finally {
      setSavingDetails(false);
    }
  }, [sessionId, token, seed.service, details, savingDetails, t.failed]);

  /**
   * Open the appointment site on the server and stream it back. This is the
   * no-download path: the applicant watches it fill their form and presses
   * the site's own buttons themselves, through the live view.
   */
  const runAutomation = useCallback(async () => {
    if (!sessionId || !token || starting) return;
    setStarting(true);
    setError(null);
    try {
      const res = await fetch('/api/automation/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ session_id: sessionId }),
      });
      const d = await res.json().catch(() => null);
      if (res.ok && d?.runId) setRunId(d.runId);
      else setError(d?.detail ?? t.failed);
    } catch {
      setError(t.failed);
    } finally {
      setStarting(false);
    }
  }, [sessionId, token, starting, t.failed]);

  const remove = useCallback(
    async (key: string) => {
      if (!sessionId || !token) return;
      setBusyKey(key);
      const params = new URLSearchParams({
        session_id: sessionId,
        service: seed.service,
        item: key,
        lang: language,
      });
      try {
        const res = await fetch(`/api/applications/checklist?${params}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json().catch(() => null);
        if (res.ok && data?.status) {
          announced.current = false;
          setStatus(data.status);
        }
      } catch {
        /* leave the row as it was */
      } finally {
        setBusyKey(null);
      }
    },
    [sessionId, token, seed.service, language],
  );

  // Before the first fetch resolves, render the agent's list with nothing
  // marked — the documents are the point, not the loading state.
  const items: ChecklistItemStatus[] =
    status?.items ??
    seed.items.map((item, i) => ({
      key: item.key ?? `seed-${i}`,
      title: item.title,
      whereToGet: item.whereToGet,
      uploaded: false,
      filename: null,
      uploadedAt: null,
    }));

  const done = status?.uploadedCount ?? 0;
  const total = status?.total ?? items.length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const complete = Boolean(status?.complete);

  // Withheld until the service is paid for. Rendering nothing rather than a
  // locked-looking list: the documents themselves are the product, and a
  // greyed-out list still tells you what they are.
  if (locked) return null;

  return (
    <>
      {runId && <AutomationViewer runId={runId} token={token} onClose={() => setRunId(null)} />}

    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.2, 0.8, 0.2, 1] }}
      className="my-3 rounded-2xl border border-[var(--border)] bg-[var(--surface-1)] overflow-hidden"
    >
      {/* Heading + progress */}
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-center justify-between gap-3 mb-2">
          <h4 className="text-[14px] font-bold text-[var(--text)]">{t.title}</h4>
          <span className="text-[12px] font-medium text-[var(--muted)] shrink-0 tabular-nums">
            {t.progress.replace('{done}', String(done)).replace('{total}', String(total))}
          </span>
        </div>
        <div
          className="h-1.5 rounded-full bg-[var(--surface-2)] overflow-hidden"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <motion.div
            className={`h-full rounded-full ${complete ? 'bg-emerald-500' : 'bg-indigo-500'}`}
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.5, ease: [0.2, 0.8, 0.2, 1] }}
          />
        </div>
      </div>

      {/* The documents themselves */}
      <ul className="divide-y divide-[var(--border)]">
        {items.map((item) => {
          const busy = busyKey === item.key;
          return (
            <li key={item.key} className="flex items-start gap-2.5 px-4 py-3">
              {item.uploaded ? (
                <Check size={15} className="mt-[3px] shrink-0 text-emerald-500" />
              ) : (
                <CircleDashed size={15} className="mt-[3px] shrink-0 text-[var(--muted)]" />
              )}

              <div className="min-w-0 flex-1">
                {/* Green title is the whole point of the card — one glance
                    tells the applicant which papers are already with us. */}
                <p
                  className={`text-[13px] leading-snug ${
                    item.uploaded
                      ? 'font-semibold text-emerald-600 dark:text-emerald-400'
                      : 'text-[var(--text)]'
                  }`}
                >
                  {item.title}
                </p>
                <p className="text-[11.5px] leading-snug text-[var(--muted)] mt-0.5">
                  {item.uploaded && item.filename ? item.filename : item.whereToGet}
                </p>
              </div>

              {authed && (
                <div className="shrink-0 flex items-center gap-2 pt-0.5">
                  {busy ? (
                    <Loader2 size={14} className="animate-spin text-indigo-500" />
                  ) : (
                    <>
                      {/* Each row owns its input, so the file carries which
                          document it is. A single shared input needed a mutable
                          ref to remember the row, which broke whenever the two
                          got out of step. */}
                      <label
                        className={`flex items-center gap-1.5 cursor-pointer transition-colors ${
                          item.uploaded
                            ? 'text-[11.5px] font-medium text-[var(--muted)] hover:text-[var(--text)]'
                            : 'text-[11.5px] font-semibold text-indigo-500 hover:text-indigo-400'
                        }`}
                      >
                        {!item.uploaded && <Upload size={12} />}
                        {item.uploaded ? t.replace : t.upload}
                        <input
                          type="file"
                          accept="application/pdf,image/jpeg,image/png"
                          className="sr-only"
                          data-checklist-item={item.key}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            e.target.value = '';
                            setError(null);
                            if (file) upload(item.key, file);
                          }}
                        />
                      </label>

                      {item.uploaded && (
                        <button
                          onClick={() => remove(item.key)}
                          aria-label={t.remove}
                          className="text-[var(--muted)] hover:text-red-500 transition-colors cursor-pointer"
                        >
                          <X size={13} />
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {/* Guests see the full list — it is useful on its own — but uploading
          needs an account, so say so here with a way to act on it rather than
          letting them find out by clicking Upload and failing. */}
      {!authed && (
        <div className="px-4 py-3 border-t border-[var(--border)] flex flex-wrap items-center gap-x-3 gap-y-2">
          <LogIn size={14} className="text-[var(--muted)] shrink-0" />
          <p className="text-[12px] text-[var(--muted)] flex-1 min-w-[12rem]">{t.signIn}</p>
          {onSignIn && (
            <button
              onClick={onSignIn}
              className="rounded-full bg-[var(--text)] px-3.5 py-1.5 text-[11.5px] font-semibold text-[var(--bg)] hover:opacity-90 transition-opacity cursor-pointer shrink-0"
            >
              {t.signInCta}
            </button>
          )}
        </div>
      )}

      {error && (
        <p className="px-4 py-2.5 border-t border-[var(--border)] text-[12px] text-red-500">{error}</p>
      )}

      {/* Finish state — every row green, application promoted to `ready`. */}
      {complete && (
        <div className="border-t border-[var(--border)] bg-emerald-500/5 px-4 py-4">
          {/* One clear heading, one line of explanation, one action. The old
              layout stacked a status pill, a red button and a blue download
              link side by side — three competing things, none obviously the
              next step. Status is now a quiet line above the action. */}
          <div className="flex items-center gap-2">
            <Check size={15} className="text-emerald-500 shrink-0" />
            <p className="text-[13.5px] font-semibold text-emerald-600 dark:text-emerald-400">
              {t.complete}
            </p>
          </div>

          <p className="mt-1 ps-[23px] text-[12.5px] leading-relaxed text-[var(--muted)]">
            {t.completeBody}
          </p>

          <div className="mt-3 ps-[23px]">
            {/* What the system is doing right now, stated plainly. */}
            {status?.status === 'in_progress' ? (
              <p className="flex items-center gap-2 text-[12px] font-medium text-indigo-500">
                <Loader2 size={13} className="animate-spin" />
                {t.automationRunning}
              </p>
            ) : automation === null ? (
              <p className="flex items-center gap-2 text-[12px] font-medium text-[var(--muted)]">
                <Loader2 size={13} className="animate-spin" />
                {t.reading}
                {elapsed > 2 && <span className="tabular-nums opacity-70">{elapsed}s</span>}
              </p>
            ) : automation.missing.length === 0 ? (
              <p className="flex items-center gap-1.5 text-[12px] font-medium text-emerald-600 dark:text-emerald-400">
                <Zap size={12} />
                {automation.started ? t.automationStarted : t.startAutomation}
              </p>
            ) : null}

            {automation === null && elapsed > 8 && (
              <p className="mt-1 text-[11.5px] text-[var(--muted)]">{t.slow}</p>
            )}
          </div>

            {/* Documents are in, but the form still needs answers no scan
                could supply. Ask for them here rather than naming them and
                leaving the applicant with nowhere to type. */}
            {automation && automation.missing.length > 0 && (
              <div className="w-full">
                <p className="text-[12px] text-[var(--muted)] leading-relaxed mb-2">{t.fillThese}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {automation.missing.map((field) => (
                    <input
                      key={field.key}
                      value={details[field.key] ?? ''}
                      onChange={(e) => setDetails((d) => ({ ...d, [field.key]: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveDetails();
                      }}
                      placeholder={field.label}
                      className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[13px] text-[var(--text)] placeholder:text-[var(--muted)] focus:outline-none focus:border-[var(--border-2)] transition-colors"
                    />
                  ))}
                </div>
                <button
                  onClick={saveDetails}
                  disabled={savingDetails || !Object.values(details).some((v) => v.trim())}
                  className="mt-2.5 inline-flex items-center gap-1.5 rounded-full bg-[var(--text)] px-4 py-2 text-[12px] font-medium text-[var(--bg)] hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  {savingDetails && <Loader2 size={12} className="animate-spin" />}
                  {savingDetails ? t.saving : t.save}
                </button>
              </div>
            )}

            {/* The last step, and the only one that leaves the site. Shown once
                nothing is outstanding, so it never appears as a button that
                immediately refuses. Only the visa appointment has a bookable
                site wired up; other services are worked from the queue. */}
            {seed.service === 'student_visa' &&
              automation?.started &&
              automation.missing.length === 0 && (
                <button
                  onClick={runAutomation}
                  disabled={starting}
                  className="mt-3 inline-flex items-center gap-2 rounded-full bg-red-600 px-5 py-2.5 text-[12.5px] font-semibold text-white hover:bg-red-700 transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {starting ? <Loader2 size={13} className="animate-spin" /> : <PlayCircle size={14} />}
                  {t.runNow}
                </button>
              )}
        </div>
      )}
    </motion.div>
    </>
  );
}
