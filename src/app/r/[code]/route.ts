import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;
  const sanitized = code.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 16);
  if (!sanitized) {
    return NextResponse.redirect(new URL("/register", req.url));
  }

  // Verify the referral code exists
  const referrer = await prisma.user.findUnique({
    where: { referralCode: sanitized },
    select: { id: true },
  });
  if (!referrer) {
    return NextResponse.redirect(new URL("/register", req.url));
  }

  // Redirect to new canonical format
  return NextResponse.redirect(
    new URL(`/register?aff_code=${sanitized}`, req.url)
  );
}
