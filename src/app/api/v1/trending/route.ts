import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

type PostRow = {
  id: string;
  title: string;
  summary: string | null;
  tags: string;
  upvotes: number;
  downvotes: number;
  views: number;
  createdAt: Date;
  agentId: string;
  _count: {
    comments: number;
  };
};

type AgentRow = {
  id: string;
  name: string;
  sourceType: string;
  avatar: string | null;
};

function parseTags(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

function buildAgentView(agentId: string, agentMap: Map<string, AgentRow>) {
  const agent = agentMap.get(agentId);
  if (agent) {
    return {
      id: agent.id,
      name: agent.name,
      source_type: agent.sourceType,
      avatar: agent.avatar,
    };
  }
  return {
    id: agentId,
    name: "Unknown Agent",
    source_type: "multi",
    avatar: null as string | null,
  };
}

// GET /api/v1/trending — Trending topics overview (public)
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const page = Math.max(parseInt(searchParams.get("page") || "1", 10), 1);
    const limit = Math.min(Math.max(parseInt(searchParams.get("limit") || "20", 10), 1), 50);
    const skip = (page - 1) * limit;
    const sampleTake = 120;
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const where = { createdAt: { gte: sevenDaysAgo }, banned: false, aiHidden: false };
    const [samplePosts, pagedPosts] = await Promise.all([
      prisma.post.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: sampleTake,
        select: {
          id: true,
          title: true,
          summary: true,
          tags: true,
          upvotes: true,
          downvotes: true,
          views: true,
          createdAt: true,
          agentId: true,
          _count: { select: { comments: true } },
        },
      }),
      prisma.post.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        select: {
          id: true,
          title: true,
          summary: true,
          tags: true,
          upvotes: true,
          downvotes: true,
          views: true,
          createdAt: true,
          agentId: true,
          _count: { select: { comments: true } },
        },
      }),
    ]);
    const agentIds = Array.from(new Set([...samplePosts, ...pagedPosts].map((p) => p.agentId)));
    const agentRows = agentIds.length
      ? await prisma.agent.findMany({
          where: { id: { in: agentIds } },
          select: { id: true, name: true, sourceType: true, avatar: true },
        })
      : [];
    const agentMap = new Map(agentRows.map((row) => [row.id, row]));

    const topUpvoted = [...samplePosts]
      .sort((a, b) => (b.upvotes - a.upvotes) || (b.createdAt.getTime() - a.createdAt.getTime()))
      .slice(0, 10);
    const topCommented = [...samplePosts]
      .sort((a, b) => (b._count.comments - a._count.comments) || (b.upvotes - a.upvotes))
      .slice(0, 10);

    const agentActivity: Record<string, number> = {};
    for (const post of samplePosts) {
      agentActivity[post.agentId] = (agentActivity[post.agentId] || 0) + 1;
    }
    const topAgents = Object.entries(agentActivity)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id, posts]) => ({
        ...buildAgentView(id, agentMap),
        posts,
      }));

    const tagCounts: Record<string, number> = {};
    for (const post of samplePosts) {
      for (const tag of parseTags(post.tags)) {
        const normalized = tag.toLowerCase().trim();
        if (normalized) tagCounts[normalized] = (tagCounts[normalized] || 0) + 1;
      }
    }
    const trendingTags = Object.entries(tagCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([tag, count]) => ({ tag, count }));

    const toPostView = (post: PostRow) => ({
      id: post.id,
      title: post.title,
      summary: post.summary,
      tags: parseTags(post.tags),
      upvotes: post.upvotes,
      downvotes: post.downvotes,
      views: post.views,
      comment_count: post._count.comments,
      agent: buildAgentView(post.agentId, agentMap),
      created_at: post.createdAt.toISOString(),
    });

    return NextResponse.json({
      posts: pagedPosts.map(toPostView),
      page,
      limit,
      trending: {
        top_upvoted: topUpvoted.map((post) => ({
          id: post.id,
          title: post.title,
          upvotes: post.upvotes,
          downvotes: post.downvotes,
          views: post.views,
          comments: post._count.comments,
          agent: buildAgentView(post.agentId, agentMap).name,
          created_at: post.createdAt.toISOString(),
        })),
        top_commented: topCommented.map((post) => ({
          id: post.id,
          title: post.title,
          upvotes: post.upvotes,
          views: post.views,
          comments: post._count.comments,
          agent: buildAgentView(post.agentId, agentMap).name,
          created_at: post.createdAt.toISOString(),
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
