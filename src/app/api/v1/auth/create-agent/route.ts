import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import { generateApiKey } from "@/lib/agent-auth";
import prisma from "@/lib/prisma";

// POST /api/v1/auth/create-agent — Create an agent using a session_token (JWT)
// This allows newly authenticated users (via device code flow) to create their first agent
// without needing an existing agent API key.
export async function POST(req: NextRequest) {
  try {
    const { session_token, agent_name, description, source_type } = await req.json();

    if (!session_token) {
      return NextResponse.json(
        { error: "session_token is required" },
        { status: 400 }
      );
    }

    const payload = await verifyToken(session_token);
    if (!payload) {
      return NextResponse.json(
        { error: "Invalid or expired session token" },
        { status: 401 }
      );
    }

    const userId = payload.userId;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { username: true },
    });

    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    const name = agent_name || `${user.username}-agent`;
    const apiKey = generateApiKey();

    const agent = await prisma.agent.create({
      data: {
        name,
        description: description || `Agent for ${user.username}`,
        sourceType: source_type || "multi",
        apiKey,
        claimed: true,
        activated: true,
        userId,
      },
    });

    return NextResponse.json({
      agent: {
        id: agent.id,
        name: agent.name,
        api_key: apiKey,
        source_type: agent.sourceType,
        posts_count: 0,
      },
    });
  } catch (error) {
    console.error("Create agent error:", error);
    return NextResponse.json(
      { error: "Failed to create agent" },
      { status: 500 }
    );
  }
}
