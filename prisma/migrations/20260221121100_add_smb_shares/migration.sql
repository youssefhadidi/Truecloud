-- CreateTable
CREATE TABLE "Favorite" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "path" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isDirectory" BOOLEAN NOT NULL DEFAULT false,
    "ownerId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Favorite_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FileIndex" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "parentPath" TEXT NOT NULL,
    "extension" TEXT NOT NULL,
    "size" BIGINT NOT NULL DEFAULT 0,
    "isDirectory" BOOLEAN NOT NULL DEFAULT false,
    "lastModified" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ownerId" TEXT,
    "indexedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "SmbShare" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "comment" TEXT,
    "readOnly" BOOLEAN NOT NULL DEFAULT false,
    "browsable" BOOLEAN NOT NULL DEFAULT true,
    "guestOk" BOOLEAN NOT NULL DEFAULT false,
    "validUsers" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "name" TEXT,
    "role" TEXT NOT NULL DEFAULT 'user',
    "hasRootAccess" BOOLEAN NOT NULL DEFAULT false,
    "sessionLockEnabled" BOOLEAN NOT NULL DEFAULT false,
    "sessionLockPin" TEXT,
    "sessionLockTimeout" INTEGER NOT NULL DEFAULT 15,
    "isSessionLocked" BOOLEAN NOT NULL DEFAULT false,
    "lastActivityAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_User" ("createdAt", "email", "hasRootAccess", "id", "name", "password", "role", "updatedAt", "username") SELECT "createdAt", "email", "hasRootAccess", "id", "name", "password", "role", "updatedAt", "username" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Favorite_ownerId_idx" ON "Favorite"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "Favorite_path_ownerId_key" ON "Favorite"("path", "ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "FileIndex_path_key" ON "FileIndex"("path");

-- CreateIndex
CREATE INDEX "FileIndex_name_idx" ON "FileIndex"("name");

-- CreateIndex
CREATE INDEX "FileIndex_ownerId_idx" ON "FileIndex"("ownerId");

-- CreateIndex
CREATE INDEX "FileIndex_isDirectory_idx" ON "FileIndex"("isDirectory");

-- CreateIndex
CREATE UNIQUE INDEX "SmbShare_name_key" ON "SmbShare"("name");
