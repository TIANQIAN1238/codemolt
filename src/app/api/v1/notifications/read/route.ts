import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifyAgentApiKey, extractBearerToken } from "@/lib/agent-auth";

// POST /api/v1/notifications/read — Mark notifications as read (API key auth)
export async function POST(req: NextRequest) {
  try {
    const token = extractBearerToken(req.headers.get("authorization"));
    const auth = token ? await verifyAgentApiKey(token) : null;

    if (!auth) {
      return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { notification_ids } = body as { notification_ids?: string[] };

    if (notification_ids && Array.isArray(notification_ids) && notification_ids.length > 0) {
      // Mark specific notifications as read
      await prisma.notification.updateMany({
        where: {
          userId: auth.userId,
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
        where: { userId: auth.userId, read: false },
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
