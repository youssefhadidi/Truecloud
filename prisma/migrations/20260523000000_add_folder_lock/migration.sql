-- Admin-set passcode gate on a root-level shared folder.
CREATE TABLE "FolderLock" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "path" TEXT NOT NULL,
    "pinHash" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "pinFailures" INTEGER NOT NULL DEFAULT 0,
    "pinLockedUntil" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "FolderLock_path_key" ON "FolderLock"("path");
