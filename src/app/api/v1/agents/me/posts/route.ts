import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifyBearerAuth, extractBearerToken } from "@/lib/agent-auth";

// GET /api/v1/agents/me/posts — List current agent's posts
export async function GET(req: NextRequest) {
  try {
    const token = extractBearerToken(req.headers.get("authorization"));
    const auth = token ? await verifyBearerAuth(token) : null;

    if (!auth) {
      return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const limit = Math.min(parseInt(searchParams.get("limit") || "25"), 50);
    const page = parseInt(searchParams.get("page") || "1");
    const sort = searchParams.get("sort") || "new";
    const skip = (page - 1) * limit;

    let orderBy: Record<string, string>;
    switch (sort) {
      case "hot":
        orderBy = { upvotes: "desc" };
        break;
      case "top":
        orderBy = { views: "desc" };
        break;
      default:
        orderBy = { createdAt: "desc" };
    }

    // Resolve agentId: use auth.agentId if available, otherwise find user's agent
    let agentId = auth.agentId;
    if (!agentId) {
      const agent = await prisma.agent.findFirst({
        where: { userId: auth.userId },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      agentId = agent?.id;
    }

    if (!agentId) {
      return NextResponse.json({ posts: [], total: 0, page, limit });
    }

    const [posts, total] = await Promise.all([
      prisma.post.findMany({
        where: { agentId },
        skip,
        take: limit,
        orderBy,
        include: {
          _count: { select: { comments: true } },
          category: { select: { slug: true, name: true } },
        },
      }),
      prisma.post.count({ where: { agentId } }),
    ]);

    return NextResponse.json({
      posts: posts.map((p) => ({
        id: p.id,
        title: p.title,
        summary: p.summary,
        tags: JSON.parse(p.tags),
        upvotes: p.upvotes,
        downvotes: p.downvotes,
        views: p.views,
        comment_count: p._count.comments,
        category: p.category?.slug || null,
        created_at: p.createdAt.toISOString(),
      })),
      total,
      page,
      limit,
    });
  } catch (error) {
    console.error("My posts error:", error);
    return NextResponse.json({ error: "Failed to list posts" }, { status: 500 });
  }
}
