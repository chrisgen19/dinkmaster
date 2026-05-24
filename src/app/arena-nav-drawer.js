'use client';

import { useEffect, useRef, useState } from 'react';

/** Fixed height of the always-visible drawer tip, in pixels. The collapsed
 *  drawer is translated down by exactly this much so nothing of the menu body
 *  peeks above the viewport edge. */
const TIP_HEIGHT = 72;

/**
 * Mobile-only bottom navigation drawer.
 *
 * Its tip (grab handle + active tab label + chevron) always peeks above the
 * viewport edge; tapping or swiping the tip up expands the full tab menu,
 * swiping down or tapping again collapses it. Hidden at `md` and above, where
 * the desktop horizontal tab bar is shown instead.
 *
 * @param {object} props
 * @param {Array<{id: string, label: string, badge?: number|null}>} props.navTabs - Tab definitions.
 * @param {string} props.activeTab - Currently selected tab id.
 * @param {string} props.activeTabLabel - Label of the active tab, shown in the tip.
 * @param {boolean} props.canManage - Whether the viewer may manage the arena (drives the badge).
 * @param {Array} props.pendingRequests - Pending join requests (drives the badge).
 * @param {(tabId: string) => void} props.onSelectTab - Called when a tab is chosen.
 */
export function ArenaNavDrawer({
  navTabs,
  activeTab,
  activeTabLabel,
  canManage,
  pendingRequests,
  onSelectTab,
}) {
  const [open, setOpen] = useState(false);
  // Y position where the current pointer interaction on the tip began.
  const touchStartY = useRef(null);
  // Whether the last tip interaction was a swipe — used to stop the trailing
  // click from undoing what the swipe just did.
  const didSwipe = useRef(false);
  // The drawer panel and the tip button — for focus management.
  const drawerRef = useRef(null);
  const tipRef = useRef(null);
  // Tracks the previous `open` value so we can restore focus on close.
  const prevOpen = useRef(false);

  // Lock body scroll while the drawer is expanded.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // Focus management: move focus into the menu on open, and back to the tip on
  // close, so keyboard users follow the drawer.
  useEffect(() => {
    if (open) {
      drawerRef.current?.querySelector('[data-menu-item]')?.focus();
    } else if (prevOpen.current) {
      tipRef.current?.focus();
    }
    prevOpen.current = open;
  }, [open]);

  // While open: close on Escape and trap Tab focus within the drawer.
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setOpen(false);
        return;
      }
      if (e.key !== 'Tab') return;
      const focusable = drawerRef.current?.querySelectorAll(
        'button:not([tabindex="-1"]):not([disabled])',
      );
      if (!focusable || focusable.length === 0) return;
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
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  // The drawer is only rendered (via `md:hidden`) below the `md` breakpoint.
  // If the viewport grows past it while the drawer is open — e.g. a tablet
  // rotates to landscape — collapse it so the scroll lock above is released.
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const handleChange = (e) => {
      if (e.matches) setOpen(false);
    };
    mq.addEventListener('change', handleChange);
    return () => mq.removeEventListener('change', handleChange);
  }, []);

  // Pointer events cover both touch and mouse, so the swipe gesture also works
  // when testing with a mouse in the browser's mobile layout.
  const handleTipPointerDown = (e) => {
    touchStartY.current = e.clientY;
    didSwipe.current = false;
  };
  // Swipe the tip up to expand, down to collapse.
  const handleTipPointerUp = (e) => {
    if (touchStartY.current == null) return;
    const swiped = touchStartY.current - e.clientY;
    if (swiped > 30) {
      setOpen(true);
      didSwipe.current = true;
    } else if (swiped < -30) {
      setOpen(false);
      didSwipe.current = true;
    }
    touchStartY.current = null;
  };
  // A cancelled pointer (e.g. the OS hijacks the gesture) leaves no pointerup,
  // so clear the swipe state to avoid acting on a stale start position.
  const handleTipPointerCancel = () => {
    touchStartY.current = null;
    didSwipe.current = false;
  };
  // A plain tap toggles the drawer; ignore the click that trails a swipe.
  const handleTipClick = () => {
    if (didSwipe.current) {
      didSwipe.current = false;
      return;
    }
    setOpen((prev) => !prev);
  };

  const handleSelect = (tabId) => {
    setOpen(false);
    onSelectTab(tabId);
  };

  const tipBadge = canManage && pendingRequests.length > 0 ? pendingRequests.length : null;

  return (
    <>
      {/* Dim, lightly blurred backdrop — only interactive when expanded */}
      <div
        onClick={() => setOpen(false)}
        className={`md:hidden fixed inset-0 z-[55] bg-slate-950/40 backdrop-blur-[2px] transition-opacity duration-300 ${
          open ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        aria-hidden="true"
      />

      {/* Drawer — collapsed, it is pushed down by exactly TIP_HEIGHT so only
          the tip remains visible above the viewport edge. */}
      <div
        ref={drawerRef}
        style={{ '--tip': `${TIP_HEIGHT}px` }}
        className={`md:hidden fixed bottom-0 inset-x-0 z-[60] max-h-[82vh] flex flex-col
          bg-white rounded-t-[28px] ring-1 ring-slate-900/5
          shadow-[0_-12px_48px_-12px_rgba(15,23,42,0.38)]
          transition-transform duration-[360ms] [transition-timing-function:cubic-bezier(0.32,0.72,0,1)]
          ${open ? 'translate-y-0' : 'translate-y-[calc(100%-var(--tip))]'}`}
      >
        {/* Tip — fixed height, always visible; tap or swipe to toggle */}
        <button
          ref={tipRef}
          type="button"
          onClick={handleTipClick}
          onPointerDown={handleTipPointerDown}
          onPointerUp={handleTipPointerUp}
          onPointerCancel={handleTipPointerCancel}
          aria-expanded={open}
          aria-controls="arena-nav-menu"
          aria-label={`Arena navigation — currently viewing ${activeTabLabel}`}
          style={{ height: `${TIP_HEIGHT}px` }}
          className="relative shrink-0 w-full flex items-center gap-3 px-5 touch-pan-y"
        >
          {/* Grab handle */}
          <span
            aria-hidden="true"
            className={`absolute top-2.5 left-1/2 -translate-x-1/2 h-1.5 rounded-full transition-all duration-300 ${
              open ? 'w-8 bg-slate-300' : 'w-11 bg-slate-200'
            }`}
          />

          {/* Brand accent dot (decorative) */}
          <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" aria-hidden="true" />

          {/* Active tab label */}
          <span className="flex flex-col items-start min-w-0 flex-1 pt-1">
            <span className="text-[9px] font-extrabold uppercase tracking-[0.22em] text-slate-400 leading-none">
              Now viewing
            </span>
            <span className="mt-1 flex items-center gap-2 min-w-0 max-w-full">
              <span className="text-[15px] font-extrabold tracking-tight text-slate-900 truncate">
                {activeTabLabel}
              </span>
              {tipBadge != null && (
                <span className="shrink-0 bg-amber-500 text-white text-[9px] font-black rounded-full px-1.5 py-0.5 leading-none">
                  {tipBadge}
                </span>
              )}
            </span>
          </span>

          {/* Toggle affordance */}
          <span
            aria-hidden="true"
            className={`shrink-0 grid place-items-center h-9 w-9 rounded-xl transition-all duration-300 ${
              open ? 'bg-slate-900 text-white rotate-180' : 'bg-slate-100 text-slate-500'
            }`}
          >
            <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 15l-6-6-6 6" />
            </svg>
          </span>
        </button>

        {/* Menu body — revealed when the drawer is expanded. While collapsed it
            stays mounted (so items can animate in) but is taken out of the
            accessibility tree and tab order. */}
        <div
          id="arena-nav-menu"
          aria-hidden={!open}
          className="overflow-y-auto px-3 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
        >
          <div className="flex items-center justify-between px-2 pt-1 pb-2">
            <span className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-slate-400">
              Jump to
            </span>
            <span className="h-px flex-1 mx-3 bg-gradient-to-r from-slate-200 to-transparent" />
          </div>

          <div className="space-y-1.5">
            {navTabs.map((tab, i) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  data-menu-item
                  onClick={() => handleSelect(tab.id)}
                  tabIndex={open ? 0 : -1}
                  style={{ transitionDelay: open ? `${80 + i * 45}ms` : '0ms' }}
                  className={`group w-full flex items-center gap-3 pl-3.5 pr-3 py-3.5 rounded-2xl text-sm font-extrabold uppercase tracking-wide
                    transition-[transform,opacity,background-color,box-shadow] duration-300 active:scale-[0.985]
                    ${open ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'}
                    ${isActive
                      ? 'bg-slate-900 text-white shadow-lg shadow-slate-900/25'
                      : 'bg-slate-50 text-slate-600 hover:bg-slate-100'}`}
                >
                  <span
                    aria-hidden="true"
                    className={`h-5 w-1 rounded-full shrink-0 transition-colors ${
                      isActive ? 'bg-emerald-400' : 'bg-slate-300 group-hover:bg-slate-400'
                    }`}
                  />
                  <span className="flex-1 text-left truncate">{tab.label}</span>
                  {tab.badge != null && (
                    <span className={`shrink-0 text-[10px] font-black rounded-full px-2 py-0.5 leading-none ${
                      isActive ? 'bg-emerald-400 text-slate-900' : 'bg-amber-500 text-white'
                    }`}>
                      {tab.badge}
                    </span>
                  )}
                  {isActive && (
                    <svg className="w-4 h-4 shrink-0 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}
