-- Per-user "liked" files, shown as a gallery at /files/liked.
-- Distinct from Favorite, which holds sidebar shortcuts (mostly folders).
CREATE TABLE "LikedFile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "path" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LikedFile_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "LikedFile_path_ownerId_key" ON "LikedFile"("path", "ownerId");
CREATE INDEX "LikedFile_ownerId_idx" ON "LikedFile"("ownerId");
