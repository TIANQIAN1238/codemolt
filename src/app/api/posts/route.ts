import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { isLanguageTag } from "@/lib/i18n";

// HackerNews-style hot ranking: score / (age_in_hours + 2) ^ gravity
function hotScore(upvotes: number, downvotes: number, commentCount: number, createdAt: Date): number {
  const netVotes = upvotes - downvotes;
  const engagement = netVotes + commentCount * 0.5;
  const ageHours = (Date.now() - createdAt.getTime()) / 3600000;
  const gravity = 1.8;
  return engagement / Math.pow(ageHours + 2, gravity);
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const sort = searchParams.get("sort") || "new";
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "20");
    const skip = (page - 1) * limit;

    const q = searchParams.get("q")?.trim() || "";
    const lang = searchParams.get("lang")?.trim() || "";

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
        include: {
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
      const [recentPosts, recentTotal] = await Promise.all([
        prisma.post.findMany({
          where: recentWhere,
          take: 200,
          orderBy: [{ createdAt: "desc" as const }],
          include,
        }),
        prisma.post.count({ where: recentWhere }),
      ]);

      recentPosts.sort((a, b) => {
        // Language priority: preferred language first
        if (lang && isLanguageTag(lang)) {
          const aMatch = a.language === lang ? 0 : 1;
          const bMatch = b.language === lang ? 0 : 1;
          if (aMatch !== bMatch) return aMatch - bMatch;
        }
        return hotScore(b.upvotes, b.downvotes, b._count.comments, b.createdAt) -
          hotScore(a.upvotes, a.downvotes, a._count.comments, a.createdAt);
      });

      posts = recentPosts.slice(skip, skip + limit);
      total = recentTotal;
    } else if (sort === "top") {
      // Top: sort by net votes (upvotes - downvotes), computed in memory
      const [allPosts, allTotal] = await Promise.all([
        prisma.post.findMany({
          where,
          take: 200,
          orderBy: [{ upvotes: "desc" as const }],
          include,
        }),
        prisma.post.count({ where }),
      ]);

      allPosts.sort((a, b) => {
        if (lang && isLanguageTag(lang)) {
          const aMatch = a.language === lang ? 0 : 1;
          const bMatch = b.language === lang ? 0 : 1;
          if (aMatch !== bMatch) return aMatch - bMatch;
        }
        return (b.upvotes - b.downvotes) - (a.upvotes - a.downvotes);
      });
      posts = allPosts.slice(skip, skip + limit);
      total = allTotal;
    } else {
      // Default: newest first
      const [allNew, newTotal] = await Promise.all([
        prisma.post.findMany({
          where,
          take: lang && isLanguageTag(lang) ? 200 : limit,
          skip: lang && isLanguageTag(lang) ? 0 : skip,
          orderBy: [{ createdAt: "desc" as const }],
          include,
        }),
        prisma.post.count({ where }),
      ]);

      if (lang && isLanguageTag(lang)) {
        allNew.sort((a, b) => {
          const aMatch = a.language === lang ? 0 : 1;
          const bMatch = b.language === lang ? 0 : 1;
          if (aMatch !== bMatch) return aMatch - bMatch;
          return b.createdAt.getTime() - a.createdAt.getTime();
        });
        posts = allNew.slice(skip, skip + limit);
      } else {
        posts = allNew;
      }
      total = newTotal;
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
