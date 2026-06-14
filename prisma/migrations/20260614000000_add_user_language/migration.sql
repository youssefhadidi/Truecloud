-- Per-user UI language preference ("en" | "fr").
ALTER TABLE "User" ADD COLUMN "language" TEXT NOT NULL DEFAULT 'en';
