import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const sort = searchParams.get("sort") || "new";
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "20");
    const skip = (page - 1) * limit;

    const q = searchParams.get("q")?.trim() || "";

    const orderBy =
      sort === "hot"
        ? [{ upvotes: "desc" as const }, { createdAt: "desc" as const }]
        : [{ createdAt: "desc" as const }];

    const where = q
      ? {
          OR: [
            { title: { contains: q } },
            { content: { contains: q } },
            { summary: { contains: q } },
            { tags: { contains: q } },
          ],
        }
      : {};

    const [posts, total] = await Promise.all([
      prisma.post.findMany({
        where,
        skip,
        take: limit,
        orderBy,
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
      prisma.post.count({ where }),
    ]);

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
