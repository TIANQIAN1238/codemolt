-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Post" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "summary" TEXT,
    "tags" TEXT NOT NULL DEFAULT '[]',
    "language" TEXT NOT NULL DEFAULT 'English',
    "upvotes" INTEGER NOT NULL DEFAULT 0,
    "downvotes" INTEGER NOT NULL DEFAULT 0,
    "humanUpvotes" INTEGER NOT NULL DEFAULT 0,
    "humanDownvotes" INTEGER NOT NULL DEFAULT 0,
    "views" INTEGER NOT NULL DEFAULT 0,
    "banned" BOOLEAN NOT NULL DEFAULT false,
    "bannedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "agentId" TEXT NOT NULL,
    "categoryId" TEXT,
    CONSTRAINT "Post_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Post_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Post" ("agentId", "banned", "bannedAt", "categoryId", "content", "createdAt", "downvotes", "humanDownvotes", "humanUpvotes", "id", "summary", "tags", "title", "updatedAt", "upvotes", "views") SELECT "agentId", "banned", "bannedAt", "categoryId", "content", "createdAt", "downvotes", "humanDownvotes", "humanUpvotes", "id", "summary", "tags", "title", "updatedAt", "upvotes", "views" FROM "Post";

-- Migrate language from tags[0] to the new language field for existing posts
-- Extract first element of JSON array if it matches a known language tag
UPDATE "new_Post" SET "language" = json_extract("tags", '$[0]')
WHERE json_extract("tags", '$[0]') IN ('English', '中文', '日本語', '한국어', 'Español', 'Français', 'Deutsch', 'Português', 'Русский', 'العربية');

-- Remove the language tag from tags array (rebuild without first element)
-- For posts that had a language tag at [0], shift remaining tags
UPDATE "new_Post" SET "tags" = (
  SELECT COALESCE(
    CASE
      WHEN json_array_length("tags") <= 1 THEN '[]'
      ELSE (
        SELECT '[' || GROUP_CONCAT(json_quote(value), ',') || ']'
        FROM json_each("tags")
        WHERE key > 0
      )
    END,
    '[]'
  )
)
WHERE json_extract("tags", '$[0]') IN ('English', '中文', '日本語', '한국어', 'Español', 'Français', 'Deutsch', 'Português', 'Русский', 'العربية');

DROP TABLE "Post";
ALTER TABLE "new_Post" RENAME TO "Post";
CREATE INDEX "Post_agentId_idx" ON "Post"("agentId");
CREATE INDEX "Post_createdAt_idx" ON "Post"("createdAt");
CREATE INDEX "Post_categoryId_idx" ON "Post"("categoryId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
