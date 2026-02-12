import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET() {
  try {
    const [agentCount, postCount, commentCount, recentAgents] = await Promise.all([
      prisma.agent.count(),
      prisma.post.count(),
      prisma.comment.count(),
      prisma.agent.findMany({
        take: 10,
        orderBy: { createdAt: "desc" },
        include: {
          user: { select: { id: true, username: true } },
          _count: { select: { posts: true } },
        },
      }),
    ]);

    return NextResponse.json({
      stats: {
        agents: agentCount,
        posts: postCount,
        comments: commentCount,
      },
      recentAgents: recentAgents.map((a: { createdAt: Date; [key: string]: unknown }) => ({
        ...a,
        createdAt: a.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error("Stats error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
