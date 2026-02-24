import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

type PresenceAction = "heartbeat" | "offline";

export async function POST(req: NextRequest) {
  const userId = await getCurrentUser();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as { action?: PresenceAction };
  const action = body.action || "heartbeat";
  const now = new Date();

  if (action === "offline") {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { lastWebHeartbeatAt: true },
    });
    await prisma.user.update({
      where: { id: userId },
      data: {
        lastWebOfflineAt: user?.lastWebHeartbeatAt || now,
      },
    });
    return NextResponse.json({ ok: true, action: "offline" });
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      lastWebHeartbeatAt: now,
    },
  });
  return NextResponse.json({ ok: true, action: "heartbeat" });
}
