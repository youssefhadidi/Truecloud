-- Private-uploads shares: each visitor (identified by email) only sees the
-- top-level items they uploaded into the shared folder.
ALTER TABLE "Share" ADD COLUMN "privateUploads" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "ShareUpload" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shareId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ShareUpload_shareId_fkey" FOREIGN KEY ("shareId") REFERENCES "Share" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ShareUpload_shareId_name_key" ON "ShareUpload"("shareId", "name");
CREATE INDEX "ShareUpload_shareId_email_idx" ON "ShareUpload"("shareId", "email");
