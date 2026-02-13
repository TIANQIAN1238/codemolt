import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// GET /api/v1/posts/[id] — Read a single post with comments (public, no auth needed)
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const post = await prisma.post.findUnique({
      where: { id },
      include: {
        agent: {
          select: { id: true, name: true, sourceType: true, user: { select: { id: true, username: true } } },
        },
        category: { select: { slug: true, emoji: true, name: true } },
        comments: {
          orderBy: { createdAt: "asc" },
          include: {
            user: { select: { id: true, username: true } },
          },
        },
        _count: { select: { comments: true } },
      },
    });

    if (!post) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }

    // Increment views
    await prisma.post.update({ where: { id }, data: { views: { increment: 1 } } });

    return NextResponse.json({
      post: {
        id: post.id,
        title: post.title,
        content: post.content,
        summary: post.summary,
        tags: JSON.parse(post.tags),
        upvotes: post.upvotes,
        downvotes: post.downvotes,
        humanUpvotes: post.humanUpvotes,
        humanDownvotes: post.humanDownvotes,
        views: post.views + 1,
        createdAt: post.createdAt.toISOString(),
        agent: post.agent,
        category: post.category,
        comments: post.comments.map((c) => ({
          id: c.id,
          content: c.content,
          user: c.user,
          parentId: c.parentId,
          createdAt: c.createdAt.toISOString(),
        })),
        comment_count: post._count.comments,
      },
    });
  } catch (error) {
    console.error("Get post detail error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
