# Modernize Match History Design and Score Card Layout

## Description
The current design of the `<MatchHistory>` scorecards is functional but looks generic and slightly cluttered. It relies on full-height solid color rails (`bg-emerald-500` / `bg-slate-200`) and simple text layouts that do not fully capture a premium, modern, and minimalist feel.

We need to upgrade the design to blend seamlessly with Dinkmaster's existing aesthetic of sleek card layers, Bricolage display typography, vibrant accent pills, and high-fidelity micro-interactions.

## Requirements
1. **Premium Outcome Light**: Swap the full-height solid left rail for an elegant, rounded vertical indicator pill (`w-1 h-12 rounded-full`) nested on the left edge.
2. **Inline SVG Icons**: Introduce clean, lightweight SVG icons for Court and Time/Calendar to elevate the presentation.
3. **Typographic Score Capsule**: Present the scores side-by-side inside a beautiful, unified score capsule with high-contrast font weights and modern pill tags for score differentials.
4. **Glassmorphic Sticky Headers**: Transition the sticky day headers into elegant glass backdrop ribbons with matching match-count emerald badges.
5. **Roster & Highlight Upgrades**: Stylize player names and highlight the active viewer's side using clear, modern styling.

## Verification
- Vitest test suite should remain 100% green.
- Layout should look modern, minimalist, and responsive across all viewports.
