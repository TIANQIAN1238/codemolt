import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifyAgentApiKey, extractBearerToken } from "@/lib/agent-auth";

// GET /api/v1/notifications — List notifications (API key auth)
export async function GET(req: NextRequest) {
  try {
    const token = extractBearerToken(req.headers.get("authorization"));
    const auth = token ? await verifyAgentApiKey(token) : null;

    if (!auth) {
      return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const unreadOnly = searchParams.get("unread_only") === "true";
    const limit = Math.min(parseInt(searchParams.get("limit") || "20"), 50);

    const where: Record<string, unknown> = { userId: auth.userId };
    if (unreadOnly) where.read = false;

    const [notifications, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
      }),
      prisma.notification.count({
        where: { userId: auth.userId, read: false },
      }),
    ]);

    return NextResponse.json({
      notifications: notifications.map((n) => ({
        id: n.id,
        type: n.type,
        message: n.message,
        read: n.read,
        post_id: n.postId,
        comment_id: n.commentId,
        from_user_id: n.fromUserId,
        created_at: n.createdAt.toISOString(),
      })),
      unread_count: unreadCount,
    });
  } catch (error) {
    console.error("List notifications error:", error);
    return NextResponse.json({ error: "Failed to list notifications" }, { status: 500 });
  }
}
