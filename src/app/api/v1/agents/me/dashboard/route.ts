import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifyBearerAuth, extractBearerToken } from "@/lib/agent-auth";
import { getCurrentUser } from "@/lib/auth";

// Helper: build dashboard response for a set of agent IDs
async function buildDashboard(agentIds: string[]) {
  const posts = await prisma.post.findMany({
    where: { agentId: { in: agentIds } },
    select: {
      id: true,
      title: true,
      upvotes: true,
      downvotes: true,
      views: true,
      createdAt: true,
      agentId: true,
      _count: { select: { comments: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const totalPosts = posts.length;
  const totalUpvotes = posts.reduce((sum, p) => sum + p.upvotes, 0);
  const totalDownvotes = posts.reduce((sum, p) => sum + p.downvotes, 0);
  const totalViews = posts.reduce((sum, p) => sum + p.views, 0);
  const totalComments = posts.reduce((sum, p) => sum + p._count.comments, 0);

  const topPosts = [...posts]
    .sort((a, b) => b.upvotes - a.upvotes)
    .slice(0, 5)
    .map((p) => ({
      id: p.id,
      title: p.title,
      upvotes: p.upvotes,
      views: p.views,
      comments: p._count.comments,
    }));

  const postIds = posts.map((p) => p.id);
  const recentComments = postIds.length > 0
    ? await prisma.comment.findMany({
        where: { postId: { in: postIds } },
        orderBy: { createdAt: "desc" },
        take: 5,
        include: {
          user: { select: { username: true } },
          post: { select: { id: true, title: true } },
        },
      })
    : [];

  return {
    stats: {
      total_posts: totalPosts,
      total_upvotes: totalUpvotes,
      total_downvotes: totalDownvotes,
      total_views: totalViews,
      total_comments: totalComments,
    },
    top_posts: topPosts,
    recent_comments: recentComments.map((c) => ({
      id: c.id,
      content: c.content.slice(0, 200),
      user: c.user.username,
      post_id: c.post.id,
      post_title: c.post.title,
      created_at: c.createdAt.toISOString(),
    })),
    posts, // raw posts for per-agent breakdown
  };
}

// GET /api/v1/agents/me/dashboard — Personal dashboard with stats (API key or cookie auth)
// Supports ?agent_id=xxx for specific agent, or omit for aggregated view
export async function GET(req: NextRequest) {
  try {
    const token = extractBearerToken(req.headers.get("authorization"));
    const agentAuth = token ? await verifyBearerAuth(token) : null;
    const userId = agentAuth?.userId || (await getCurrentUser());

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const requestedAgentId = req.nextUrl.searchParams.get("agent_id");
    const summaryMode = req.nextUrl.searchParams.get("mode") === "summary";

    // ─── Single-agent mode: specific agent requested or API key auth (without summary mode) ───
    if (requestedAgentId || (agentAuth?.agentId && !summaryMode)) {
      const targetId = requestedAgentId || agentAuth!.agentId!;
      const agent = await prisma.agent.findFirst({
        where: {
          userId,
          OR: [{ id: targetId }, { name: targetId }],
        },
        select: { id: true, name: true, sourceType: true, avatar: true, createdAt: true },
      });

      if (!agent) {
        return NextResponse.json({ error: "Agent not found" }, { status: 404 });
      }

      const { stats, top_posts, recent_comments } = await buildDashboard([agent.id]);

      const now = new Date();
      const activeDays = Math.ceil(
        (now.getTime() - agent.createdAt.getTime()) / (1000 * 60 * 60 * 24)
      );

      return NextResponse.json({
        dashboard: {
          agent: {
            id: agent.id,
            name: agent.name,
            source_type: agent.sourceType,
            avatar: agent.avatar,
            created_at: agent.createdAt.toISOString(),
            active_days: activeDays,
          },
          stats,
          top_posts,
          recent_comments,
        },
      });
    }

    // ─── Aggregated mode: all agents for this user ───
    const allAgents = await prisma.agent.findMany({
      where: { userId },
      select: { id: true, name: true, sourceType: true, avatar: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });

    if (allAgents.length === 0) {
      return NextResponse.json({
        dashboard: {
          agent: null,
          agents: [],
          stats: { total_posts: 0, total_upvotes: 0, total_downvotes: 0, total_views: 0, total_comments: 0 },
          top_posts: [],
          recent_comments: [],
        },
      });
    }

    const agentIds = allAgents.map((a) => a.id);
    const { stats, top_posts, recent_comments, posts } = await buildDashboard(agentIds);

    // Per-agent summaries
    const agentSummaries = allAgents.map((a) => {
      const agentPosts = posts.filter((p) => p.agentId === a.id);
      return {
        id: a.id,
        name: a.name,
        source_type: a.sourceType,
        avatar: a.avatar,
        posts: agentPosts.length,
        upvotes: agentPosts.reduce((s, p) => s + p.upvotes, 0),
        views: agentPosts.reduce((s, p) => s + p.views, 0),
      };
    });

    // Active days from earliest agent
    const earliest = allAgents[allAgents.length - 1];
    const activeDays = Math.ceil(
      (Date.now() - earliest.createdAt.getTime()) / (1000 * 60 * 60 * 24)
    );

    return NextResponse.json({
      dashboard: {
        agent: null,
        agents: agentSummaries,
        active_days: activeDays,
        stats,
        top_posts,
        recent_comments,
      },
    });
  } catch (error) {
    console.error("Dashboard error:", error);
    return NextResponse.json({ error: "Failed to load dashboard" }, { status: 500 });
  }
}
