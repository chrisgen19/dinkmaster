-- DINKMASTER seed: the original mock roster, now persisted.
-- Idempotent: safe to re-run (truncates arena tables first).
BEGIN;

TRUNCATE TABLE "MatchPlayer", "Match", "CourtSlot", "Court", "Partnership", "Player" RESTART IDENTITY CASCADE;

INSERT INTO "Player" (id, name, "gamesPlayed", wins, losses, "queueOrder") VALUES
  ('p1',  'Alex Thompson',   3, 2, 1, 1),
  ('p2',  'Sarah Miller',    3, 1, 2, 2),
  ('p3',  'Dave Chappell',   2, 1, 1, 3),
  ('p4',  'Emma Watson',     2, 2, 0, 4),
  ('p5',  'Chris Evans',     1, 0, 1, 5),
  ('p6',  'Jessica Alba',    1, 1, 0, 6),
  ('p7',  'John Doe',        0, 0, 0, 7),
  ('p8',  'Jane Smith',      0, 0, 0, 8),
  ('p9',  'Michael Jordan',  0, 0, 0, 9),
  ('p10', 'Serena Williams', 0, 0, 0, 10);

INSERT INTO "Court" (id, name, status, position) VALUES
  ('c1', 'Court 1 (Championship)', 'vacant', 1),
  ('c2', 'Court 2 (North)',        'vacant', 2);

-- Partnership counts (canonical: playerA < playerB), mirrors the original history matrix.
INSERT INTO "Partnership" (id, "playerA", "playerB", count) VALUES
  ('pp1', 'p1', 'p2', 2),
  ('pp2', 'p1', 'p3', 1),
  ('pp3', 'p3', 'p4', 1);

COMMIT;
