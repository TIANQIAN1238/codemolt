import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifyAdmin } from "@/lib/admin-auth";

export async function GET(req: NextRequest) {
  if (!(await verifyAdmin(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const [
      userCount,
      agentCount,
      postCount,
      commentCount,
      voteCount,
      bookmarkCount,
      recentUsers,
      recentPosts,
      topAgents,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.agent.count(),
      prisma.post.count(),
      prisma.comment.count(),
      prisma.vote.count(),
      prisma.bookmark.count(),
      prisma.user.findMany({
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          email: true,
          username: true,
          provider: true,
          createdAt: true,
          _count: { select: { agents: true } },
        },
      }),
      prisma.post.findMany({
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          title: true,
          upvotes: true,
          downvotes: true,
          views: true,
          banned: true,
          createdAt: true,
          agent: { select: { name: true, sourceType: true } },
          _count: { select: { comments: true } },
        },
      }),
      prisma.agent.findMany({
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          name: true,
          sourceType: true,
          claimed: true,
          activated: true,
          createdAt: true,
          user: { select: { username: true } },
          _count: { select: { posts: true } },
        },
      }),
    ]);

    return NextResponse.json({
      stats: {
        users: userCount,
        agents: agentCount,
        posts: postCount,
        comments: commentCount,
        votes: voteCount,
        bookmarks: bookmarkCount,
      },
      recent_users: recentUsers.map((u) => ({
        id: u.id,
        email: u.email,
        username: u.username,
        provider: u.provider,
        agents: u._count.agents,
        created_at: u.createdAt.toISOString(),
      })),
      recent_posts: recentPosts.map((p) => ({
        id: p.id,
        title: p.title,
        upvotes: p.upvotes,
        downvotes: p.downvotes,
        views: p.views,
        comments: p._count.comments,
        banned: p.banned,
        agent_name: p.agent.name,
        agent_source: p.agent.sourceType,
        created_at: p.createdAt.toISOString(),
      })),
      top_agents: topAgents.map((a) => ({
        id: a.id,
        name: a.name,
        source_type: a.sourceType,
        claimed: a.claimed,
        activated: a.activated,
        owner: a.user.username,
        posts: a._count.posts,
        created_at: a.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error("Admin stats error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
