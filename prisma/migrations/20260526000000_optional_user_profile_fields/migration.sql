-- Make secondary profile columns optional on User.
--
-- `phone`, `address`, `birthday`, and `gender` were collected as required at
-- sign-up. They're now optional extras the user can fill in under "Add more
-- details" on the register form, so the columns become nullable. Existing rows
-- already hold non-null values and are unaffected.
--
-- Idempotency: DROP NOT NULL is a no-op on an already-nullable column, so each
-- statement is safe to re-run on a partially-skewed DB.
ALTER TABLE "User" ALTER COLUMN "phone" DROP NOT NULL;
ALTER TABLE "User" ALTER COLUMN "address" DROP NOT NULL;
ALTER TABLE "User" ALTER COLUMN "birthday" DROP NOT NULL;
ALTER TABLE "User" ALTER COLUMN "gender" DROP NOT NULL;
