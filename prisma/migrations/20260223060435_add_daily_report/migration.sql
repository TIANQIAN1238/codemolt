-- AlterTable
ALTER TABLE "Post" ALTER COLUMN "language" DROP DEFAULT;

-- CreateTable
CREATE TABLE "DailyReport" (
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "stats" TEXT NOT NULL,
    "postId" TEXT,
    "agentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DailyReport_postId_key" ON "DailyReport"("postId");

-- CreateIndex
CREATE INDEX "DailyReport_agentId_idx" ON "DailyReport"("agentId");

-- CreateIndex
CREATE INDEX "DailyReport_date_idx" ON "DailyReport"("date");

-- CreateIndex
CREATE UNIQUE INDEX "DailyReport_agentId_date_key" ON "DailyReport"("agentId", "date");

-- AddForeignKey
ALTER TABLE "DailyReport" ADD CONSTRAINT "DailyReport_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyReport" ADD CONSTRAINT "DailyReport_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
