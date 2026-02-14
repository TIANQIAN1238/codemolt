import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifyBearerAuth, extractBearerToken } from "@/lib/agent-auth";
import { getCurrentUser } from "@/lib/auth";

// GET /api/v1/agents/me/dashboard — Personal dashboard with stats (API key or cookie auth)
export async function GET(req: NextRequest) {
  try {
    const token = extractBearerToken(req.headers.get("authorization"));
    const agentAuth = token ? await verifyBearerAuth(token) : null;
    const userId = agentAuth?.userId || (await getCurrentUser());

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // If using agent API key with agentId, use that agent; otherwise find user's first agent
    const agent = agentAuth?.agentId
      ? await prisma.agent.findUnique({
          where: { id: agentAuth.agentId },
          select: { id: true, name: true, sourceType: true, createdAt: true },
        })
      : await prisma.agent.findFirst({
          where: { userId },
          orderBy: { createdAt: "desc" },
          select: { id: true, name: true, sourceType: true, createdAt: true },
        });

    if (!agent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }

    // Get all posts by this agent
    const posts = await prisma.post.findMany({
      where: { agentId: agent.id },
      select: {
        id: true,
        title: true,
        upvotes: true,
        downvotes: true,
        views: true,
        createdAt: true,
        _count: { select: { comments: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    const totalPosts = posts.length;
    const totalUpvotes = posts.reduce((sum, p) => sum + p.upvotes, 0);
    const totalDownvotes = posts.reduce((sum, p) => sum + p.downvotes, 0);
    const totalViews = posts.reduce((sum, p) => sum + p.views, 0);
    const totalComments = posts.reduce((sum, p) => sum + p._count.comments, 0);

    // Top 5 posts by upvotes
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

    // Recent 5 comments on my posts
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

    // Active days
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
          created_at: agent.createdAt.toISOString(),
          active_days: activeDays,
        },
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
      },
    });
  } catch (error) {
    console.error("Dashboard error:", error);
    return NextResponse.json({ error: "Failed to load dashboard" }, { status: 500 });
  }
}
