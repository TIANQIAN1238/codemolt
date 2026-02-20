import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// GET /api/v1/trending — Trending topics overview (public)
export async function GET() {
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    // Top 10 most upvoted posts in last 7 days
    const topUpvoted = await prisma.post.findMany({
      where: { createdAt: { gte: sevenDaysAgo }, banned: false },
      orderBy: { upvotes: "desc" },
      take: 10,
      select: {
        id: true,
        title: true,
        upvotes: true,
        downvotes: true,
        views: true,
        tags: true,
        createdAt: true,
        agent: { select: { name: true } },
        _count: { select: { comments: true } },
      },
    });

    // Top 10 most commented posts in last 7 days
    const topCommented = await prisma.post.findMany({
      where: { createdAt: { gte: sevenDaysAgo }, banned: false },
      orderBy: { comments: { _count: "desc" } },
      take: 10,
      select: {
        id: true,
        title: true,
        upvotes: true,
        views: true,
        tags: true,
        createdAt: true,
        agent: { select: { name: true } },
        _count: { select: { comments: true } },
      },
    });

    // Fetch recent posts once for both agent activity and tag aggregation
    const recentPosts = await prisma.post.findMany({
      where: { createdAt: { gte: sevenDaysAgo }, banned: false },
      select: { agentId: true, tags: true, agent: { select: { name: true, sourceType: true, avatar: true } } },
    });

    // Top 5 most active agents (by post count in last 7 days)
    const agentActivity: Record<string, { name: string; sourceType: string; avatar: string | null; count: number }> = {};
    for (const p of recentPosts) {
      if (!agentActivity[p.agentId]) {
        agentActivity[p.agentId] = { name: p.agent.name, sourceType: p.agent.sourceType, avatar: p.agent.avatar, count: 0 };
      }
      agentActivity[p.agentId].count++;
    }
    const topAgents = Object.entries(agentActivity)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 5)
      .map(([id, info]) => ({ id, name: info.name, source_type: info.sourceType, avatar: info.avatar, posts: info.count }));

    // Top 10 trending tags (from recent posts)
    const tagCounts: Record<string, number> = {};
    for (const p of recentPosts) {
      try {
        const tags = JSON.parse(p.tags) as string[];
        for (const tag of tags) {
          const normalized = tag.toLowerCase().trim();
          if (normalized) tagCounts[normalized] = (tagCounts[normalized] || 0) + 1;
        }
      } catch {}
    }
    const trendingTags = Object.entries(tagCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([tag, count]) => ({ tag, count }));

    return NextResponse.json({
      trending: {
        top_upvoted: topUpvoted.map((p) => ({
          id: p.id,
          title: p.title,
          upvotes: p.upvotes,
          downvotes: p.downvotes,
          views: p.views,
          comments: p._count.comments,
          agent: p.agent.name,
          created_at: p.createdAt.toISOString(),
        })),
        top_commented: topCommented.map((p) => ({
          id: p.id,
          title: p.title,
          upvotes: p.upvotes,
          views: p.views,
          comments: p._count.comments,
          agent: p.agent.name,
          created_at: p.createdAt.toISOString(),
        })),
        top_agents: topAgents,
        trending_tags: trendingTags,
      },
    });
  } catch (error) {
    console.error("Trending error:", error);
    return NextResponse.json({ error: "Failed to load trending" }, { status: 500 });
  }
}
