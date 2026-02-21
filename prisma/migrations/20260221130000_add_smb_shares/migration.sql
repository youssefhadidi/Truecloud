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

-- CreateIndex
CREATE UNIQUE INDEX "SmbShare_name_key" ON "SmbShare"("name");
