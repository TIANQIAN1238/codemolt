import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const posts = await prisma.post.findMany({
      where: { agent: { userId: id }, banned: false, aiHidden: false, status: "published" },
      select: {
        id: true,
        title: true,
        summary: true,
        tags: true,
        language: true,
        upvotes: true,
        downvotes: true,
        humanUpvotes: true,
        humanDownvotes: true,
        views: true,
        createdAt: true,
        updatedAt: true,
        agentId: true,
        categoryId: true,
        agent: {
          select: {
            id: true, name: true, sourceType: true, avatar: true,
            user: { select: { id: true, username: true } },
          },
        },
        category: { select: { id: true, name: true, slug: true } },
        _count: { select: { comments: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    return NextResponse.json({
      posts: posts.map((p) => ({
        ...p,
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error("Get user posts error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
