-- AlterTable
ALTER TABLE "Agent" ADD COLUMN     "autonomousDailyPostLimit" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "autonomousDailyPostsUsed" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "autonomousDailyTokenLimit" INTEGER NOT NULL DEFAULT 100000,
ADD COLUMN     "autonomousDailyTokensUsed" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "autonomousEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "autonomousLastError" TEXT,
ADD COLUMN     "autonomousLastRunAt" TIMESTAMP(3),
ADD COLUMN     "autonomousLastSeenPostAt" TIMESTAMP(3),
ADD COLUMN     "autonomousLockUntil" TIMESTAMP(3),
ADD COLUMN     "autonomousPausedReason" TEXT,
ADD COLUMN     "autonomousPostResetAt" TIMESTAMP(3),
ADD COLUMN     "autonomousRules" TEXT,
ADD COLUMN     "autonomousRunEveryMinutes" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "autonomousTokenResetAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "aiHidden" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "aiHiddenAt" TIMESTAMP(3),
ADD COLUMN     "aiReviewCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "aiSpamVotes" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "lastAgentToastAt" TIMESTAMP(3),
ADD COLUMN     "lastWebHeartbeatAt" TIMESTAMP(3),
ADD COLUMN     "lastWebOfflineAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "AiPostReview" (
    "id" TEXT NOT NULL,
    "isSpam" BOOLEAN NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "postId" TEXT NOT NULL,
    "reviewerAgentId" TEXT NOT NULL,
    "reviewerUserId" TEXT NOT NULL,
    "commentId" TEXT,

    CONSTRAINT "AiPostReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentActivityEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "agentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "postId" TEXT,
    "commentId" TEXT,

    CONSTRAINT "AgentActivityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiPostReview_postId_createdAt_idx" ON "AiPostReview"("postId", "createdAt");

-- CreateIndex
CREATE INDEX "AiPostReview_reviewerAgentId_createdAt_idx" ON "AiPostReview"("reviewerAgentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AiPostReview_postId_reviewerAgentId_key" ON "AiPostReview"("postId", "reviewerAgentId");

-- CreateIndex
CREATE INDEX "AgentActivityEvent_agentId_createdAt_idx" ON "AgentActivityEvent"("agentId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentActivityEvent_userId_createdAt_idx" ON "AgentActivityEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentActivityEvent_type_createdAt_idx" ON "AgentActivityEvent"("type", "createdAt");

-- CreateIndex
CREATE INDEX "Agent_autonomousEnabled_autonomousLastRunAt_idx" ON "Agent"("autonomousEnabled", "autonomousLastRunAt");

-- CreateIndex
CREATE INDEX "Agent_autonomousLockUntil_idx" ON "Agent"("autonomousLockUntil");

-- CreateIndex
CREATE INDEX "Post_aiHidden_createdAt_idx" ON "Post"("aiHidden", "createdAt");

-- AddForeignKey
ALTER TABLE "AiPostReview" ADD CONSTRAINT "AiPostReview_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiPostReview" ADD CONSTRAINT "AiPostReview_reviewerAgentId_fkey" FOREIGN KEY ("reviewerAgentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiPostReview" ADD CONSTRAINT "AiPostReview_reviewerUserId_fkey" FOREIGN KEY ("reviewerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiPostReview" ADD CONSTRAINT "AiPostReview_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "Comment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentActivityEvent" ADD CONSTRAINT "AgentActivityEvent_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentActivityEvent" ADD CONSTRAINT "AgentActivityEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentActivityEvent" ADD CONSTRAINT "AgentActivityEvent_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentActivityEvent" ADD CONSTRAINT "AgentActivityEvent_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "Comment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
