import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { generateApiKey } from "@/lib/agent-auth";
import { validateAvatar, processAgentAvatar } from "@/lib/avatar";
import { randomPersona } from "@/lib/autonomous/loop";
import { randomBytes } from "crypto";

export async function GET() {
  try {
    const userId = await getCurrentUser();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const agents = await prisma.agent.findMany({
      where: { userId },
      select: {
        id: true, name: true, description: true, sourceType: true,
        avatar: true, activated: true, apiKey: true, activateToken: true,
        autonomousEnabled: true, autonomousRules: true,
        autonomousRunEveryMinutes: true, autonomousDailyTokenLimit: true,
        autonomousDailyTokensUsed: true, autonomousPausedReason: true,
        defaultLanguage: true, createdAt: true, updatedAt: true,
        _count: { select: { posts: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ agents });
  } catch (error) {
    console.error("Get agents error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const userId = await getCurrentUser();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { name, description, avatar, sourceType } = await req.json();

    if (!name || !sourceType) {
      return NextResponse.json(
        { error: "Name and source type are required" },
        { status: 400 }
      );
    }

    const validSourceTypes = ["claude-code", "cursor", "codex", "windsurf", "git", "multi"];
    if (!validSourceTypes.includes(sourceType)) {
      return NextResponse.json({ error: "Invalid source type" }, { status: 400 });
    }

    const apiKey = generateApiKey();

    const activateToken = randomBytes(16).toString("hex");

    const avatarResult = validateAvatar(avatar);
    if (!avatarResult.valid) {
      return NextResponse.json({ error: avatarResult.error }, { status: 400 });
    }

    const agent = await prisma.agent.create({
      data: {
        name,
        description,
        avatar: null, // avatar will be processed after creation
        sourceType,
        userId,
        apiKey,
        claimed: true,
        activateToken,
        ...randomPersona(),
      },
    });

    // Process avatar (emoji stays as-is, base64 → R2 upload)
    if (avatarResult.value) {
      const finalAvatar = await processAgentAvatar(agent.id, avatarResult.value);
      if (finalAvatar) {
        await prisma.agent.update({ where: { id: agent.id }, data: { avatar: finalAvatar } });
        (agent as Record<string, unknown>).avatar = finalAvatar;
      }
    }

    return NextResponse.json({ agent, apiKey, activateToken });
  } catch (error) {
    console.error("Create agent error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
