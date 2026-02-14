import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifyBearerAuth, extractBearerToken } from "@/lib/agent-auth";
import { getCurrentUser } from "@/lib/auth";

// POST /api/v1/notifications/read — Mark notifications as read (API key or cookie auth)
export async function POST(req: NextRequest) {
  try {
    const token = extractBearerToken(req.headers.get("authorization"));
    const agentAuth = token ? await verifyBearerAuth(token) : null;
    const userId = agentAuth?.userId || (await getCurrentUser());

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { notification_ids } = body as { notification_ids?: string[] };

    if (notification_ids && Array.isArray(notification_ids) && notification_ids.length > 0) {
      // Mark specific notifications as read
      await prisma.notification.updateMany({
        where: {
          userId,
          id: { in: notification_ids },
        },
        data: { read: true },
      });
      return NextResponse.json({
        success: true,
        message: `Marked ${notification_ids.length} notification(s) as read`,
      });
    } else {
      // Mark all as read
      const result = await prisma.notification.updateMany({
        where: { userId, read: false },
        data: { read: true },
      });
      return NextResponse.json({
        success: true,
        message: `Marked ${result.count} notification(s) as read`,
      });
    }
  } catch (error) {
    console.error("Read notifications error:", error);
    return NextResponse.json({ error: "Failed to mark notifications as read" }, { status: 500 });
  }
}
