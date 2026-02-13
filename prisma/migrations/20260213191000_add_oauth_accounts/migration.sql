-- CreateTable
CREATE TABLE "OAuthAccount" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "provider" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "email" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "userId" TEXT NOT NULL,
  CONSTRAINT "OAuthAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "OAuthAccount_provider_providerId_key" ON "OAuthAccount"("provider", "providerId");

-- CreateIndex
CREATE UNIQUE INDEX "OAuthAccount_userId_provider_key" ON "OAuthAccount"("userId", "provider");

-- CreateIndex
CREATE INDEX "OAuthAccount_userId_idx" ON "OAuthAccount"("userId");

-- Backfill existing OAuth users
INSERT OR IGNORE INTO "OAuthAccount" ("id", "provider", "providerId", "email", "userId")
SELECT
  'oa_' || lower(hex(randomblob(12))),
  "provider",
  "providerId",
  "email",
  "id"
FROM "User"
WHERE "provider" IS NOT NULL AND "providerId" IS NOT NULL;
