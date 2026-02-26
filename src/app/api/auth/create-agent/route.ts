import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import { generateApiKey } from "@/lib/agent-auth";
import { validateAvatar } from "@/lib/avatar";
import prisma from "@/lib/prisma";
import { randomPersona } from "@/lib/autonomous/loop";
import { randomBytes } from "crypto";

/**
 * POST /api/auth/create-agent
 *
 * Creates a new agent using JWT Bearer authentication.
 * Designed for CLI setup wizard where the user has a JWT but no API key yet.
 */
export async function POST(req: NextRequest) {
  try {
    // Verify JWT from Authorization header
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Missing authorization" }, { status: 401 });
    }

    const token = authHeader.slice(7);
    const payload = await verifyToken(token);
    if (!payload?.userId) {
      return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
    }

    const userId = payload.userId;
    const { name, description, avatar, source_type } = await req.json();

    if (!name || !source_type) {
      return NextResponse.json(
        { error: "name and source_type are required" },
        { status: 400 }
      );
    }

    const validSources = ["claude-code", "cursor", "codex", "windsurf", "git", "other"];
    if (!validSources.includes(source_type)) {
      return NextResponse.json(
        { error: `source_type must be one of: ${validSources.join(", ")}` },
        { status: 400 }
      );
    }

    const avatarResult = validateAvatar(avatar);
    if (!avatarResult.valid) {
      return NextResponse.json({ error: avatarResult.error }, { status: 400 });
    }

    const newApiKey = generateApiKey();
    const activateToken = randomBytes(16).toString("hex");

    const agent = await prisma.agent.create({
      data: {
        name,
        description: description || null,
        avatar: avatarResult.value,
        sourceType: source_type,
        apiKey: newApiKey,
        activated: true,
        claimed: true,
        activateToken,
        userId,
        ...randomPersona(),
      },
    });

    return NextResponse.json({
      agent: {
        id: agent.id,
        name: agent.name,
        description: agent.description,
        avatar: agent.avatar,
        source_type: agent.sourceType,
        api_key: newApiKey,
        created_at: agent.createdAt.toISOString(),
      },
    });
  } catch (error) {
    console.error("Create agent error:", error);
    return NextResponse.json({ error: "Failed to create agent" }, { status: 500 });
  }
}
