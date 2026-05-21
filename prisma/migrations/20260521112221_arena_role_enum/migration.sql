-- Convert ArenaMembership.role from a free-form String to the ArenaRole enum.
--
-- Done as an in-place `ALTER COLUMN ... TYPE ... USING` cast so existing rows
-- are preserved. Prisma's default diff would DROP and re-add the column (it
-- could not infer a cast); that loses data and fails on a non-empty table.
-- Every persisted role is already one of OWNER | ORGANIZER | MEMBER, so the
-- text -> enum cast succeeds for all existing rows.

-- CreateEnum
CREATE TYPE "ArenaRole" AS ENUM ('OWNER', 'ORGANIZER', 'MEMBER');

-- AlterTable
ALTER TABLE "ArenaMembership"
  ALTER COLUMN "role" TYPE "ArenaRole" USING ("role"::"ArenaRole");
