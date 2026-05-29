'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
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
  // Portal target (document.body) only exists after mount; gate the mobile
  // sheet's portal on this so the server render and first client render agree.
  const [mounted, setMounted] = useState(false);
  const containerRef = useRef(null);
  const initials = monogram(name);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot mount flag so createPortal only runs client-side (document.body is unavailable during SSR)
  useEffect(() => setMounted(true), []);

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
  //
  // The global pointerdown check relies on `containerRef.contains`, which works
  // for the desktop dropdown (it lives inside containerRef) but NOT for the
  // mobile bottom sheet — that's portaled to <body>, so every tap inside it
  // would read as "outside" and close it mid-interaction. The sheet brings its
  // own dismissal instead (explicit backdrop onClick + the shared Escape
  // handler), so only attach the outside-pointer check on the desktop path.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);

    let cleanupPointer;
    if (canHover) {
      const onPointerDown = (e) => {
        if (containerRef.current && !containerRef.current.contains(e.target)) {
          setOpen(false);
        }
      };
      document.addEventListener('pointerdown', onPointerDown);
      cleanupPointer = () =>
        document.removeEventListener('pointerdown', onPointerDown);
    }

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      cleanupPointer?.();
    };
  }, [open, canHover]);

  // Lock background scroll while the mobile sheet is open so the page behind
  // the scrim doesn't scroll under the user's thumb. Desktop dropdown is small
  // and hover-driven, so it's left untouched.
  useEffect(() => {
    if (!open || canHover) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open, canHover]);

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

      {/* Desktop (hover-capable): the original compact dropdown card, unchanged. */}
      {canHover && open && (
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

      {/* Mobile (touch / no-hover): a full-width bottom sheet, portaled to
          <body> so no ancestor overflow/transform can clip the fixed panel. */}
      {!canHover &&
        mounted &&
        createPortal(
          <MobileMenuSheet
            open={open}
            name={name}
            initials={initials}
            onClose={() => setOpen(false)}
          />,
          document.body,
        )}
    </div>
  );
}

/**
 * Touch-friendly account menu rendered as a bottom sheet. Distinct from the
 * desktop dropdown: full-width rows, a header showing who's signed in, and a
 * tap-the-backdrop / Escape dismissal. Slides up via `motion` (already a dep).
 *
 * @param {object} props
 * @param {boolean} props.open - Whether the sheet is visible.
 * @param {string} props.name - The signed-in user's display name.
 * @param {string} props.initials - Monogram for the avatar tile.
 * @param {() => void} props.onClose - Dismiss the sheet.
 */
function MobileMenuSheet({ open, name, initials, onClose }) {
  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop — explicit onClick so tapping outside the panel closes
              the sheet even though it lives outside the trigger's subtree. */}
          <motion.div
            aria-hidden="true"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-[2px]"
          />
          <motion.div
            role="menu"
            aria-label="Account"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 380, damping: 38 }}
            className="fixed inset-x-0 bottom-0 z-50 bg-white rounded-t-2xl pt-3
              pb-[max(1rem,env(safe-area-inset-bottom))]
              shadow-[0_-20px_50px_-12px_rgba(15,23,42,0.25)]"
          >
            {/* Grab-handle affordance. */}
            <div
              aria-hidden="true"
              className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-slate-200"
            />

            {/* Who's signed in — name is hidden in the trigger on small screens,
                so surface it here. */}
            <div className="flex items-center gap-3 px-5 pb-3">
              <span
                aria-hidden="true"
                className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-slate-900
                  text-white ring-1 ring-slate-200 shadow-sm font-display font-extrabold
                  tracking-tight text-sm"
              >
                {initials}
              </span>
              <span className="min-w-0 truncate text-base font-bold text-slate-800">
                {name}
              </span>
            </div>

            <div className="h-px bg-slate-100" />

            <nav className="px-3 pt-2">
              <SheetItem href="/profile" label="Profile" onSelect={onClose} />
              <SheetItem
                href="/profile/settings"
                label="Settings"
                onSelect={onClose}
              />
            </nav>
          </motion.div>
        </>
      )}
    </AnimatePresence>
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

/**
 * Large full-width touch row for the mobile bottom sheet. Navigating unmounts
 * the sheet, but we also call `onSelect` on tap so it closes promptly even if
 * the route doesn't change.
 */
function SheetItem({ href, label, onSelect }) {
  return (
    <Link
      href={href}
      role="menuitem"
      onClick={onSelect}
      className="flex min-h-[48px] items-center rounded-xl px-4 py-3 text-base font-semibold
        text-slate-700 transition active:bg-slate-100
        focus:outline-none focus-visible:bg-slate-100 focus-visible:text-emerald-700"
    >
      {label}
    </Link>
  );
}
