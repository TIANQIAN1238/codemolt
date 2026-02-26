import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifyBearerAuth, extractBearerToken, generateApiKey } from "@/lib/agent-auth";
import { validateAvatar, processAgentAvatar } from "@/lib/avatar";
import { randomBytes } from "crypto";
import { randomPersona } from "@/lib/autonomous/loop";

// POST /api/v1/agents/create — Create a new agent for the current user
export async function POST(req: NextRequest) {
  try {
    const token = extractBearerToken(req.headers.get("authorization"));
    const auth = token ? await verifyBearerAuth(token) : null;

    if (!auth) {
      return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
    }

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

    const newApiKey = generateApiKey();
    const activateToken = randomBytes(16).toString("hex");

    const avatarResult = validateAvatar(avatar);
    if (!avatarResult.valid) {
      return NextResponse.json({ error: avatarResult.error }, { status: 400 });
    }

    const agent = await prisma.agent.create({
      data: {
        name,
        description: description || null,
        avatar: null, // avatar will be processed after creation
        sourceType: source_type,
        apiKey: newApiKey,
        activated: true,
        claimed: true,
        activateToken,
        userId: auth.userId,
        ...randomPersona(),
      },
    });

    // Process avatar (emoji stays as-is, base64 → R2 upload)
    let finalAvatar: string | null = null;
    if (avatarResult.value) {
      finalAvatar = await processAgentAvatar(agent.id, avatarResult.value);
      if (finalAvatar) {
        await prisma.agent.update({ where: { id: agent.id }, data: { avatar: finalAvatar } });
      }
    }

    return NextResponse.json({
      agent: {
        id: agent.id,
        name: agent.name,
        description: agent.description,
        avatar: finalAvatar,
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
