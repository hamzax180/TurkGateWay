'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, Mail, MousePointerClick, Square, X } from 'lucide-react';

/**
 * The applicant watching their own application being filled in.
 *
 * The browser runs on the server, so this is a live picture of it rather than
 * a window on their machine — which is what makes it work with no download.
 *
 * The important part is that the picture is CLICKABLE. The automation types
 * their details and stops; every button on that site is pressed by the person
 * here, clicking where they want, and the coordinate is forwarded to the real
 * page. Nothing is submitted on their behalf.
 *
 * The same panel serves the visa appointment and e-İkamet. İkamet adds one
 * thing: the portal mails a one-time verification link, and it has to be
 * followed in THIS browser, because the session it belongs to is the one on
 * screen. So there is a box to paste it into.
 */

type RunState = {
  id: string;
  portal?: 'visa' | 'ikamet';
  status:
    | 'starting'
    | 'searching'
    | 'filling'
    | 'waiting_for_you'
    | 'waiting_for_email_link'
    | 'finished'
    | 'failed';
  events: { at: number; text: string }[];
  filled: string[];
  error: string | null;
  viewport: { width: number; height: number };
  frameAt: number;
  frame: string | null;
  emailSentTo?: string | null;
};

const STATUS_COPY: Record<string, { label: string; tone: string }> = {
  starting: { label: 'Starting the browser…', tone: 'text-[var(--muted)]' },
  searching: { label: 'Finding the earliest appointment…', tone: 'text-indigo-500' },
  filling: { label: 'Filling your details…', tone: 'text-indigo-500' },
  waiting_for_you: { label: 'Your turn — review and click', tone: 'text-amber-600 dark:text-amber-400' },
  waiting_for_email_link: {
    label: 'Waiting for your e-mail verification link',
    tone: 'text-amber-600 dark:text-amber-400',
  },
  finished: { label: 'Finished', tone: 'text-emerald-600 dark:text-emerald-400' },
  failed: { label: 'Stopped', tone: 'text-red-500' },
};

export default function AutomationViewer({
  runId,
  token,
  title = 'Your visa appointment',
  onClose,
}: {
  runId: string;
  token: string | null;
  title?: string;
  onClose: () => void;
}) {
  const [run, setRun] = useState<RunState | null>(null);
  const [frame, setFrame] = useState<string | null>(null);
  const [link, setLink] = useState('');
  const [linkError, setLinkError] = useState<string | null>(null);
  const [sendingLink, setSendingLink] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const sinceRef = useRef(0);
  const stopped = useRef(false);
  /**
   * Lets a click force the next poll immediately instead of waiting out the
   * back-off. Frames only arrive when Chrome repaints, so after an action the
   * interesting frame exists within milliseconds — waiting up to 400ms for the
   * timer is what made interaction feel sluggish.
   */
  const pokeRef = useRef<() => void>(() => {});

  /**
   * Chase the newest frame rather than sampling on a fixed timer.
   *
   * A 900ms interval threw away most of what the screencast produced and made
   * typing arrive in visible jumps. This asks for the next frame as soon as
   * the last one lands, and `since` means an unchanged page answers in a few
   * bytes instead of a fresh JPEG — so an idle page is nearly free and an
   * active one streams as fast as the connection allows.
   */
  useEffect(() => {
    if (!token) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      if (!alive || stopped.current) return;
      let gap = 120;
      try {
        const res = await fetch(`/api/automation/${runId}?since=${sinceRef.current}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        });
        if (res.ok) {
          const d: RunState = await res.json();
          if (!alive) return;
          setRun(d);
          if (d.frame) {
            setFrame(d.frame);
            sinceRef.current = d.frameAt;
          } else {
            // Nothing repainted — ease off so an idle form is not hammered.
            gap = 400;
          }
          if (d.status === 'finished' || d.status === 'failed') stopped.current = true;
        } else {
          gap = 1000;
        }
      } catch {
        gap = 1000;
      }
      if (alive && !stopped.current) timer = setTimeout(tick, gap);
    };

    // Cancel the pending wait and go now.
    pokeRef.current = () => {
      if (!alive || stopped.current) return;
      clearTimeout(timer);
      tick();
    };

    tick();
    return () => {
      alive = false;
      pokeRef.current = () => {};
      clearTimeout(timer);
    };
  }, [runId, token]);

  /** Translate a click on the picture into a click on the real page. */
  const handleClick = useCallback(
    async (e: React.MouseEvent<HTMLImageElement>) => {
      if (!token || !run || !imgRef.current) return;
      const rect = imgRef.current.getBoundingClientRect();
      // The image is scaled to fit; map back to the page's own coordinates.
      const x = ((e.clientX - rect.left) / rect.width) * run.viewport.width;
      const y = ((e.clientY - rect.top) / rect.height) * run.viewport.height;

      // Reset `since` so the very next poll returns a frame even if the
      // timestamp has not moved yet — the click should look instant.
      sinceRef.current = 0;
      await fetch(`/api/automation/${runId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ type: 'click', x, y }),
      }).catch(() => {});
      pokeRef.current();
    },
    [runId, token, run],
  );

  const handleKey = useCallback(
    async (e: React.KeyboardEvent) => {
      if (!token) return;
      const special = ['Enter', 'Tab', 'Backspace', 'ArrowLeft', 'ArrowRight', 'Escape'];
      if (special.includes(e.key)) {
        e.preventDefault();
        await fetch(`/api/automation/${runId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ type: 'key', key: e.key }),
        }).catch(() => {});
        sinceRef.current = 0;
        pokeRef.current();
      } else if (e.key.length === 1) {
        e.preventDefault();
        await fetch(`/api/automation/${runId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ type: 'type', text: e.key }),
        }).catch(() => {});
        sinceRef.current = 0;
        pokeRef.current();
      }
    },
    [runId, token],
  );

  /**
   * Hand over the verification link.
   *
   * Sent as a URL rather than typed into the page, because the applicant is
   * reading it in their e-mail somewhere else entirely and the streamed browser
   * has no address bar of its own. The server decides whether it is a portal
   * link — this only reports back what it said.
   */
  const submitLink = useCallback(async () => {
    if (!token || sendingLink || !link.trim()) return;
    setSendingLink(true);
    setLinkError(null);
    try {
      const res = await fetch(`/api/automation/${runId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ type: 'link', url: link.trim() }),
      });
      if (res.ok) {
        setLink('');
        sinceRef.current = 0;
        pokeRef.current();
      } else {
        const d = await res.json().catch(() => null);
        setLinkError(d?.detail ?? 'That link could not be opened.');
      }
    } catch {
      setLinkError('That link could not be sent. Check your connection and try again.');
    } finally {
      setSendingLink(false);
    }
  }, [runId, token, link, sendingLink]);

  const stop = useCallback(async () => {
    stopped.current = true;
    await fetch(`/api/automation/${runId}`, {
      method: 'DELETE',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    }).catch(() => {});
    onClose();
  }, [runId, token, onClose]);

  const status = STATUS_COPY[run?.status ?? 'starting'] ?? STATUS_COPY.starting;
  const busy = run?.status === 'starting' || run?.status === 'searching' || run?.status === 'filling';

  // Portalled to <body> on purpose. This renders inside a chat message, and
  // framer-motion puts a `transform` on the message wrapper — which makes a
  // `position: fixed` child scope to that ancestor and traps its z-index
  // inside it. The chat's own input bar and mode pill then sat on top of the
  // live view and swallowed the clicks meant for the visa form.
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-5xl max-h-full flex flex-col rounded-2xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border)]">
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-semibold text-[var(--text)]">{title}</p>
            <p className={`text-[12px] flex items-center gap-1.5 ${status.tone}`}>
              {busy && <Loader2 size={11} className="animate-spin" />}
              {status.label}
            </p>
          </div>
          <button
            onClick={stop}
            className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-2)] px-3 py-1.5 text-[12px] font-medium text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors cursor-pointer"
          >
            <Square size={11} />
            Stop
          </button>
          <button
            onClick={onClose}
            aria-label="Close"
            className="h-8 w-8 rounded-lg border border-[var(--border)] flex items-center justify-center text-[var(--muted)] hover:text-[var(--text)] cursor-pointer"
          >
            <X size={15} />
          </button>
        </div>

        {/* The page itself */}
        <div
          className="relative flex-1 min-h-0 bg-[var(--surface-2)] flex items-center justify-center overflow-auto outline-none"
          tabIndex={0}
          onKeyDown={handleKey}
        >
          {frame ? (
            <img
              ref={imgRef}
              src={`data:image/jpeg;base64,${frame}`}
              alt="Live view of your appointment form"
              onClick={handleClick}
              // decoding=sync avoids the blank flash the browser otherwise
              // shows while decoding each replacement frame.
              decoding="sync"
              className="max-w-full max-h-full cursor-crosshair select-none [image-rendering:auto]"
              draggable={false}
            />
          ) : (
            <div className="flex flex-col items-center gap-3 py-20 text-[var(--muted)]">
              <Loader2 size={22} className="animate-spin" />
              <p className="text-[13px]">Opening the appointment site…</p>
            </div>
          )}
        </div>

        {/* What it is doing, and whose move it is */}
        <div className="border-t border-[var(--border)] px-4 py-3">
          {/* The e-mail gate. COPY, don't click, is the whole instruction: the
              link works once, and only in this browser — the session it belongs
              to is the one on screen, not the one on their phone. */}
          {run?.status === 'waiting_for_email_link' && (
            <div className="mb-3 rounded-xl border border-amber-500/40 bg-amber-500/5 px-3 py-3">
              <p className="flex items-center gap-2 text-[12.5px] font-semibold text-amber-700 dark:text-amber-400">
                <Mail size={13} className="shrink-0" />
                Verification link needed
                {run.emailSentTo && <span className="font-normal opacity-80">— sent to {run.emailSentTo}</span>}
              </p>
              <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--muted)]">
                Open that e-mail and <span className="font-semibold text-[var(--text)]">copy the link — do not click it</span>.
                It only works once, and it has to be opened here, in the browser holding your application. Keep this panel open.
              </p>
              <div className="mt-2.5 flex gap-2">
                <input
                  value={link}
                  onChange={(e) => setLink(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submitLink();
                    // The panel forwards keystrokes to the portal; this box is
                    // ours, so its typing must stop here.
                    e.stopPropagation();
                  }}
                  placeholder="https://e-ikamet.goc.gov.tr/…"
                  spellCheck={false}
                  autoComplete="off"
                  className="flex-1 min-w-0 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[12.5px] text-[var(--text)] placeholder:text-[var(--muted)] focus:outline-none focus:border-[var(--border-2)]"
                />
                <button
                  onClick={submitLink}
                  disabled={sendingLink || !link.trim()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--text)] px-4 py-2 text-[12.5px] font-medium text-[var(--bg)] hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shrink-0"
                >
                  {sendingLink && <Loader2 size={12} className="animate-spin" />}
                  Continue
                </button>
              </div>
              {linkError && <p className="mt-1.5 text-[11.5px] text-red-500">{linkError}</p>}
              <p className="mt-1.5 text-[11.5px] text-[var(--muted)]">
                Already clicked it? Press <span className="font-medium">Tekrar Gönder / Resend</span> on the page above, then copy the new one.
              </p>
            </div>
          )}

          <div className="flex items-start gap-2 text-[12px] text-[var(--muted)] mb-2">
            <MousePointerClick size={13} className="mt-0.5 shrink-0 text-[var(--text)]" />
            <p className="leading-relaxed">
              Your details are typed in for you. <span className="font-medium text-[var(--text)]">Every button is yours to press</span> — click
              directly on the page above, exactly as you would on the real site. Nothing is submitted for you.
            </p>
          </div>

          <div className="max-h-24 overflow-y-auto slim-scroll space-y-1">
            {run?.events
              .slice()
              .reverse()
              .slice(0, 6)
              .map((ev) => (
                <p key={ev.at + ev.text} className="text-[11.5px] text-[var(--muted)]">
                  {ev.text}
                </p>
              ))}
            {run?.error && <p className="text-[11.5px] text-red-500">{run.error}</p>}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
