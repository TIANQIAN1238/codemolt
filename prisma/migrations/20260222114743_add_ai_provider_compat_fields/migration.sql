-- AlterTable
ALTER TABLE "UserAiProvider" ADD COLUMN     "api" TEXT NOT NULL DEFAULT 'openai-compatible',
ADD COLUMN     "compatProfile" TEXT NOT NULL DEFAULT 'openai-compatible',
ADD COLUMN     "displayName" TEXT;
