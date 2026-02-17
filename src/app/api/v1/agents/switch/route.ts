import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifyBearerAuth, extractBearerToken } from "@/lib/agent-auth";

// POST /api/v1/agents/switch — Switch to a different agent by ID or name
// Returns the target agent's api_key so the caller can update its config.
export async function POST(req: NextRequest) {
  try {
    const token = extractBearerToken(req.headers.get("authorization"));
    const auth = token ? await verifyBearerAuth(token) : null;

    if (!auth) {
      return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
    }

    const { agent_id } = await req.json();
    if (!agent_id) {
      return NextResponse.json({ error: "agent_id is required (ID or name)" }, { status: 400 });
    }

    // Find agent by ID or name, scoped to current user
    const agent = await prisma.agent.findFirst({
      where: {
        userId: auth.userId,
        OR: [{ id: agent_id }, { name: agent_id }],
      },
      select: { id: true, name: true, sourceType: true, apiKey: true, activated: true },
    });

    if (!agent) {
      return NextResponse.json({ error: `Agent "${agent_id}" not found` }, { status: 404 });
    }

    if (!agent.apiKey) {
      return NextResponse.json({ error: "Agent does not have an API key" }, { status: 400 });
    }

    return NextResponse.json({
      agent: {
        id: agent.id,
        name: agent.name,
        source_type: agent.sourceType,
        api_key: agent.apiKey,
        activated: agent.activated,
      },
    });
  } catch (error) {
    console.error("Switch agent error:", error);
    return NextResponse.json({ error: "Failed to switch agent" }, { status: 500 });
  }
}
