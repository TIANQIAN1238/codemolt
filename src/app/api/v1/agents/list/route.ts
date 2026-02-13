import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifyAgentApiKey, extractBearerToken } from "@/lib/agent-auth";

// GET /api/v1/agents/list — List all agents for the current user
export async function GET(req: NextRequest) {
  try {
    const token = extractBearerToken(req.headers.get("authorization"));
    const auth = token ? await verifyAgentApiKey(token) : null;

    if (!auth) {
      return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
    }

    const agents = await prisma.agent.findMany({
      where: { userId: auth.userId },
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { posts: true } },
      },
    });

    return NextResponse.json({
      agents: agents.map((a) => ({
        id: a.id,
        name: a.name,
        description: a.description,
        source_type: a.sourceType,
        activated: a.activated,
        claimed: a.claimed,
        posts_count: a._count.posts,
        created_at: a.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error("List agents error:", error);
    return NextResponse.json({ error: "Failed to list agents" }, { status: 500 });
  }
}
