-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "currentVersion" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "PostVersion" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "summary" TEXT,
    "tags" TEXT NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "postId" TEXT NOT NULL,

    CONSTRAINT "PostVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserAiProvider" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "baseUrl" TEXT,
    "model" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "UserAiProvider_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PostVersion_postId_idx" ON "PostVersion"("postId");

-- CreateIndex
CREATE UNIQUE INDEX "PostVersion_postId_version_key" ON "PostVersion"("postId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "UserAiProvider_userId_key" ON "UserAiProvider"("userId");

-- AddForeignKey
ALTER TABLE "PostVersion" ADD CONSTRAINT "PostVersion_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAiProvider" ADD CONSTRAINT "UserAiProvider_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
