import { randomBytes } from "crypto";
import prisma from "@/lib/prisma";

export function generateReferralCode(): string {
  return randomBytes(6).toString("base64url").slice(0, 8);
}

const MAX_REFERRAL_REWARDS = parseInt(process.env.MAX_REFERRAL_REWARDS || "20");

export async function ensureReferralCode(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { referralCode: true },
  });
  if (user?.referralCode) return user.referralCode;

  for (let i = 0; i < 5; i++) {
    const code = generateReferralCode();
    try {
      const result = await prisma.user.updateMany({
        where: { id: userId, referralCode: null },
        data: { referralCode: code },
      });
      if (result.count > 0) return code;
      // Another thread set it, re-fetch
      const refreshed = await prisma.user.findUnique({
        where: { id: userId },
        select: { referralCode: true },
      });
      if (refreshed?.referralCode) return refreshed.referralCode;
    } catch {
      // collision or race condition, retry
    }
  }
  throw new Error("Failed to generate unique referral code");
}

export async function linkReferral(newUserId: string, referralCode: string): Promise<void> {
  const referrer = await prisma.user.findUnique({
    where: { referralCode },
    select: { id: true },
  });
  if (!referrer || referrer.id === newUserId) return;

  try {
    await prisma.$transaction([
      prisma.user.update({
        where: { id: newUserId },
        data: { referredById: referrer.id },
      }),
      prisma.referral.create({
        data: { referrerId: referrer.id, referredUserId: newUserId },
      }),
    ]);
  } catch {
    // duplicate or constraint error, ignore
  }
}

export async function grantReferralReward(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { referredById: true },
  });
  if (!user?.referredById) return;

  // Check reward cap
  const grantedCount = await prisma.referral.count({
    where: { referrerId: user.referredById, rewardGranted: true },
  });
  if (grantedCount >= MAX_REFERRAL_REWARDS) return;

  try {
    // Use updateMany to atomically check rewardGranted=false (avoids race conditions)
    const result = await prisma.referral.updateMany({
      where: { referredUserId: userId, rewardGranted: false },
      data: { rewardGranted: true, grantedAt: new Date() },
    });
    if (result.count === 0) return; // already granted or not found

    await prisma.user.update({
      where: { id: user.referredById },
      data: { aiCreditCents: { increment: 500 } },
    });
    await prisma.notification.create({
      data: {
        type: "referral_reward",
        message: `Your referral published their first post! You earned $5.00 AI credit.`,
        userId: user.referredById,
        fromUserId: userId,
      },
    });
  } catch {
    // already granted or not found, ignore
  }
}
