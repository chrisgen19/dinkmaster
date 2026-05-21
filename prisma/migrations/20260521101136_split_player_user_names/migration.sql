-- Split single-name fields into first/last and add User profile columns.
--
-- Staged so it is data-preserving and safe to run via `prisma migrate deploy`
-- on a database that already has rows:
--   1. add the new columns as NULLABLE
--   2. backfill them from the existing data
--   3. promote them to NOT NULL
--   4. drop the old columns
-- The UPDATEs match zero rows on an empty database, so this is a no-op there.
--
-- Name splitting: everything before the first space is the first name; the
-- remainder (trimmed) is the last name, or NULL/'' when there is no space.

-- --- Player: name -> firstName + lastName --------------------------------
ALTER TABLE "Player" ADD COLUMN "firstName" TEXT;
ALTER TABLE "Player" ADD COLUMN "lastName" TEXT;

UPDATE "Player"
SET "firstName" = COALESCE(NULLIF(split_part("name", ' ', 1), ''), "name", ''),
    "lastName"  = NULLIF(trim(substr("name", length(split_part("name", ' ', 1)) + 1)), '');

ALTER TABLE "Player" ALTER COLUMN "firstName" SET NOT NULL;
ALTER TABLE "Player" DROP COLUMN "name";

-- --- MatchPlayer: playerName -> playerFirstName + playerLastName ----------
ALTER TABLE "MatchPlayer" ADD COLUMN "playerFirstName" TEXT;
ALTER TABLE "MatchPlayer" ADD COLUMN "playerLastName" TEXT;

UPDATE "MatchPlayer"
SET "playerFirstName" = COALESCE(NULLIF(split_part("playerName", ' ', 1), ''), "playerName", ''),
    "playerLastName"  = NULLIF(trim(substr("playerName", length(split_part("playerName", ' ', 1)) + 1)), '');

ALTER TABLE "MatchPlayer" ALTER COLUMN "playerFirstName" SET NOT NULL;
ALTER TABLE "MatchPlayer" DROP COLUMN "playerName";

-- --- User: name -> firstName + lastName, plus required profile fields -----
-- Existing rows predate these fields, so they are backfilled with empty
-- placeholders (epoch for birthday); affected users can complete their
-- profile later. New sign-ups always supply real values.
ALTER TABLE "User" ADD COLUMN "firstName" TEXT;
ALTER TABLE "User" ADD COLUMN "lastName" TEXT;
ALTER TABLE "User" ADD COLUMN "phone" TEXT;
ALTER TABLE "User" ADD COLUMN "address" TEXT;
ALTER TABLE "User" ADD COLUMN "birthday" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "gender" TEXT;

UPDATE "User"
SET "firstName" = COALESCE(NULLIF(split_part("name", ' ', 1), ''), "name", ''),
    "lastName"  = COALESCE(NULLIF(trim(substr("name", length(split_part("name", ' ', 1)) + 1)), ''), ''),
    "phone"     = '',
    "address"   = '',
    "birthday"  = TIMESTAMP '1970-01-01 00:00:00',
    "gender"    = '';

ALTER TABLE "User" ALTER COLUMN "firstName" SET NOT NULL;
ALTER TABLE "User" ALTER COLUMN "lastName" SET NOT NULL;
ALTER TABLE "User" ALTER COLUMN "phone" SET NOT NULL;
ALTER TABLE "User" ALTER COLUMN "address" SET NOT NULL;
ALTER TABLE "User" ALTER COLUMN "birthday" SET NOT NULL;
ALTER TABLE "User" ALTER COLUMN "gender" SET NOT NULL;
