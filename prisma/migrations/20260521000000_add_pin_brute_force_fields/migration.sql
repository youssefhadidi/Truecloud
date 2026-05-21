-- Add brute-force protection fields for session-lock PIN entry.
ALTER TABLE "User" ADD COLUMN "pinFailures" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "pinLockedUntil" DATETIME;
