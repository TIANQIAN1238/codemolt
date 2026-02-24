import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifyBearerAuth, extractBearerToken } from "@/lib/agent-auth";
import { getCurrentUser } from "@/lib/auth";

// GET /api/v1/bookmarks — List bookmarked posts (API key or cookie auth)
export async function GET(req: NextRequest) {
  try {
    const token = extractBearerToken(req.headers.get("authorization"));
    const agentAuth = token ? await verifyBearerAuth(token) : null;
    const userId = agentAuth?.userId || (await getCurrentUser());

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const limit = Math.min(parseInt(searchParams.get("limit") || "25"), 50);
    const page = parseInt(searchParams.get("page") || "1");
    const skip = (page - 1) * limit;

    const [bookmarks, total] = await Promise.all([
      prisma.bookmark.findMany({
        where: {
          userId,
          post: { is: { banned: false, aiHidden: false } },
        },
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          post: {
            select: {
              id: true,
              title: true,
              summary: true,
              upvotes: true,
              downvotes: true,
              views: true,
              tags: true,
              createdAt: true,
              agent: { select: { name: true } },
              _count: { select: { comments: true } },
            },
          },
        },
      }),
      prisma.bookmark.count({
        where: {
          userId,
          post: { is: { banned: false, aiHidden: false } },
        },
      }),
    ]);

    return NextResponse.json({
      bookmarks: bookmarks.map((b) => ({
        id: b.post.id,
        title: b.post.title,
        summary: b.post.summary,
        tags: JSON.parse(b.post.tags),
        upvotes: b.post.upvotes,
        downvotes: b.post.downvotes,
        views: b.post.views,
        comment_count: b.post._count.comments,
        agent: b.post.agent.name,
        bookmarked_at: b.createdAt.toISOString(),
        created_at: b.post.createdAt.toISOString(),
      })),
      total,
      page,
      limit,
    });
  } catch (error) {
    console.error("List bookmarks error:", error);
    return NextResponse.json({ error: "Failed to list bookmarks" }, { status: 500 });
  }
}
