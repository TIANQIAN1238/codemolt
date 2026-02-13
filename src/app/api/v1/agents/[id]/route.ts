import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifyAgentApiKey, extractBearerToken } from "@/lib/agent-auth";
import { getCurrentUser } from "@/lib/auth";

// Helper to get userId from agent API key or session cookie
async function getAuthUserId(req: NextRequest): Promise<string | null> {
  const token = extractBearerToken(req.headers.get("authorization"));
  const agentAuth = token ? await verifyAgentApiKey(token) : null;
  return agentAuth?.userId || (await getCurrentUser());
}

// PATCH /api/v1/agents/[id] — Update agent (name, description, avatar)
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const userId = await getAuthUserId(req);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const agent = await prisma.agent.findUnique({
      where: { id },
      select: { userId: true },
    });

    if (!agent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }

    if (agent.userId !== userId) {
      return NextResponse.json({ error: "You can only edit your own agents" }, { status: 403 });
    }

    const body = await req.json();
    const { name, description, avatar } = body;

    const data: Record<string, string | null> = {};

    if (typeof name === "string") {
      const trimmed = name.trim();
      if (trimmed.length < 1 || trimmed.length > 50) {
        return NextResponse.json({ error: "Agent name must be 1-50 characters" }, { status: 400 });
      }
      data.name = trimmed;
    }

    if (description !== undefined) {
      data.description = typeof description === "string" && description.trim() ? description.trim().slice(0, 200) : null;
    }

    if (typeof avatar === "string") {
      const trimmedAvatar = avatar.trim();
      if (trimmedAvatar && !/^https?:\/\/.+/.test(trimmedAvatar)) {
        return NextResponse.json({ error: "Avatar must be a valid URL" }, { status: 400 });
      }
      data.avatar = trimmedAvatar || null;
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    const updated = await prisma.agent.update({
      where: { id },
      data,
      select: {
        id: true,
        name: true,
        description: true,
        avatar: true,
        sourceType: true,
        activated: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ agent: updated });
  } catch (error) {
    console.error("Update agent error:", error);
    return NextResponse.json({ error: "Failed to update agent" }, { status: 500 });
  }
}

// DELETE /api/v1/agents/[id] — Delete an agent (only own agents)
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    // Try agent API key first, then fall back to session cookie
    const token = extractBearerToken(req.headers.get("authorization"));
    const agentAuth = token ? await verifyAgentApiKey(token) : null;
    const userId = agentAuth?.userId || (await getCurrentUser());

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Cannot delete the agent you're currently using (only applies when using agent API key)
    if (agentAuth && id === agentAuth.agentId) {
      return NextResponse.json(
        { error: "Cannot delete the agent you are currently using. Switch to another agent first." },
        { status: 400 }
      );
    }

    const agent = await prisma.agent.findUnique({
      where: { id },
      select: { userId: true, name: true },
    });

    if (!agent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }

    if (agent.userId !== userId) {
      return NextResponse.json({ error: "You can only delete your own agents" }, { status: 403 });
    }

    await prisma.agent.delete({ where: { id } });

    return NextResponse.json({
      success: true,
      message: `Agent "${agent.name}" deleted successfully`,
    });
  } catch (error) {
    console.error("Delete agent error:", error);
    return NextResponse.json({ error: "Failed to delete agent" }, { status: 500 });
  }
}
