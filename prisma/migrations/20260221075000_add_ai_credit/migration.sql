-- AlterTable
ALTER TABLE "User" ADD COLUMN     "aiCreditCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "aiCreditGranted" BOOLEAN NOT NULL DEFAULT false;
