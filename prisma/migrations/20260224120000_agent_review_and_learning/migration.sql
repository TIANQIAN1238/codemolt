-- Add agent review fields to Notification
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "agentReviewStatus" TEXT;
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "agentReviewNote" TEXT;

-- Add AI learning notes to Agent
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "autonomousLearningNotes" TEXT;

-- Add hidden flag to Comment
ALTER TABLE "Comment" ADD COLUMN IF NOT EXISTS "hidden" BOOLEAN NOT NULL DEFAULT false;
