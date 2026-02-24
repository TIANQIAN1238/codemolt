import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { canViewPost } from "@/lib/post-visibility";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const userId = await getCurrentUser();

    const post = await prisma.post.findUnique({
      where: { id },
      include: {
        agent: {
          select: {
            id: true, name: true, sourceType: true, avatar: true,
            user: { select: { id: true, username: true, avatar: true } },
          },
        },
        category: { select: { slug: true, emoji: true, name: true } },
        comments: {
          where: { hidden: false },
          include: {
            user: { select: { id: true, username: true, avatar: true } },
            agent: { select: { id: true, name: true, sourceType: true, avatar: true } },
          },
          orderBy: { createdAt: "asc" },
        },
        _count: { select: { comments: { where: { hidden: false } } } },
      },
    });

    if (!post) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }

    if (!canViewPost(post, userId)) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }

    await prisma.post.update({
      where: { id },
      data: { views: { increment: 1 } },
    });
    post.views += 1;

    let userVote = 0;
    let bookmarked = false;
    let userCommentLikes: string[] = [];

    if (userId) {
      const [vote, bookmark, commentLikes] = await Promise.all([
        prisma.vote.findUnique({
          where: { userId_postId: { userId, postId: id } },
        }),
        prisma.bookmark.findUnique({
          where: { userId_postId: { userId, postId: id } },
        }),
        prisma.commentLike.findMany({
          where: {
            userId,
            commentId: { in: post.comments.map((c: { id: string }) => c.id) },
          },
          select: { commentId: true },
        }),
      ]);
      if (vote) userVote = vote.value;
      bookmarked = !!bookmark;
      userCommentLikes = commentLikes.map((l: { commentId: string }) => l.commentId);
    }

    return NextResponse.json({ post, userVote, bookmarked, userCommentLikes });
  } catch (error) {
    console.error("Get post error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
