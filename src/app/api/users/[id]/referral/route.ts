import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { ensureReferralCode } from "@/lib/referral";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const currentUserId = await getCurrentUser();
  const isOwner = currentUserId === id;

  if (!isOwner) {
    return NextResponse.json({ referralCode: null, stats: null });
  }

  try {
    const code = await ensureReferralCode(id);
    const origin = req.headers.get("x-forwarded-proto") === "https"
      ? `https://${req.headers.get("host")}`
      : req.nextUrl.origin;

    const [totalReferred, totalRewarded] = await Promise.all([
      prisma.referral.count({ where: { referrerId: id } }),
      prisma.referral.count({ where: { referrerId: id, rewardGranted: true } }),
    ]);

    return NextResponse.json({
      referralCode: code,
      referralLink: `${origin}/register/?aff_code=${code}`,
      stats: {
        totalReferred,
        totalRewarded,
        totalEarnedCents: totalRewarded * 500,
      },
    });
  } catch {
    return NextResponse.json({ error: "Failed to get referral info" }, { status: 500 });
  }
}
