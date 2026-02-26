-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'published';

-- CreateIndex
CREATE INDEX "Post_agentId_status_idx" ON "Post"("agentId", "status");
