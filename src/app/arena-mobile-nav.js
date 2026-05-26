'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import useEmblaCarousel from 'embla-carousel-react';
import { AnimatePresence, motion, useDragControls } from 'motion/react';
import { TabIcon, TabBadge as Badge } from './arena-tab-icons';

/**
 * Mobile horizontal tab strip. Embla gives us momentum scrolling and a
 * snap-into-view animation when the active tab changes from anywhere (the
 * bottom sheet, a content swipe, or a direct tap on a pill).
 *
 * Stays in DOM order under the SiteHeader so the page header → strip → content
 * reading order matches the visual order. Hidden at `md` and above.
 */
function ArenaMobileTabStrip({ navTabs, activeTab, onSelectTab }) {
  const [emblaRef, emblaApi] = useEmblaCarousel({
    dragFree: true,
    containScroll: 'trimSnaps',
    align: 'center',
  });

  // The parent rebuilds `navTabs` on every render, so depending on it directly
  // would re-snap the strip on every Arena state change (court updates, score
  // changes, queue shuffles) — interrupting a user mid-scrub. Depend on a
  // stable string of tab ids instead, so the scroll only fires when the
  // active tab changes or the tab set actually changes (e.g. `mystats`
  // appearing once `myPlayer` is linked).
  const navTabIds = navTabs.map((t) => t.id).join('|');
  useEffect(() => {
    if (!emblaApi) return;
    const ids = navTabIds.split('|');
    const idx = ids.indexOf(activeTab);
    if (idx >= 0) emblaApi.scrollTo(idx);
  }, [emblaApi, activeTab, navTabIds]);

  return (
    <div
      className="md:hidden sticky top-[var(--site-header-h,64px)] z-30
        bg-slate-50/85 backdrop-blur-md border-b border-slate-200/70"
    >
      <div ref={emblaRef} className="overflow-hidden">
        <div className="flex gap-2 px-3 py-2.5">
          {navTabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => onSelectTab(tab.id)}
                aria-pressed={isActive}
                className={`relative shrink-0 inline-flex items-center gap-2 rounded-full
                  px-3.5 py-2 text-[13px] font-bold tracking-tight transition
                  ${isActive
                    ? 'bg-slate-900 text-white shadow-sm shadow-slate-900/20'
                    : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:text-slate-900'
                  }`}
              >
                <TabIcon
                  id={tab.id}
                  className={`w-[18px] h-[18px] ${isActive ? 'text-emerald-300' : 'text-slate-400'}`}
                />
                <span>{tab.label}</span>
                <Badge value={tab.badge} active={isActive} />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/**
 * Mobile bottom sheet — primary navigation. A persistent pill sits in the
 * thumb zone showing the current tab; tapping it opens a bottom sheet with the
 * full tab list.
 *
 * Built on `motion` rather than vaul: vaul's drawer fails to isolate pointer
 * events in an iOS standalone PWA (taps inside the open sheet don't register),
 * which made the menu unusable once installed to the home screen — see
 * vaul#505 / shadcn-ui#8507. This hand-rolled sheet does the same job (slide-up
 * + overlay, drag-to-dismiss via the handle, body-scroll lock, focus trap,
 * Escape-to-close) with plain buttons that respond to taps reliably everywhere.
 *
 * Hidden at `md` and above where the desktop tablist takes over.
 */
function ArenaMobileSheet({ navTabs, activeTab, activeTabLabel, onSelectTab }) {
  const [open, setOpen] = useState(false);
  const sheetRef = useRef(null);
  const triggerRef = useRef(null);
  const dragControls = useDragControls();
  const titleId = useId();
  const descId = useId();

  const close = useCallback(() => setOpen(false), []);
  const handleSelect = useCallback((id) => {
    onSelectTab(id);
    setOpen(false);
  }, [onSelectTab]);

  // The desktop tablist takes over at `md`, so a sheet left open while the
  // viewport crosses 768px (tablet rotation, desktop dev-tools resize) would
  // strand its overlay and scroll-lock over the desktop layout. Close it as
  // soon as the desktop breakpoint matches.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia('(min-width: 768px)');
    const update = () => { if (mql.matches) setOpen(false); };
    update();
    mql.addEventListener?.('change', update);
    return () => mql.removeEventListener?.('change', update);
  }, []);

  // While open: lock body scroll, trap focus inside the sheet, close on
  // Escape, and restore focus to the trigger on close. Mirrors the affordances
  // vaul gave us for free.
  useEffect(() => {
    if (!open) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Capture the trigger now so the cleanup restores focus to the element that
    // was present when the sheet opened, not whatever the ref holds later.
    const trigger = triggerRef.current;

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
        return;
      }
      if (e.key !== 'Tab' || !sheetRef.current) return;
      // Minimal focus trap: keep Tab/Shift+Tab cycling within the sheet.
      const focusable = sheetRef.current.querySelectorAll(
        'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);

    // Move focus into the sheet once it's mounted.
    const raf = requestAnimationFrame(() => {
      sheetRef.current?.querySelector('[data-autofocus]')?.focus();
    });

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
      cancelAnimationFrame(raf);
      // Return focus to the pill so keyboard users aren't dropped at the top.
      trigger?.focus();
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Switch arena view (current: ${activeTabLabel})`}
        className="md:hidden fixed bottom-4 left-1/2 -translate-x-1/2 z-40
          flex items-center gap-3 pl-4 pr-5 py-3 rounded-full
          bg-slate-900 text-white shadow-xl shadow-slate-900/30
          ring-1 ring-white/10 active:scale-[0.98] transition"
      >
        <TabIcon id={activeTab} className="w-5 h-5 text-emerald-300" />
        <span className="font-display font-extrabold tracking-tight text-sm">
          {activeTabLabel}
        </span>
        <motion.span
          aria-hidden="true"
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
          className="inline-flex"
        >
          <svg className="w-4 h-4 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </motion.span>
      </button>

      <AnimatePresence>
        {open && (
          <>
            <motion.div
              key="overlay"
              aria-hidden="true"
              onClick={close}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="md:hidden fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-[2px]"
            />
            <motion.div
              key="sheet"
              ref={sheetRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              aria-describedby={descId}
              tabIndex={-1}
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', stiffness: 380, damping: 38 }}
              // Drag-to-dismiss is started only from the handle (below) so a tap
              // on a nav button never gets read as a drag — the failure mode we
              // are deliberately leaving behind with vaul.
              drag="y"
              dragListener={false}
              dragControls={dragControls}
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={{ top: 0, bottom: 0.5 }}
              onDragEnd={(_e, info) => {
                if (info.offset.y > 120 || info.velocity.y > 500) close();
              }}
              className="md:hidden fixed bottom-0 left-0 right-0 z-50 outline-none
                bg-white rounded-t-[28px]
                shadow-[0_-20px_50px_-12px_rgba(15,23,42,0.25)]"
            >
              {/* Drag handle — the only drag-initiating surface. */}
              <div
                onPointerDown={(e) => dragControls.start(e)}
                className="touch-none cursor-grab pt-3 pb-1 active:cursor-grabbing"
              >
                <div className="mx-auto h-1.5 w-12 rounded-full bg-slate-200" aria-hidden="true" />
              </div>
              <h2 id={titleId} className="sr-only">Arena views</h2>
              <p id={descId} className="sr-only">
                Pick which arena view to show. The current view is {activeTabLabel}.
              </p>
              <div className="px-4 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))]">
                <p className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400 px-2 mb-2">
                  Arena views
                </p>
                <nav className="space-y-1">
                  {navTabs.map((tab, index) => {
                    const isActive = activeTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => handleSelect(tab.id)}
                        aria-pressed={isActive}
                        data-autofocus={index === 0 ? '' : undefined}
                        className={`w-full flex items-center gap-3 px-3 py-3.5 rounded-2xl
                          text-left transition
                          ${isActive
                            ? 'bg-slate-900 text-white shadow-md shadow-slate-900/20'
                            : 'text-slate-700 hover:bg-slate-100 active:bg-slate-100'
                          }`}
                      >
                        <span className={`shrink-0 grid place-items-center w-9 h-9 rounded-xl ${
                          isActive ? 'bg-white/10 text-emerald-300' : 'bg-slate-100 text-slate-500'
                        }`}>
                          <TabIcon id={tab.id} className="w-5 h-5" />
                        </span>
                        <span className="flex-1 font-display font-extrabold tracking-tight text-[15px]">
                          {tab.label}
                        </span>
                        <Badge value={tab.badge} active={isActive} />
                        {isActive && (
                          <span className="text-[10px] font-extrabold uppercase tracking-widest text-emerald-300">
                            Open
                          </span>
                        )}
                      </button>
                    );
                  })}
                </nav>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

/**
 * Mobile navigation composed of two complementary surfaces:
 *
 * 1. A sticky horizontal tab strip just under the SiteHeader (always visible,
 *    swipe to scrub through tabs, tap to switch).
 * 2. A floating "current view" pill above the thumb zone that opens a vaul
 *    bottom sheet with the full tab list, descriptions, and badges.
 *
 * Both write to the same `onSelectTab` callback, so the parent owns the
 * single source of truth for `activeTab`.
 */
export function ArenaMobileNav({ navTabs, activeTab, activeTabLabel, onSelectTab }) {
  return (
    <>
      <ArenaMobileTabStrip
        navTabs={navTabs}
        activeTab={activeTab}
        onSelectTab={onSelectTab}
      />
      <ArenaMobileSheet
        navTabs={navTabs}
        activeTab={activeTab}
        activeTabLabel={activeTabLabel}
        onSelectTab={onSelectTab}
      />
    </>
  );
}

/**
 * Track a `matchMedia` query as boolean state. SSR-safe (returns false until
 * mounted) and cleans up its own listener.
 */
function useMatchMedia(query) {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    const update = () => setMatches(mql.matches);
    update();
    mql.addEventListener?.('change', update);
    return () => mql.removeEventListener?.('change', update);
  }, [query]);
  return matches;
}

/**
 * Decide whether a swipe gesture starting at `start` should be ignored —
 * i.e., let the browser handle the touch natively instead of treating it as
 * a tab-change drag. Walks up from `start` to (but not past) `boundary` and
 * returns true if:
 *
 * - The touch lands inside a form control or `contenteditable` (typing or
 *   pointer-selecting text should never flip tabs).
 * - The touch lands inside a dialog (in-tab modals own their own gestures).
 * - The author opted out explicitly via `data-swipe-ignore`.
 * - An ancestor is an actually-scrollable container (horizontal OR vertical).
 *   The Partnership Matrix table scrolls horizontally; the Match Log and My
 *   Stats lists scroll vertically — in both cases the user's intent is to
 *   scroll that region, not change tabs.
 */
function shouldIgnoreSwipeStart(start, boundary) {
  if (!(start instanceof Element)) return false;
  if (
    start.closest(
      'input, textarea, select, [contenteditable="true"], dialog, [role="dialog"], [data-swipe-ignore]'
    )
  ) {
    return true;
  }

  let el = start;
  while (el && el !== boundary && el.nodeType === 1) {
    const style = window.getComputedStyle(el);
    const canScrollX =
      (style.overflowX === 'auto' || style.overflowX === 'scroll') &&
      el.scrollWidth > el.clientWidth;
    const canScrollY =
      (style.overflowY === 'auto' || style.overflowY === 'scroll') &&
      el.scrollHeight > el.clientHeight;
    if (canScrollX || canScrollY) return true;
    el = el.parentElement;
  }
  return false;
}

/**
 * Swipe handler for the tab content area on mobile. A left swipe advances to
 * the next tab, a right swipe returns to the previous tab — same direction
 * conventions as iOS / Android pager UIs. Wrap the active-tab content in this
 * component and pass the same `navTabs` and `activeTab` you give the nav.
 *
 * Drag is started manually in `onPointerDown` (via `useDragControls`) so we
 * can opt out per-touch — see `shouldIgnoreSwipeStart` for the full list of
 * exclusions (form controls, dialogs, scrollers, `data-swipe-ignore`).
 *
 * Drag is also disabled outside the mobile viewport / on fine-pointer devices,
 * so a desktop mouse drag or a tablet at desktop width never flips tabs.
 */
export function ArenaContentSwipe({ navTabs, activeTab, onSelectTab, children }) {
  const idx = navTabs.findIndex((t) => t.id === activeTab);
  // Require both a touch device AND a mobile-sized viewport. A touch laptop
  // or a tablet held horizontally is already seeing the desktop tablist, so
  // a stray swipe there would be confusing.
  const isCoarse = useMatchMedia('(pointer: coarse)');
  const isMobileViewport = useMatchMedia('(max-width: 767px)');
  const swipeEnabled = isCoarse && isMobileViewport;
  const dragControls = useDragControls();

  const handlePointerDown = (e) => {
    if (!swipeEnabled) return;
    if (shouldIgnoreSwipeStart(e.target, e.currentTarget)) return;
    dragControls.start(e);
  };

  const handleDragEnd = (_event, info) => {
    // Distance and velocity thresholds tuned for thumb swipes: roughly a third
    // of the screen, OR a quick flick. Tap/scroll noise stays under both.
    const distance = Math.abs(info.offset.x);
    const velocity = Math.abs(info.velocity.x);
    if (distance < 80 && velocity < 400) return;

    if (info.offset.x < 0 && idx < navTabs.length - 1) {
      onSelectTab(navTabs[idx + 1].id);
    } else if (info.offset.x > 0 && idx > 0) {
      onSelectTab(navTabs[idx - 1].id);
    }
  };

  return (
    // `touch-pan-y` tells the browser "I'll handle horizontal pans; you keep
    // vertical scroll." Required because Motion does NOT auto-apply
    // `touch-action` when `dragListener={false}` — without it, iOS Safari's
    // compositor can claim a slightly-diagonal swipe as a vertical scroll and
    // fire `pointercancel`, killing the gesture before Motion engages.
    //
    // `touch-action` cascades by intersection, so a naive `pan-y` would also
    // break horizontal scroll on the Partnership Matrix and any other child
    // with `.overflow-x-auto`. The arbitrary variant below restores `pan-x`
    // on those descendants so they can scroll horizontally natively while
    // the wrapper still gets a clean shot at the horizontal swipe gesture.
    <motion.div
      className="touch-pan-y [&_.overflow-x-auto]:touch-pan-x"
      drag={swipeEnabled ? 'x' : false}
      dragListener={false}
      dragControls={dragControls}
      dragDirectionLock
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.15}
      dragSnapToOrigin
      onPointerDown={handlePointerDown}
      onDragEnd={handleDragEnd}
      transition={{ type: 'spring', stiffness: 380, damping: 32 }}
    >
      {children}
    </motion.div>
  );
}
