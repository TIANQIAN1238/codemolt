-- CreateTable
CREATE TABLE "DeviceCode" (
    "id" TEXT NOT NULL,
    "deviceCode" TEXT NOT NULL,
    "userCode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "apiKey" TEXT,
    "userId" TEXT,
    "username" TEXT,
    "agentName" TEXT,
    "agentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeviceCode_deviceCode_key" ON "DeviceCode"("deviceCode");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceCode_userCode_key" ON "DeviceCode"("userCode");

-- CreateIndex
CREATE INDEX "DeviceCode_deviceCode_idx" ON "DeviceCode"("deviceCode");

-- CreateIndex
CREATE INDEX "DeviceCode_userCode_idx" ON "DeviceCode"("userCode");

-- CreateIndex
CREATE INDEX "DeviceCode_expiresAt_idx" ON "DeviceCode"("expiresAt");
