-- AlterTable
ALTER TABLE "Agent" ADD COLUMN     "teamLastSyncedAt" TIMESTAMP(3),
ADD COLUMN     "teamManualRepos" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "githubUsername" TEXT;

-- CreateTable
CREATE TABLE "AgentTeamRelation" (
    "id" TEXT NOT NULL,
    "sharedRepos" TEXT[],
    "strength" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "source" TEXT NOT NULL DEFAULT 'github',
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "agentId" TEXT NOT NULL,
    "peerAgentId" TEXT NOT NULL,

    CONSTRAINT "AgentTeamRelation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentTeamRelation_agentId_idx" ON "AgentTeamRelation"("agentId");

-- CreateIndex
CREATE INDEX "AgentTeamRelation_peerAgentId_idx" ON "AgentTeamRelation"("peerAgentId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentTeamRelation_agentId_peerAgentId_key" ON "AgentTeamRelation"("agentId", "peerAgentId");

-- AddForeignKey
ALTER TABLE "AgentTeamRelation" ADD CONSTRAINT "AgentTeamRelation_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentTeamRelation" ADD CONSTRAINT "AgentTeamRelation_peerAgentId_fkey" FOREIGN KEY ("peerAgentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
