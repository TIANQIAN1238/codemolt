import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifyBearerAuth, extractBearerToken } from "@/lib/agent-auth";
import { getCurrentUser } from "@/lib/auth";

function resolveNotificationActionTarget(notification: {
  type: string;
  agentEventKind: string | null;
  message: string;
  postId: string | null;
  commentId: string | null;
}): string | null {
  if (notification.type !== "agent_event") return null;
  if (notification.agentEventKind !== "system") return null;
  if (notification.postId || notification.commentId) return null;

  const message = notification.message.toLowerCase();
  const shouldOpenAiProviderSettings = /platform credit exhausted|insufficient credit|billing failed|payment failed|configure your provider in settings|configure your own ai provider|ai provider unavailable|平台额度已用尽|额度已用尽|扣费失败|计费失败|配置你的 provider|配置ai provider|ai 提供商不可用/.test(
    message,
  );

  return shouldOpenAiProviderSettings ? "/settings#ai-provider" : null;
}

// GET /api/v1/notifications — List notifications (API key or cookie auth)
export async function GET(req: NextRequest) {
  try {
    const token = extractBearerToken(req.headers.get("authorization"));
    const agentAuth = token ? await verifyBearerAuth(token) : null;
    const userId = agentAuth?.userId || (await getCurrentUser());

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const unreadOnly = searchParams.get("unread_only") === "true";
    const limit = Math.min(parseInt(searchParams.get("limit") || "20"), 50);

    const where: Record<string, unknown> = {
      userId,
      NOT: { type: "agent_summary" },
    };
    if (unreadOnly) where.read = false;

    const [notifications, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
      }),
      prisma.notification.count({
        where: { userId, read: false, NOT: { type: "agent_summary" } },
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
    const commentIds = [
      ...new Set(
        notifications
          .map((n) => n.commentId)
          .filter((id): id is string => id !== null),
      ),
    ];
    const comments =
      commentIds.length > 0
        ? await prisma.comment.findMany({
            where: { id: { in: commentIds } },
            select: { id: true, content: true, postId: true },
          })
        : [];
    const commentMap = new Map(comments.map((c) => [c.id, c]));

    return NextResponse.json({
      notifications: notifications.map((n) => {
        const fromUser = n.fromUserId
          ? fromUserMap.get(n.fromUserId) ?? null
          : null;
        const comment = n.commentId ? (commentMap.get(n.commentId) ?? null) : null;
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
          agent_review_status: n.agentReviewStatus ?? null,
          agent_review_note: n.agentReviewNote ?? null,
          event_kind: n.agentEventKind ?? null,
          agent_style_confidence: typeof n.agentStyleConfidence === "number" ? n.agentStyleConfidence : null,
          agent_persona_mode: n.agentPersonaMode ?? null,
          agent_id: n.agentId ?? null,
          comment_content: comment?.content ?? null,
          comment_post_id: comment?.postId ?? null,
          action_target: resolveNotificationActionTarget({
            type: n.type,
            agentEventKind: n.agentEventKind,
            message: n.message,
            postId: n.postId,
            commentId: n.commentId,
          }),
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
