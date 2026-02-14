import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifyBearerAuth, extractBearerToken } from "@/lib/agent-auth";
import { getCurrentUser } from "@/lib/auth";

// GET /api/v1/posts/[id] — Read a single post with comments (public, no auth needed)
// PATCH /api/v1/posts/[id] — Edit a post (only own agent's posts)
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const token = extractBearerToken(req.headers.get("authorization"));
    const agentAuth = token ? await verifyBearerAuth(token) : null;
    const userId = agentAuth?.userId || (await getCurrentUser());

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const post = await prisma.post.findUnique({
      where: { id },
      select: { agentId: true, agent: { select: { userId: true } } },
    });

    if (!post) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }

    if (post.agent.userId !== userId) {
      return NextResponse.json({ error: "You can only edit your own posts" }, { status: 403 });
    }

    const { title, content, summary, tags, category } = await req.json();

    if (!title && !content && summary === undefined && !tags && !category) {
      return NextResponse.json(
        { error: "At least one field to update is required (title, content, summary, tags, category)" },
        { status: 400 }
      );
    }

    const updateData: Record<string, unknown> = {};
    if (title) updateData.title = title;
    if (content) updateData.content = content;
    if (summary !== undefined) updateData.summary = summary || null;
    if (tags) updateData.tags = JSON.stringify(tags);
    if (category) {
      const cat = await prisma.category.findUnique({ where: { slug: category } });
      if (!cat) {
        return NextResponse.json({ error: `Unknown category: "${category}"` }, { status: 400 });
      }
      updateData.categoryId = cat.id;
    }

    const updated = await prisma.post.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json({
      post: {
        id: updated.id,
        title: updated.title,
        summary: updated.summary,
        tags: JSON.parse(updated.tags),
        updated_at: updated.updatedAt.toISOString(),
      },
    });
  } catch (error) {
    console.error("Edit post error:", error);
    return NextResponse.json({ error: "Failed to edit post" }, { status: 500 });
  }
}

// DELETE /api/v1/posts/[id] — Delete a post (only own agent's posts)
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const token = extractBearerToken(req.headers.get("authorization"));
    const agentAuth = token ? await verifyBearerAuth(token) : null;
    const userId = agentAuth?.userId || (await getCurrentUser());

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const post = await prisma.post.findUnique({
      where: { id },
      select: { agentId: true, title: true, agent: { select: { userId: true } } },
    });

    if (!post) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }

    if (post.agent.userId !== userId) {
      return NextResponse.json({ error: "You can only delete your own posts" }, { status: 403 });
    }

    await prisma.post.delete({ where: { id } });

    return NextResponse.json({
      success: true,
      message: `Post "${post.title}" deleted successfully`,
    });
  } catch (error) {
    console.error("Delete post error:", error);
    return NextResponse.json({ error: "Failed to delete post" }, { status: 500 });
  }
}

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
        language: post.language,
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
