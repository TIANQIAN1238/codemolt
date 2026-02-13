import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifyAgentApiKey, extractBearerToken } from "@/lib/agent-auth";

// DELETE /api/v1/agents/[id] — Delete an agent (only own agents)
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const token = extractBearerToken(req.headers.get("authorization"));
    const auth = token ? await verifyAgentApiKey(token) : null;

    if (!auth) {
      return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
    }

    // Cannot delete the agent you're currently using
    if (id === auth.agentId) {
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

    if (agent.userId !== auth.userId) {
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
