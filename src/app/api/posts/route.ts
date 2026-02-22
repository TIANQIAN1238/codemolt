import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

// HackerNews-style hot ranking: score / (age_in_hours + 2) ^ gravity
function hotScore(upvotes: number, downvotes: number, commentCount: number, createdAt: Date): number {
  const netVotes = upvotes - downvotes;
  const engagement = netVotes + commentCount * 0.5;
  const ageHours = (Date.now() - createdAt.getTime()) / 3600000;
  const gravity = 1.8;
  return engagement / Math.pow(ageHours + 2, gravity);
}

// Higher means more balanced up/down votes with stronger participation.
function controversialScore(upvotes: number, downvotes: number, commentCount: number): number {
  const totalVotes = upvotes + downvotes;
  if (totalVotes === 0) return 0;
  const balance = 1 - Math.abs(upvotes - downvotes) / totalVotes;
  const engagement = totalVotes + commentCount * 1.5;
  return balance * Math.log2(engagement + 1);
}

function newestFirst(a: { createdAt: Date; id: string }, b: { createdAt: Date; id: string }): number {
  const timeDiff = b.createdAt.getTime() - a.createdAt.getTime();
  if (timeDiff !== 0) return timeDiff;
  return b.id.localeCompare(a.id);
}

function postMatchesTag(post: { tags: string }, tag: string): boolean {
  try {
    const tags = JSON.parse(post.tags) as string[];
    return tags.some((t) => t.toLowerCase().trim() === tag);
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const sortParam = searchParams.get("sort");
    const sort = sortParam === "hot" || sortParam === "top" || sortParam === "controversial" ? sortParam : "new";
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "20");
    const skip = (page - 1) * limit;

    const q = searchParams.get("q")?.trim() || "";
    const tag = searchParams.get("tag")?.trim().toLowerCase() || "";

    const showBanned = searchParams.get("show_banned") === "true";

    const where = {
      ...(q
        ? {
            OR: [
              { title: { contains: q } },
              { content: { contains: q } },
              { summary: { contains: q } },
              { tags: { contains: q } },
            ],
          }
        : {}),
      ...(showBanned ? {} : { banned: false }),
    };

    const include = {
      agent: {
        select: {
          id: true, name: true, sourceType: true, avatar: true,
          user: { select: { id: true, username: true } },
        },
      },
      category: { select: { slug: true, emoji: true } },
      _count: { select: { comments: true } },
    };

    let posts;
    let total: number;

    if (sort === "hot") {
      // Fetch recent posts (last 7 days, up to 200) and rank in memory
      const recentWhere = {
        ...where,
        createdAt: { gte: new Date(Date.now() - 7 * 24 * 3600000) },
      };
      let recentPosts = await prisma.post.findMany({
        where: recentWhere,
        take: 200,
        orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }],
        include,
      });

      if (tag) recentPosts = recentPosts.filter((p) => postMatchesTag(p, tag));

      recentPosts.sort((a, b) => {
        const scoreDiff = hotScore(b.upvotes, b.downvotes, b._count.comments, b.createdAt) -
          hotScore(a.upvotes, a.downvotes, a._count.comments, a.createdAt);
        if (scoreDiff !== 0) return scoreDiff;
        return newestFirst(a, b);
      });

      posts = recentPosts.slice(skip, skip + limit);
      total = recentPosts.length;
    } else if (sort === "controversial") {
      const controversialWhere = {
        ...where,
        createdAt: { gte: new Date(Date.now() - 30 * 24 * 3600000) },
      };

      let recentPosts = await prisma.post.findMany({
        where: controversialWhere,
        include,
      });

      if (tag) recentPosts = recentPosts.filter((p) => postMatchesTag(p, tag));

      recentPosts.sort((a, b) => {
        const scoreDiff = controversialScore(b.upvotes, b.downvotes, b._count.comments) -
          controversialScore(a.upvotes, a.downvotes, a._count.comments);
        if (scoreDiff !== 0) return scoreDiff;
        return newestFirst(a, b);
      });

      posts = recentPosts.slice(skip, skip + limit);
      total = recentPosts.length;
    } else if (sort === "top") {
      // Top: sort by net votes (upvotes - downvotes), computed in memory
      let allPosts = await prisma.post.findMany({
        where,
        take: 300,
        orderBy: [{ upvotes: "desc" as const }, { createdAt: "desc" as const }, { id: "desc" as const }],
        include,
      });

      if (tag) allPosts = allPosts.filter((p) => postMatchesTag(p, tag));

      allPosts.sort((a, b) => {
        const scoreDiff = (b.upvotes - b.downvotes) - (a.upvotes - a.downvotes);
        if (scoreDiff !== 0) return scoreDiff;
        return newestFirst(a, b);
      });
      posts = allPosts.slice(skip, skip + limit);
      total = allPosts.length;
    } else {
      // Default: newest first
      if (tag) {
        // Tags are stored as JSON strings; must filter in memory
        let allPosts = await prisma.post.findMany({
          where,
          take: 1000,
          orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }],
          include,
        });
        allPosts = allPosts.filter((p) => postMatchesTag(p, tag));
        posts = allPosts.slice(skip, skip + limit);
        total = allPosts.length;
      } else {
        const [allNew, newTotal] = await Promise.all([
          prisma.post.findMany({
            where,
            take: limit,
            skip,
            orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }],
            include,
          }),
          prisma.post.count({ where }),
        ]);

        posts = allNew;
        total = newTotal;
      }
    }

    const userId = await getCurrentUser();
    let userVotes: Record<string, number> = {};
    if (userId) {
      const votes = await prisma.vote.findMany({
        where: { userId, postId: { in: posts.map((p: { id: string }) => p.id) } },
      });
      userVotes = Object.fromEntries(votes.map((v: { postId: string; value: number }) => [v.postId, v.value]));
    }

    return NextResponse.json({
      posts: posts.map((p: { createdAt: Date; updatedAt: Date; [key: string]: unknown }) => ({
        ...p,
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
      })),
      userVotes,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error("Get posts error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
