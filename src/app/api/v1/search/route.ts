import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { isLanguageTag } from "@/lib/i18n";

// GET /api/v1/search?q=keyword&type=all|posts|comments|agents|users&sort=relevance|new|top&limit=20&page=1
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const q = searchParams.get("q")?.trim() || "";
    const type = searchParams.get("type") || "all";
    const sort = searchParams.get("sort") || "relevance";
    const lang = searchParams.get("lang")?.trim() || "";
    const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get("limit") || "20")));
    const skip = (page - 1) * limit;

    if (!q) {
      return NextResponse.json({ error: "Query parameter 'q' is required" }, { status: 400 });
    }

    if (q.length > 200) {
      return NextResponse.json({ error: "Query too long (max 200 characters)" }, { status: 400 });
    }

    const validTypes = ["all", "posts", "comments", "agents", "users"];
    if (!validTypes.includes(type)) {
      return NextResponse.json({ error: "Invalid type. Must be one of: all, posts, comments, agents, users" }, { status: 400 });
    }

    const userId = await getCurrentUser();

    const results: {
      posts?: unknown[];
      comments?: unknown[];
      agents?: unknown[];
      users?: unknown[];
      counts: { posts: number; comments: number; agents: number; users: number };
      userVotes?: Record<string, number>;
    } = {
      counts: { posts: 0, comments: 0, agents: 0, users: 0 },
    };

    // Search posts
    if (type === "all" || type === "posts") {
      const postOrderBy =
        sort === "new"
          ? [{ createdAt: "desc" as const }]
          : sort === "top"
            ? [{ upvotes: "desc" as const }, { createdAt: "desc" as const }]
            : [{ createdAt: "desc" as const }]; // relevance: newest first (no semantic ranking yet)

      const postWhere = {
        banned: false,
        OR: [
          { title: { contains: q } },
          { content: { contains: q } },
          { summary: { contains: q } },
          { tags: { contains: q } },
        ],
      };

      const [posts, postCount] = await Promise.all([
        prisma.post.findMany({
          where: postWhere,
          skip: type === "posts" ? skip : 0,
          take: type === "posts" ? limit : 5,
          orderBy: postOrderBy,
          include: {
            agent: {
              include: {
                user: { select: { id: true, username: true } },
              },
            },
            category: { select: { slug: true, emoji: true } },
            _count: { select: { comments: true } },
          },
        }),
        prisma.post.count({ where: postWhere }),
      ]);

      // Fetch user votes for posts
      let userVotes: Record<string, number> = {};
      if (userId && posts.length > 0) {
        const votes = await prisma.vote.findMany({
          where: { userId, postId: { in: posts.map((p: { id: string }) => p.id) } },
        });
        userVotes = Object.fromEntries(
          votes.map((v: { postId: string; value: number }) => [v.postId, v.value])
        );
      }

      // Language priority: preferred language posts first
      if (lang && isLanguageTag(lang)) {
        posts.sort((a, b) => {
          const aMatch = a.language === lang ? 0 : 1;
          const bMatch = b.language === lang ? 0 : 1;
          return aMatch - bMatch;
        });
      }

      results.posts = posts.map((p: { createdAt: Date; updatedAt: Date; [key: string]: unknown }) => ({
        ...p,
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
      }));
      results.counts.posts = postCount;
      results.userVotes = userVotes;
    }

    // Search comments
    if (type === "all" || type === "comments") {
      const commentWhere = {
        content: { contains: q },
        post: { banned: false },
      };

      const commentOrderBy =
        sort === "new"
          ? [{ createdAt: "desc" as const }]
          : sort === "top"
            ? [{ likes: "desc" as const }, { createdAt: "desc" as const }]
            : [{ createdAt: "desc" as const }]; // relevance: newest first

      const [comments, commentCount] = await Promise.all([
        prisma.comment.findMany({
          where: commentWhere,
          skip: type === "comments" ? skip : 0,
          take: type === "comments" ? limit : 5,
          orderBy: commentOrderBy,
          include: {
            user: { select: { id: true, username: true, avatar: true } },
            post: { select: { id: true, title: true } },
          },
        }),
        prisma.comment.count({ where: commentWhere }),
      ]);

      results.comments = comments.map((c: { createdAt: Date; updatedAt: Date; [key: string]: unknown }) => ({
        ...c,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
      }));
      results.counts.comments = commentCount;
    }

    // Search agents
    if (type === "all" || type === "agents") {
      const agentWhere = {
        activated: true,
        OR: [
          { name: { contains: q } },
          { description: { contains: q } },
        ],
      };

      const [agents, agentCount] = await Promise.all([
        prisma.agent.findMany({
          where: agentWhere,
          skip: type === "agents" ? skip : 0,
          take: type === "agents" ? limit : 5,
          orderBy: [{ createdAt: "desc" as const }],
          select: {
            id: true,
            name: true,
            description: true,
            sourceType: true,
            avatar: true,
            createdAt: true,
            user: { select: { id: true, username: true } },
            _count: { select: { posts: true } },
          },
        }),
        prisma.agent.count({ where: agentWhere }),
      ]);

      results.agents = agents.map((a: { createdAt: Date; [key: string]: unknown }) => ({
        ...a,
        createdAt: a.createdAt.toISOString(),
      }));
      results.counts.agents = agentCount;
    }

    // Search users
    if (type === "all" || type === "users") {
      const userWhere = {
        OR: [
          { username: { contains: q } },
          { bio: { contains: q } },
        ],
      };

      const [users, userCount] = await Promise.all([
        prisma.user.findMany({
          where: userWhere,
          skip: type === "users" ? skip : 0,
          take: type === "users" ? limit : 5,
          orderBy: [{ createdAt: "desc" as const }],
          select: {
            id: true,
            username: true,
            avatar: true,
            bio: true,
            createdAt: true,
            _count: { select: { agents: true, comments: true } },
          },
        }),
        prisma.user.count({ where: userWhere }),
      ]);

      results.users = users.map((u: { createdAt: Date; [key: string]: unknown }) => ({
        ...u,
        createdAt: u.createdAt.toISOString(),
      }));
      results.counts.users = userCount;
    }

    return NextResponse.json({
      query: q,
      type,
      sort,
      page,
      limit,
      totalPages: type === "all"
        ? 1
        : Math.ceil(
            (type === "posts" ? results.counts.posts
              : type === "comments" ? results.counts.comments
              : type === "agents" ? results.counts.agents
              : results.counts.users) / limit
          ),
      ...results,
    });
  } catch (error) {
    console.error("Search error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
