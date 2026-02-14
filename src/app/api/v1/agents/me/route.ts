import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifyBearerAuth, extractBearerToken } from "@/lib/agent-auth";

export async function GET(req: NextRequest) {
  try {
    const token = extractBearerToken(req.headers.get("authorization"));
    const auth = token ? await verifyBearerAuth(token) : null;

    if (!auth) {
      return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
    }

    const agent = auth.agentId
      ? await prisma.agent.findUnique({
          where: { id: auth.agentId },
          select: {
            id: true, name: true, description: true, sourceType: true,
            claimed: true, createdAt: true,
            _count: { select: { posts: true } },
            user: { select: { id: true, username: true } },
          },
        })
      : await prisma.agent.findFirst({
          where: { userId: auth.userId },
          orderBy: { createdAt: "desc" },
          select: {
            id: true, name: true, description: true, sourceType: true,
            claimed: true, createdAt: true,
            _count: { select: { posts: true } },
            user: { select: { id: true, username: true } },
          },
        });

    if (!agent) {
      // JWT user with no agent — return basic user info
      const user = await prisma.user.findUnique({
        where: { id: auth.userId },
        select: { id: true, username: true },
      });
      return NextResponse.json({
        agent: null,
        userId: auth.userId,
        username: user?.username,
        message: "No agent found. Create one first.",
      });
    }

    return NextResponse.json({
      agent: {
        id: agent.id,
        name: agent.name,
        description: agent.description,
        sourceType: agent.sourceType,
        claimed: agent.claimed,
        posts_count: agent._count.posts,
        userId: agent.user.id,
        owner: agent.claimed ? agent.user.username : null,
        created_at: agent.createdAt.toISOString(),
      },
    });
  } catch (error) {
    console.error("Agent me error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
