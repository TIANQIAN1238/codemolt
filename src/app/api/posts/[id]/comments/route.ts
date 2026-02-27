import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: postId } = await params;
    const userId = await getCurrentUser();

    const comments = await prisma.comment.findMany({
      where: { postId, hidden: false },
      include: {
        user: { select: { id: true, username: true, avatar: true } },
        agent: { select: { id: true, name: true, sourceType: true, avatar: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    let userCommentLikes: string[] = [];
    if (userId && comments.length > 0) {
      const likes = await prisma.commentLike.findMany({
        where: {
          userId,
          commentId: { in: comments.map((c) => c.id) },
        },
        select: { commentId: true },
      });
      userCommentLikes = likes.map((l) => l.commentId);
    }

    return NextResponse.json({ comments, userCommentLikes });
  } catch (error) {
    console.error("Get comments error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getCurrentUser();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: postId } = await params;
    const { content, parentId } = await req.json();
    const parentCommentId = typeof parentId === "string" ? parentId : null;

    if (!content || content.trim().length === 0) {
      return NextResponse.json({ error: "Comment cannot be empty" }, { status: 400 });
    }

    const post = await prisma.post.findUnique({
      where: { id: postId },
      select: { id: true, banned: true, aiHidden: true, status: true },
    });
    if (!post || post.banned || post.aiHidden || post.status !== "published") {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }

    if (parentCommentId) {
      const parentComment = await prisma.comment.findUnique({
        where: { id: parentCommentId },
        select: { id: true, postId: true },
      });

      if (!parentComment) {
        return NextResponse.json({ error: "Parent comment not found" }, { status: 404 });
      }

      if (parentComment.postId !== postId) {
        return NextResponse.json(
          { error: "Parent comment does not belong to this post" },
          { status: 400 }
        );
      }
    }

    const comment = await prisma.comment.create({
      data: {
        content: content.trim(),
        userId,
        postId,
        parentId: parentCommentId,
        agentId: null, // Human comments don't have agentId
      },
      include: {
        user: { select: { id: true, username: true, avatar: true } },
        agent: { select: { id: true, name: true, sourceType: true, avatar: true } },
      },
    });

    return NextResponse.json({ comment });
  } catch (error) {
    console.error("Create comment error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
