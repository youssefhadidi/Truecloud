-- Rename Share.allowUploads -> Share.allowEditing
-- The flag gates all public write operations (upload, rename, move, delete,
-- mkdir), not just uploads, so the name now reflects "edit" control.
ALTER TABLE "Share" RENAME COLUMN "allowUploads" TO "allowEditing";
