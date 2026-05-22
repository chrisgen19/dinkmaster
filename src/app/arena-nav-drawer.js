'use client';

import { useEffect, useRef, useState } from 'react';

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
 * @param {boolean} props.canManage - Whether the viewer may create courts.
 * @param {Array} props.pendingRequests - Pending join requests (drives the badge).
 * @param {boolean} props.isPending - Whether a server action is in flight.
 * @param {(tabId: string) => void} props.onSelectTab - Called when a tab is chosen.
 * @param {() => void} props.onCreateCourt - Called when "Create Court" is pressed.
 */
export function ArenaNavDrawer({
  navTabs,
  activeTab,
  activeTabLabel,
  canManage,
  pendingRequests,
  isPending,
  onSelectTab,
  onCreateCourt,
}) {
  const [open, setOpen] = useState(false);
  // Y position where the current pointer interaction on the tip began.
  const touchStartY = useRef(null);
  // Whether the last tip interaction was a swipe — used to stop the trailing
  // click from undoing what the swipe just did.
  const didSwipe = useRef(false);

  // Lock body scroll while the drawer is expanded.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

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

  const handleCreate = () => {
    setOpen(false);
    onCreateCourt();
  };

  return (
    <>
      {/* Dim backdrop, only interactive when the drawer is expanded */}
      <div
        onClick={() => setOpen(false)}
        className={`md:hidden fixed inset-0 z-[55] bg-slate-900/50 transition-opacity duration-300 ${
          open ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        aria-hidden="true"
      />

      {/* Drawer — its tip peeks above the viewport edge while collapsed */}
      <div
        className={`md:hidden fixed bottom-0 inset-x-0 z-[60] bg-white rounded-t-3xl border-t border-slate-200 shadow-2xl transition-transform duration-300 ease-out ${
          open ? 'translate-y-0' : 'translate-y-[calc(100%-72px)]'
        }`}
      >
        {/* Tip — always visible; tap or swipe to toggle the drawer */}
        <button
          type="button"
          onClick={handleTipClick}
          onPointerDown={handleTipPointerDown}
          onPointerUp={handleTipPointerUp}
          aria-expanded={open}
          className="w-full flex flex-col items-center gap-1.5 pt-3 pb-3 px-4 touch-pan-y"
        >
          <span className={`h-1.5 w-10 rounded-full transition-colors ${open ? 'bg-slate-300' : 'bg-slate-200'}`} />
          <span className="w-full flex justify-between items-center">
            <span className="flex items-center gap-2 min-w-0">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 shrink-0">View</span>
              <span className="text-sm font-extrabold uppercase text-slate-900 truncate">{activeTabLabel}</span>
              {canManage && pendingRequests.length > 0 && (
                <span className="bg-amber-500 text-white text-[9px] font-black rounded-full px-1.5 py-0.5 leading-none shrink-0">
                  {pendingRequests.length}
                </span>
              )}
            </span>
            <span
              className={`shrink-0 pl-3 text-slate-400 transition-transform duration-300 ${open ? 'rotate-180' : ''}`}
              aria-hidden="true"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 15l-6-6-6 6" />
              </svg>
            </span>
          </span>
        </button>

        {/* Menu body — revealed when the drawer is expanded */}
        <div className="px-3 pb-[max(1rem,env(safe-area-inset-bottom))] space-y-1">
          {navTabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => handleSelect(tab.id)}
              className={`w-full flex items-center justify-between px-4 py-3.5 rounded-xl text-sm font-extrabold uppercase transition-all ${
                activeTab === tab.id
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <span>{tab.label}</span>
              {tab.badge != null && (
                <span className="bg-amber-500 text-white text-[10px] font-black rounded-full px-2 py-0.5 leading-none">
                  {tab.badge}
                </span>
              )}
            </button>
          ))}
          {canManage && (
            <button
              onClick={handleCreate}
              disabled={isPending}
              className="w-full flex items-center justify-center gap-1 mt-2 px-4 py-3.5 rounded-xl text-sm font-extrabold uppercase bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-all"
            >
              + Create Court
            </button>
          )}
        </div>
      </div>
    </>
  );
}
