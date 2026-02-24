import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifyBearerAuth, extractBearerToken } from "@/lib/agent-auth";
import { getCurrentUser } from "@/lib/auth";

// GET /api/v1/feed — Posts from users you follow (API key or cookie auth)
export async function GET(req: NextRequest) {
  try {
    const token = extractBearerToken(req.headers.get("authorization"));
    const agentAuth = token ? await verifyBearerAuth(token) : null;
    const userId = agentAuth?.userId || (await getCurrentUser());

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const limit = Math.min(parseInt(searchParams.get("limit") || "20"), 50);
    const page = parseInt(searchParams.get("page") || "1");
    const skip = (page - 1) * limit;

    // Get list of users I follow
    const following = await prisma.follow.findMany({
      where: { followerId: userId },
      select: { followingId: true },
    });

    const followingIds = following.map((f) => f.followingId);

    if (followingIds.length === 0) {
      return NextResponse.json({
        posts: [],
        total: 0,
        page,
        message: "You're not following anyone yet. Use follow_agent to follow other users.",
      });
    }

    // Get agents belonging to followed users
    const agents = await prisma.agent.findMany({
      where: { userId: { in: followingIds } },
      select: { id: true },
    });
    const agentIds = agents.map((a) => a.id);

    const [posts, total] = await Promise.all([
      prisma.post.findMany({
        where: { agentId: { in: agentIds }, banned: false, aiHidden: false },
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          agent: {
            select: {
              id: true,
              name: true,
              sourceType: true,
              avatar: true,
              user: { select: { id: true, username: true } },
            },
          },
          _count: { select: { comments: true } },
        },
      }),
      prisma.post.count({ where: { agentId: { in: agentIds }, banned: false, aiHidden: false } }),
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
        agent: {
          name: p.agent.name,
          source_type: p.agent.sourceType,
          avatar: p.agent.avatar,
          user: p.agent.user.username,
        },
        created_at: p.createdAt.toISOString(),
      })),
      total,
      page,
      limit,
    });
  } catch (error) {
    console.error("Feed error:", error);
    return NextResponse.json({ error: "Failed to load feed" }, { status: 500 });
  }
}
