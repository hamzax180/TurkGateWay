'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Menu } from 'lucide-react';
import Sidebar from './Sidebar';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';

/**
 * Floating menu button for mobile, and — when the page has no drawer of its
 * own — the drawer it opens.
 *
 * The top bar is hidden below `md`, which took the hamburger with it and left
 * most pages with no way to reach navigation on a phone. This puts the trigger
 * back without putting the bar back: it floats over the content instead of
 * occupying a 64px strip that was mostly empty anyway.
 *
 * Two modes, because the pages differ:
 *
 *   <MobileMenuButton onClick={() => setMobileMenuOpen(true)} />
 *       The page already renders its own <Sidebar> and owns the open state —
 *       this draws only the button. Rendering a second Sidebar here would mount
 *       a duplicate session list.
 *
 *   <MobileMenuButton />
 *       The page has no Sidebar (privacy, terms, pricing, download, admin).
 *       This brings its own drawer and manages the open state internally.
 */
export default function MobileMenuButton({ onClick }: { onClick?: () => void }) {
  const [open, setOpen] = useState(false);
  const { token } = useAuth();
  const { t } = useLanguage();
  const router = useRouter();

  const ownsDrawer = !onClick;

  return (
    <>
      <button
        type="button"
        onClick={() => (onClick ? onClick() : setOpen(true))}
        aria-label={t('sidebar_open_menu') || 'Open menu'}
        // Inverted rather than surface-coloured: --surface-1 sits 5/255 away
        // from --bg, so a surface-toned button on these pages was invisible.
        // This is the same treatment the chat send button uses, and it reads in
        // both themes.
        //
        // Bottom-RIGHT, not bottom-left: Next.js renders its dev-tools badge in
        // the bottom-left corner, and it sat directly on top of this button —
        // the button was painted and positioned correctly but unclickable in
        // development. Bottom-right is clear on every page that uses this
        // (the only other fixed-bottom elements are centre-anchored).
        className="md:hidden fixed right-4 z-[80] h-12 w-12 flex items-center justify-center rounded-full
                   bg-[var(--text)] text-[var(--bg)]
                   shadow-[0_8px_24px_rgba(0,0,0,0.28)]
                   active:scale-95 transition-transform"
        // Sits above the iOS home indicator rather than under it.
        style={{ bottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}
      >
        <Menu size={20} />
      </button>

      {ownsDrawer && (
        <Sidebar
          currentSessionId={null}
          assistantType="student"
          onSessionSelect={(id: string) => {
            localStorage.setItem('permitops_active_session_id', id);
            router.push('/chat');
          }}
          onNewChat={() => router.push('/chat')}
          onDeleteSession={() => {}}
          onSwitchAssistant={(type) => {
            localStorage.setItem('permitops_assistant_type', type);
            router.push('/chat');
          }}
          token={token}
          mobileOpen={open}
          onMobileClose={() => setOpen(false)}
          refreshTrigger={0}
          mobileOnly
        />
      )}
    </>
  );
}
