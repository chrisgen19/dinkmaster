'use client';

import { useEffect, useState } from 'react';
import { stepScore, validateMatchScore } from '@/lib/scoring';

/** Accept only digits or an empty string into a controlled score input. */
const onScoreChange = (setter, raw) => {
  if (raw === '' || /^\d+$/.test(raw)) setter(raw);
};

/**
 * Score entry dialog, shared by both scorelines the arena writes:
 *
 *   - Finishing a live court ("Finish Game & Record Score") — fields start
 *     empty, placeholder-only, until the organizer types or steps a value.
 *   - Correcting an already-recorded match from the History tab — fields are
 *     pre-filled with the stored score.
 *
 * Same dialog in both cases by construction, so a correction reads exactly
 * like the entry it replaces. Matches the CourtCard's visual language:
 * slate-900 court tile in the header, emerald = Team A, sky = Team B, stacked
 * player names per side, a small slate VS pivot, then a stepper-equipped
 * score row. Save is disabled until the scoreline is legal.
 *
 * Score inputs are held as strings so a field can be empty; parsed to numbers
 * on submit. Both are component state seeded from `initialScore1/2`, so the
 * caller must remount (via `key`) to re-seed for a different court/match.
 *
 * @param {object} props
 * @param {string} props.courtName - Court label, e.g. "Court 1".
 * @param {string} props.subtitle - Eyebrow under the court name.
 * @param {{id: string, display: string, full: string}[]} props.team1 - Team A roster.
 * @param {{id: string, display: string, full: string}[]} props.team2 - Team B roster.
 * @param {string} [props.initialScore1] - Seed for Team A's field.
 * @param {string} [props.initialScore2] - Seed for Team B's field.
 * @param {number} props.targetScore - Arena's target score (first to N).
 * @param {string} [props.submitLabel] - Primary button copy.
 * @param {boolean} [props.isPending] - A mutation is in flight.
 * @param {string} [props.error] - Server-side rejection, shown in the alert slot.
 * @param {(score1: number, score2: number) => void} props.onSubmit
 * @param {() => void} props.onClose
 */
export function ScoreEntryModal({
  courtName,
  subtitle,
  team1,
  team2,
  initialScore1 = '',
  initialScore2 = '',
  targetScore,
  submitLabel = 'Save Score',
  isPending = false,
  error = '',
  onSubmit,
  onClose,
}) {
  const [score1, setScore1] = useState(initialScore1);
  const [score2, setScore2] = useState(initialScore2);

  // Pull a short label out of the court name for the header tile, e.g.
  // "Court 1" -> "1". Falls back to the first character if no digits.
  const courtBadge = courtName?.match(/\d+/)?.[0] ?? courtName?.charAt(0) ?? '?';

  const validation = validateMatchScore(score1, score2, targetScore);
  const canSubmit = validation.ok && !isPending;

  // Escape closes the dialog — conventional keyboard partner to the backdrop
  // click and the ✕ button. Suppressed mid-flight so a save race can surface
  // in context instead of the dialog vanishing under the user.
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape' && !isPending) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isPending, onClose]);

  const submit = () => {
    if (!canSubmit) return;
    onSubmit(parseInt(score1, 10), parseInt(score2, 10));
  };

  const onKeyDownSubmit = (e) => {
    if (e.key === 'Enter' && canSubmit) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isPending) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="score-modal-title"
        className="bg-white rounded-2xl border border-slate-200 max-w-md w-full shadow-xl animate-scale-up overflow-hidden"
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3 bg-gradient-to-r from-slate-50/80 to-white">
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              aria-hidden="true"
              className="shrink-0 w-8 h-8 rounded-lg bg-slate-900 text-white flex items-center justify-center font-extrabold text-sm shadow-sm"
            >
              {courtBadge}
            </div>
            <div className="min-w-0">
              <h3 id="score-modal-title" className="font-extrabold text-slate-900 text-sm truncate">
                {courtName}
              </h3>
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400 mt-0.5">
                {subtitle}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            aria-label="Close"
            className="shrink-0 w-7 h-7 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 flex items-center justify-center transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-5">
          {/* Identity row — TEAM A | VS | TEAM B (mirrors the card) */}
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
            <div className="min-w-0">
              <div className="text-[9px] font-extrabold uppercase tracking-[0.18em] text-emerald-600 mb-1.5">
                Team A
              </div>
              <ul className="space-y-1">
                {team1.map((p) => (
                  <li
                    key={p.id}
                    className="text-sm font-bold text-slate-800 truncate leading-tight"
                    title={p.full}
                  >
                    {p.display}
                  </li>
                ))}
              </ul>
            </div>
            <span
              aria-hidden="true"
              className="shrink-0 inline-flex w-9 h-9 rounded-full bg-slate-100 text-slate-500 items-center justify-center text-[10px] font-black tracking-[0.18em]"
            >
              VS
            </span>
            <div className="min-w-0 text-right">
              <div className="text-[9px] font-extrabold uppercase tracking-[0.18em] text-sky-600 mb-1.5">
                Team B
              </div>
              <ul className="space-y-1">
                {team2.map((p) => (
                  <li
                    key={p.id}
                    className="text-sm font-bold text-slate-800 truncate leading-tight"
                    title={p.full}
                  >
                    {p.display}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Score row — stepper buttons flanking each input */}
          <div className="grid grid-cols-2 gap-3 mt-5">
            <div className="flex items-stretch gap-1.5">
              <button
                type="button"
                onClick={() => setScore1(stepScore(score1, -1))}
                aria-label="Decrease Team A score"
                className="shrink-0 w-9 rounded-xl bg-emerald-50 hover:bg-emerald-100 active:bg-emerald-200 text-emerald-700 font-extrabold text-lg flex items-center justify-center transition"
              >
                −
              </button>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={score1}
                onChange={(e) => onScoreChange(setScore1, e.target.value)}
                onKeyDown={onKeyDownSubmit}
                placeholder="0"
                aria-label="Team A score"
                className="flex-1 min-w-0 text-center bg-white border-2 border-emerald-200 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/15 rounded-xl py-3 text-2xl font-extrabold text-slate-800 placeholder:text-slate-300 outline-none transition"
              />
              <button
                type="button"
                onClick={() => setScore1(stepScore(score1, 1))}
                aria-label="Increase Team A score"
                className="shrink-0 w-9 rounded-xl bg-emerald-50 hover:bg-emerald-100 active:bg-emerald-200 text-emerald-700 font-extrabold text-lg flex items-center justify-center transition"
              >
                +
              </button>
            </div>
            <div className="flex items-stretch gap-1.5">
              <button
                type="button"
                onClick={() => setScore2(stepScore(score2, -1))}
                aria-label="Decrease Team B score"
                className="shrink-0 w-9 rounded-xl bg-sky-50 hover:bg-sky-100 active:bg-sky-200 text-sky-700 font-extrabold text-lg flex items-center justify-center transition"
              >
                −
              </button>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={score2}
                onChange={(e) => onScoreChange(setScore2, e.target.value)}
                onKeyDown={onKeyDownSubmit}
                placeholder="0"
                aria-label="Team B score"
                className="flex-1 min-w-0 text-center bg-white border-2 border-sky-200 focus:border-sky-500 focus:ring-4 focus:ring-sky-500/15 rounded-xl py-3 text-2xl font-extrabold text-slate-800 placeholder:text-slate-300 outline-none transition"
              />
              <button
                type="button"
                onClick={() => setScore2(stepScore(score2, 1))}
                aria-label="Increase Team B score"
                className="shrink-0 w-9 rounded-xl bg-sky-50 hover:bg-sky-100 active:bg-sky-200 text-sky-700 font-extrabold text-lg flex items-center justify-center transition"
              >
                +
              </button>
            </div>
          </div>

          {/* Hint while typing; red alert for a server rejection, or once both
              scores are filled but the scoreline is illegal (tie/target/win-by-2). */}
          <div className="mt-4">
            {error || (validation.complete && !validation.ok) ? (
              <div
                role="alert"
                className="px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-red-700 text-[11px] font-semibold flex items-center gap-2"
              >
                <svg
                  className="w-3.5 h-3.5 shrink-0"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <span>{error || validation.reason}</span>
              </div>
            ) : (
              <div className="px-3 py-2 rounded-lg bg-slate-50 border border-slate-200/70 text-slate-500 text-[11px] flex items-center justify-center gap-1.5">
                <span className="font-bold text-slate-700">First to {targetScore}</span>
                <span className="text-slate-300" aria-hidden="true">·</span>
                <span>Win by 2</span>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-slate-100 bg-slate-50/40 flex gap-2.5">
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="flex-1 py-2.5 text-[11px] font-extrabold uppercase tracking-[0.14em] text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-xl transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className={`flex-1 py-2.5 text-[11px] font-extrabold uppercase tracking-[0.14em] rounded-xl transition ${
              canSubmit
                ? 'bg-emerald-700 hover:bg-emerald-800 text-white shadow-sm shadow-emerald-700/20'
                : 'bg-slate-100 text-slate-400 cursor-not-allowed'
            }`}
          >
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
