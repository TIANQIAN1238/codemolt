-- AlterTable
ALTER TABLE "Agent"
ADD COLUMN "personaPreset" TEXT NOT NULL DEFAULT 'elys-balanced',
ADD COLUMN "personaWarmth" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN "personaHumor" INTEGER NOT NULL DEFAULT 25,
ADD COLUMN "personaDirectness" INTEGER NOT NULL DEFAULT 70,
ADD COLUMN "personaDepth" INTEGER NOT NULL DEFAULT 65,
ADD COLUMN "personaChallenge" INTEGER NOT NULL DEFAULT 55,
ADD COLUMN "personaMode" TEXT NOT NULL DEFAULT 'shadow',
ADD COLUMN "personaConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
ADD COLUMN "personaVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "personaLastLearnAt" TIMESTAMP(3),
ADD COLUMN "personaLastPromotedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Notification"
ADD COLUMN "agentStyleConfidence" DOUBLE PRECISION,
ADD COLUMN "agentPersonaMode" TEXT;

-- CreateTable
CREATE TABLE "AgentPersonaSignal" (
    "id" TEXT NOT NULL,
    "signalType" TEXT NOT NULL,
    "direction" INTEGER NOT NULL,
    "dimensions" TEXT,
    "note" TEXT,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "agentId" TEXT NOT NULL,
    "notificationId" TEXT,

    CONSTRAINT "AgentPersonaSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentPersonaSnapshot" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "preset" TEXT NOT NULL,
    "warmth" INTEGER NOT NULL,
    "humor" INTEGER NOT NULL,
    "directness" INTEGER NOT NULL,
    "depth" INTEGER NOT NULL,
    "challenge" INTEGER NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "agentId" TEXT NOT NULL,

    CONSTRAINT "AgentPersonaSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentPersonaSignal_agentId_createdAt_idx" ON "AgentPersonaSignal"("agentId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentPersonaSignal_signalType_createdAt_idx" ON "AgentPersonaSignal"("signalType", "createdAt");

-- CreateIndex
CREATE INDEX "AgentPersonaSignal_notificationId_idx" ON "AgentPersonaSignal"("notificationId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentPersonaSnapshot_agentId_version_key" ON "AgentPersonaSnapshot"("agentId", "version");

-- CreateIndex
CREATE INDEX "AgentPersonaSnapshot_agentId_createdAt_idx" ON "AgentPersonaSnapshot"("agentId", "createdAt");

-- AddForeignKey
ALTER TABLE "AgentPersonaSignal" ADD CONSTRAINT "AgentPersonaSignal_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentPersonaSignal" ADD CONSTRAINT "AgentPersonaSignal_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentPersonaSnapshot" ADD CONSTRAINT "AgentPersonaSnapshot_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
