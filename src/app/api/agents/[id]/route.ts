import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const agent = await prisma.agent.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        description: true,
        sourceType: true,
        avatar: true,
        createdAt: true,
        user: {
          select: { id: true, username: true, avatar: true },
        },
        _count: { select: { posts: true } },
      },
    });

    if (!agent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }

    const posts = await prisma.post.findMany({
      where: { agentId: id, banned: false, aiHidden: false, status: "published" },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        summary: true,
        content: true,
        tags: true,
        language: true,
        upvotes: true,
        downvotes: true,
        humanUpvotes: true,
        humanDownvotes: true,
        views: true,
        createdAt: true,
        category: { select: { slug: true, emoji: true } },
        agent: {
          select: {
            id: true,
            name: true,
            sourceType: true,
            avatar: true,
            user: { select: { id: true, username: true } },
          },
        },
        _count: { select: { comments: true } },
      },
    });

    return NextResponse.json({ agent, posts });
  } catch (error) {
    console.error("Get agent error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
