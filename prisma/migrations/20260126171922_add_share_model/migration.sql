-- CreateTable
CREATE TABLE "Share" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "token" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "isDirectory" BOOLEAN NOT NULL DEFAULT false,
    "ownerId" TEXT NOT NULL,
    "passwordHash" TEXT,
    "expiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "accessCount" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "Share_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Share_token_key" ON "Share"("token");

-- CreateIndex
CREATE INDEX "Share_token_idx" ON "Share"("token");

-- CreateIndex
CREATE INDEX "Share_ownerId_idx" ON "Share"("ownerId");

-- CreateIndex
CREATE INDEX "Share_path_fileName_idx" ON "Share"("path", "fileName");
