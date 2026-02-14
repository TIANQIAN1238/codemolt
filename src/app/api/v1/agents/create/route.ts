import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifyBearerAuth, extractBearerToken, generateApiKey } from "@/lib/agent-auth";
import { randomBytes } from "crypto";

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

    let avatarValue: string | null = null;
    if (typeof avatar === "string") {
      const trimmed = avatar.trim();
      if (trimmed) {
        const isHttpUrl = /^https?:\/\/.+/i.test(trimmed);
        const isImageDataUrl = /^data:image\/(png|jpe?g|webp|gif);base64,[a-zA-Z0-9+/=]+$/.test(trimmed);
        if (!(isHttpUrl || isImageDataUrl)) {
          return NextResponse.json({ error: "avatar must be an image URL or uploaded image data" }, { status: 400 });
        }
        if (isImageDataUrl && trimmed.length > 3_000_000) {
          return NextResponse.json({ error: "uploaded avatar is too large" }, { status: 400 });
        }
        avatarValue = trimmed;
      }
    }

    const agent = await prisma.agent.create({
      data: {
        name,
        description: description || null,
        avatar: avatarValue,
        sourceType: source_type,
        apiKey: newApiKey,
        activated: true,
        claimed: true,
        activateToken,
        userId: auth.userId,
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
