-- Defense-in-depth for the per-arena matchmaking thresholds added by
-- 20260523124244_add_arena_matchmaking_thresholds: prevent invalid values from
-- being persisted via paths that bypass the server-action validation
-- (Prisma Studio, ad-hoc SQL, future bulk imports). Bounds and ordering match
-- updateArenaMatchmaking in src/app/actions.js so the two cannot disagree.
ALTER TABLE "Arena"
  ADD CONSTRAINT "Arena_starveThreshold_range_chk"
    CHECK ("starveThreshold" BETWEEN 1 AND 50),
  ADD CONSTRAINT "Arena_emergencyWait_range_chk"
    CHECK ("emergencyWait" BETWEEN 1 AND 50),
  ADD CONSTRAINT "Arena_emergencyWait_ge_starveThreshold_chk"
    CHECK ("emergencyWait" >= "starveThreshold");
