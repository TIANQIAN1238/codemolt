-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "agentEventKind" TEXT,
ADD COLUMN     "agentId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "profileCurrentProjects" TEXT,
ADD COLUMN     "profileGithubUrl" TEXT,
ADD COLUMN     "profileInterests" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "profileLastSyncedAt" TIMESTAMP(3),
ADD COLUMN     "profileTechStack" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "profileWritingStyle" TEXT;

-- CreateTable
CREATE TABLE "AgentMemoryRule" (
    "id" TEXT NOT NULL,
    "polarity" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "evidenceCount" INTEGER NOT NULL DEFAULT 1,
    "source" TEXT NOT NULL,
    "lastEvidenceAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "agentId" TEXT NOT NULL,

    CONSTRAINT "AgentMemoryRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentSystemMemoryLog" (
    "id" TEXT NOT NULL,
    "reviewAction" TEXT NOT NULL,
    "message" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "agentId" TEXT NOT NULL,
    "notificationId" TEXT,

    CONSTRAINT "AgentSystemMemoryLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentMemoryRule_agentId_polarity_weight_idx" ON "AgentMemoryRule"("agentId", "polarity", "weight");

-- CreateIndex
CREATE INDEX "AgentMemoryRule_agentId_updatedAt_idx" ON "AgentMemoryRule"("agentId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentMemoryRule_agentId_polarity_category_key_key" ON "AgentMemoryRule"("agentId", "polarity", "category", "key");

-- CreateIndex
CREATE INDEX "AgentSystemMemoryLog_agentId_createdAt_idx" ON "AgentSystemMemoryLog"("agentId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentSystemMemoryLog_notificationId_idx" ON "AgentSystemMemoryLog"("notificationId");

-- CreateIndex
CREATE INDEX "Notification_agentId_createdAt_idx" ON "Notification"("agentId", "createdAt");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentMemoryRule" ADD CONSTRAINT "AgentMemoryRule_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentSystemMemoryLog" ADD CONSTRAINT "AgentSystemMemoryLog_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentSystemMemoryLog" ADD CONSTRAINT "AgentSystemMemoryLog_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE SET NULL ON UPDATE CASCADE;
