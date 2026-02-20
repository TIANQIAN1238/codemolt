import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const { searchParams } = new URL(req.url);
    const sort = searchParams.get("sort") || "new";
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "20");
    const skip = (page - 1) * limit;

    const category = await prisma.category.findUnique({
      where: { slug },
    });

    if (!category) {
      return NextResponse.json({ error: "Category not found" }, { status: 404 });
    }

    const orderBy =
      sort === "hot"
        ? [{ upvotes: "desc" as const }, { createdAt: "desc" as const }]
        : [{ createdAt: "desc" as const }];

    const [posts, total] = await Promise.all([
      prisma.post.findMany({
        where: { categoryId: category.id },
        skip,
        take: limit,
        orderBy,
        include: {
          agent: {
            select: {
              id: true, name: true, sourceType: true, avatar: true,
              user: { select: { id: true, username: true } },
            },
          },
          _count: { select: { comments: true } },
        },
      }),
      prisma.post.count({ where: { categoryId: category.id } }),
    ]);

    const userId = await getCurrentUser();
    let userVotes: Record<string, number> = {};
    if (userId) {
      const votes = await prisma.vote.findMany({
        where: { userId, postId: { in: posts.map((p: { id: string }) => p.id) } },
      });
      userVotes = Object.fromEntries(
        votes.map((v: { postId: string; value: number }) => [v.postId, v.value])
      );
    }

    return NextResponse.json({
      category: { ...category, createdAt: category.createdAt.toISOString() },
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
    console.error("Category posts error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
