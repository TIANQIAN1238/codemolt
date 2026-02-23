import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import prisma from "@/lib/prisma";

// POST /api/auth/device-confirm — Confirm a device code after user logs in
// Only stores user identity. Agent selection happens on the agent side.
export async function POST(req: NextRequest) {
  const userId = await getCurrentUser();
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    const { user_code } = await req.json();

    if (!user_code || typeof user_code !== "string") {
      return NextResponse.json(
        { error: "user_code is required" },
        { status: 400 }
      );
    }

    const normalizedUserCode = user_code.trim().toUpperCase();
    if (!normalizedUserCode) {
      return NextResponse.json(
        { error: "user_code is required" },
        { status: 400 }
      );
    }

    const now = new Date();
    const record = await prisma.deviceCode.findUnique({
      where: { userCode: normalizedUserCode },
      select: {
        id: true,
        status: true,
        expiresAt: true,
      },
    });

    if (!record) {
      return NextResponse.json(
        { error: "Invalid code. Please check and try again." },
        { status: 404 }
      );
    }

    if (record.expiresAt <= now) {
      await prisma.deviceCode.updateMany({
        where: {
          id: record.id,
          status: { not: "expired" },
        },
        data: {
          status: "expired",
        },
      });
      return NextResponse.json(
        { error: "Code expired. Please request a new one in your IDE." },
        { status: 410 }
      );
    }

    if (record.status === "completed") {
      return NextResponse.json(
        { error: "Code already used." },
        { status: 409 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { username: true },
    });

    const updateResult = await prisma.deviceCode.updateMany({
      where: {
        id: record.id,
        status: "pending",
        expiresAt: { gt: now },
      },
      data: {
        status: "completed",
        userId,
        username: user?.username ?? null,
      },
    });

    if (updateResult.count === 0) {
      const latest = await prisma.deviceCode.findUnique({
        where: { id: record.id },
        select: { status: true, expiresAt: true },
      });

      if (!latest) {
        return NextResponse.json(
          { error: "Invalid code. Please check and try again." },
          { status: 404 }
        );
      }

      if (latest.expiresAt <= new Date()) {
        return NextResponse.json(
          { error: "Code expired. Please request a new one in your IDE." },
          { status: 410 }
        );
      }

      if (latest.status === "completed") {
        return NextResponse.json(
          { error: "Code already used." },
          { status: 409 }
        );
      }

      return NextResponse.json(
        { error: "Failed to confirm code. Please try again." },
        { status: 409 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Account authorized! You can close this window and return to your IDE.",
      username: user?.username ?? "",
    });
  } catch (error) {
    console.error("Device confirm error:", error);
    return NextResponse.json(
      { error: "Failed to confirm device code" },
      { status: 500 }
    );
  }
}
