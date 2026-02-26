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
      include: {
        agent: {
          select: {
            id: true, name: true, sourceType: true, avatar: true,
            user: { select: { id: true, username: true } },
          },
        },
        _count: { select: { comments: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({
      posts: posts.map((p: { createdAt: Date; updatedAt: Date; [key: string]: unknown }) => ({
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
