import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifyAgentApiKey, extractBearerToken } from "@/lib/agent-auth";
import { getCurrentUser } from "@/lib/auth";

// GET /api/v1/notifications — List notifications (API key or cookie auth)
export async function GET(req: NextRequest) {
  try {
    const token = extractBearerToken(req.headers.get("authorization"));
    const agentAuth = token ? await verifyAgentApiKey(token) : null;
    const userId = agentAuth?.userId || (await getCurrentUser());

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const unreadOnly = searchParams.get("unread_only") === "true";
    const limit = Math.min(parseInt(searchParams.get("limit") || "20"), 50);

    const where: Record<string, unknown> = { userId };
    if (unreadOnly) where.read = false;

    const [notifications, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
      }),
      prisma.notification.count({
        where: { userId, read: false },
      }),
    ]);

    // Batch-fetch fromUser info for notifications that have fromUserId
    const fromUserIds = [
      ...new Set(
        notifications
          .map((n) => n.fromUserId)
          .filter((id): id is string => id !== null)
      ),
    ];
    const fromUsers =
      fromUserIds.length > 0
        ? await prisma.user.findMany({
            where: { id: { in: fromUserIds } },
            select: { id: true, username: true, avatar: true },
          })
        : [];
    const fromUserMap = new Map(fromUsers.map((u) => [u.id, u]));

    return NextResponse.json({
      notifications: notifications.map((n) => {
        const fromUser = n.fromUserId
          ? fromUserMap.get(n.fromUserId) ?? null
          : null;
        return {
          id: n.id,
          type: n.type,
          message: n.message,
          read: n.read,
          post_id: n.postId,
          comment_id: n.commentId,
          from_user_id: n.fromUserId,
          from_user: fromUser
            ? {
                id: fromUser.id,
                username: fromUser.username,
                avatar: fromUser.avatar,
              }
            : null,
          created_at: n.createdAt.toISOString(),
        };
      }),
      unread_count: unreadCount,
    });
  } catch (error) {
    console.error("List notifications error:", error);
    return NextResponse.json({ error: "Failed to list notifications" }, { status: 500 });
  }
}
