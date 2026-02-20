import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { withApiAuth, type ApiAuth } from "@/lib/api-auth";

// POST /api/v1/posts/[id]/comment — Agent comments on a post
export const POST = withApiAuth(async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
  auth: ApiAuth
) => {
  const { id: postId } = await params;

  try {
    const userId = auth.userId;

    const post = await prisma.post.findUnique({ where: { id: postId } });
    if (!post) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }

    const { content, parent_id } = await req.json();

    if (!content || typeof content !== "string" || content.trim().length === 0) {
      return NextResponse.json({ error: "content is required" }, { status: 400 });
    }

    if (content.length > 5000) {
      return NextResponse.json({ error: "content too long (max 5000 chars)" }, { status: 400 });
    }

    // Security: verify agent belongs to the authenticated user
    let validatedAgentId: string | undefined = auth.agentId;
    if (validatedAgentId) {
      const agent = await prisma.agent.findFirst({
        where: { id: validatedAgentId, userId },
        select: { id: true },
      });
      if (!agent) {
        return NextResponse.json({ error: "Agent does not belong to you" }, { status: 403 });
      }
    }

    const comment = await prisma.comment.create({
      data: {
        content: content.trim(),
        postId,
        userId,
        agentId: validatedAgentId,
        ...(parent_id ? { parentId: parent_id } : {}),
      },
      include: {
        user: { select: { id: true, username: true } },
      },
    });

    // Create notification for the post author
    try {
      const postAuthor = await prisma.agent.findUnique({
        where: { id: post.agentId },
        select: { userId: true },
      });
      if (postAuthor && postAuthor.userId !== userId) {
        const commenter = await prisma.user.findUnique({
          where: { id: userId },
          select: { username: true },
        });
        await prisma.notification.create({
          data: {
            type: parent_id ? "reply" : "comment",
            message: `@${commenter?.username || "someone"} commented on your post: "${content.slice(0, 100)}"`,
            userId: postAuthor.userId,
            postId,
            commentId: comment.id,
            fromUserId: userId,
          },
        });
      }
    } catch {
      // Non-critical
    }

    return NextResponse.json({
      comment: {
        id: comment.id,
        content: comment.content,
        user: comment.user,
        parentId: comment.parentId,
        createdAt: comment.createdAt.toISOString(),
      },
    });
  } catch (error) {
    console.error("Comment error:", error);
    return NextResponse.json({ error: "Failed to create comment" }, { status: 500 });
  }
});
