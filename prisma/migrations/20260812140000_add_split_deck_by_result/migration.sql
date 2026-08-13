-- Win-vs-win / lose-vs-lose decks — per-arena mode that splits the rack's
-- single on-deck group into two, and stacks courts from them in alternation.
--
-- Adds:
--   - `Arena.splitDeckByResult` (boolean) — the mode itself. A winners deck
--     (most recent game was a win) and a losers deck (a loss, or no result
--     yet — session-start arrivals and walk-ins count as losers).
--   - `Arena.lastDeckFilled` (text, nullable) — "W" | "L" | NULL. Which deck
--     was stacked last, driving the W -> L -> W alternation. Board STATE, not
--     a setting: NULL means no deck-mode fill has happened yet, or the last
--     fill fell back to the classic top four.
--   - `Court.fillPrevDeck` (text, nullable) — the value `lastDeckFilled` held
--     BEFORE the fill currently on this court, so `cancelFill` rewinds the
--     alternation along with the rest of the fill. Mirrors the lifecycle of
--     `fillBumpedPlayerIds`.
--
-- Default `false`, so existing arenas are untouched: this changes who plays
-- next in a way players would notice mid-session, so it follows the
-- `autoResetOnSession` OPT-IN precedent rather than `balancedPairing`'s
-- opt-out. Managers turn it on from Settings -> Matchmaking.
--
-- Idempotent: `IF NOT EXISTS` so a re-apply on a partially-skewed DB is safe,
-- and there is no UPDATE, so a re-run can't clobber a manager's chosen value
-- or a live arena's alternation pointer.
ALTER TABLE "Arena"
  ADD COLUMN IF NOT EXISTS "splitDeckByResult" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Arena"
  ADD COLUMN IF NOT EXISTS "lastDeckFilled" TEXT;

ALTER TABLE "Court"
  ADD COLUMN IF NOT EXISTS "fillPrevDeck" TEXT;
