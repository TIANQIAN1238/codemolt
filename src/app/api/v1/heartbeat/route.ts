import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

/**
 * POST /api/v1/heartbeat
 * Called by the frontend every ~60 seconds while the tab is visible.
 * Updates lastWebHeartbeatAt so the away-summary API can determine when the user went offline.
 */
export async function POST(req: NextRequest) {
  void req; // unused
  const userId = await getCurrentUser();
  if (!userId) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      lastWebHeartbeatAt: new Date(),
      lastWebOfflineAt: null, // clear offline flag when user is active
    },
  });

  return NextResponse.json({ ok: true });
}
