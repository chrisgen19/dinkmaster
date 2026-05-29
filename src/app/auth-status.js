'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useSession, signOut } from '@/lib/auth-client';
import { monogram } from '@/lib/user-insights';

/**
 * Header auth control: shows the signed-in user with a sign-out button, or a
 * sign-in link for guests. Guests can still view the arena — only managing it
 * requires an account.
 */
export function AuthStatus() {
  const { data: session, isPending } = useSession();
  const router = useRouter();

  if (isPending) {
    return <div className="h-9 w-24 rounded-xl bg-slate-100 animate-pulse" />;
  }

  if (!session) {
    return (
      <Link
        href="/login"
        className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white px-3.5 py-2.5 rounded-xl transition-all font-semibold shadow-sm"
      >
        Sign in
      </Link>
    );
  }

  const handleSignOut = async () => {
    await signOut();
    router.refresh();
  };

  const displayName = session.user.name || session.user.email;

  return (
    <div className="flex items-center gap-2">
      <UserMenu name={displayName} />
      <button
        onClick={handleSignOut}
        className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-600 px-3.5 py-2.5 rounded-xl border border-slate-200/60 transition-all font-semibold"
      >
        Sign out
      </button>
    </div>
  );
}

/**
 * Avatar + name trigger that opens a small dropdown (Profile / Settings).
 *
 * Interaction is device-appropriate: on hover-capable pointers (desktop) the
 * menu opens on hover and keyboard focus for convenience; on touch devices it's
 * a plain tap-to-toggle so it doesn't depend on hover that doesn't exist there.
 * Either way it dismisses on Escape and outside-click (and blur-out on desktop).
 *
 * @param {object} props
 * @param {string} props.name - The signed-in user's display name.
 */
function UserMenu({ name }) {
  const [open, setOpen] = useState(false);
  // Default to non-hover so SSR and touch devices get tap-to-toggle by default;
  // upgraded to hover handlers only once we confirm a hover-capable pointer.
  const [canHover, setCanHover] = useState(false);
  const containerRef = useRef(null);
  const initials = monogram(name);

  // Detect hover capability rather than guessing from screen width, so we only
  // wire up hover handlers on devices that actually have a fine, hovering
  // pointer (desktop). Touch devices stay on the tap-to-toggle path.
  useEffect(() => {
    const mql = window.matchMedia('(hover: hover) and (pointer: fine)');
    const update = () => setCanHover(mql.matches);
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, []);

  // Outside-click + Escape dismissal. Only wired up while the menu is open so
  // we're not holding global listeners for every signed-in header.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  // Close when focus leaves the whole control (keyboard tab-out / blur-out).
  const handleBlur = (e) => {
    if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
  };

  // Hover/focus convenience is desktop-only: on touch devices these would fight
  // the click toggle, so we attach them only when a hovering pointer is present.
  const hoverHandlers = canHover
    ? {
        onMouseEnter: () => setOpen(true),
        onMouseLeave: () => setOpen(false),
        onFocus: () => setOpen(true),
        onBlur: handleBlur,
      }
    : {};

  return (
    <div ref={containerRef} className="relative" {...hoverHandlers}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-xl px-1 py-0.5 transition hover:bg-slate-50
          focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/30"
        title="Account menu"
      >
        {/* Initial-monogram avatar — same slate-900 / white treatment as the
            big Monogram tile on /profile, sized down for the header. */}
        <span
          aria-hidden="true"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-slate-900 text-white
            ring-1 ring-slate-200 shadow-sm font-display font-extrabold tracking-tight text-xs"
        >
          {initials}
        </span>
        <span className="hidden sm:block text-xs font-semibold text-slate-600 max-w-[10rem] truncate">
          {name}
        </span>
      </button>

      {open && (
        // Wrapper uses top padding (not margin) so the gap between the trigger
        // and the card stays inside the hoverable area — otherwise the cursor
        // crosses an unhovered void and `onMouseLeave` closes the menu.
        <div className="absolute right-0 top-full z-50 w-44 pt-1.5">
          <div
            role="menu"
            aria-label="Account"
            className="w-full rounded-xl border border-slate-200 bg-white p-1 shadow-lg shadow-slate-900/5"
          >
            <MenuItem href="/profile" label="Profile" />
            <MenuItem href="/profile/settings" label="Settings" />
          </div>
        </div>
      )}
    </div>
  );
}

/** A single dropdown link styled as a menu row. */
function MenuItem({ href, label }) {
  return (
    <Link
      href={href}
      role="menuitem"
      className="block rounded-lg px-3 py-2 text-xs font-semibold text-slate-600 transition
        hover:bg-slate-50 hover:text-emerald-700
        focus:outline-none focus-visible:bg-slate-50 focus-visible:text-emerald-700"
    >
      {label}
    </Link>
  );
}
