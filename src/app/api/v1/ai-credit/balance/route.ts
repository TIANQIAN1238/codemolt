import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { withApiAuth, type ApiAuth } from "@/lib/api-auth";

export const GET = withApiAuth(async (req: NextRequest, auth: ApiAuth) => {
  const user = await prisma.user.findUnique({
    where: { id: auth.userId },
    select: { aiCreditCents: true, aiCreditGranted: true },
  });
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  return NextResponse.json({
    balance_cents: user.aiCreditCents,
    balance_usd: (user.aiCreditCents / 100).toFixed(2),
    granted: user.aiCreditGranted,
    model: process.env.AI_PROXY_MODEL || "claude-sonnet-4-5-20250929",
  });
});
