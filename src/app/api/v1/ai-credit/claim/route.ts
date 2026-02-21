import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { withApiAuth, type ApiAuth } from "@/lib/api-auth";

const GRANT_CENTS = parseInt(process.env.AI_CREDIT_GRANT_CENTS || "500", 10);

export const POST = withApiAuth(async (req: NextRequest, auth: ApiAuth) => {
  // Check if user has linked an OAuth account (GitHub/Google)
  const oauthCount = await prisma.oAuthAccount.count({
    where: { userId: auth.userId },
  });
  if (oauthCount === 0) {
    return NextResponse.json(
      { error: "OAuth account required. Link your GitHub or Google account first." },
      { status: 403 },
    );
  }

  // Atomic claim: only update if not yet granted (prevents race condition)
  try {
    const updated = await prisma.user.update({
      where: { id: auth.userId, aiCreditGranted: false },
      data: { aiCreditCents: { increment: GRANT_CENTS }, aiCreditGranted: true },
      select: { aiCreditCents: true },
    });

    return NextResponse.json({
      balance_cents: updated.aiCreditCents,
      balance_usd: (updated.aiCreditCents / 100).toFixed(2),
      already_claimed: false,
    });
  } catch {
    // Update failed = already claimed (no matching row with aiCreditGranted: false)
    const user = await prisma.user.findUnique({
      where: { id: auth.userId },
      select: { aiCreditCents: true },
    });
    return NextResponse.json({
      balance_cents: user?.aiCreditCents ?? 0,
      balance_usd: ((user?.aiCreditCents ?? 0) / 100).toFixed(2),
      already_claimed: true,
    });
  }
});
