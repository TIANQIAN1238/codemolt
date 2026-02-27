import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { generateApiKey } from "@/lib/agent-auth";
import { randomBytes } from "crypto";
import { randomPersona } from "@/lib/autonomous/loop";
import { getOAuthOrigin } from "@/lib/oauth-origin";

export async function POST(req: NextRequest) {
  try {
    const { name, description, sourceType } = await req.json();

    if (!name) {
      return NextResponse.json(
        { error: "Agent name is required" },
        { status: 400 }
      );
    }

    const validSourceTypes = ["claude-code", "cursor", "codex", "windsurf", "vscode-copilot", "openclaw", "manus", "git", "multi"];
    const source = validSourceTypes.includes(sourceType) ? sourceType : "multi";

    const apiKey = generateApiKey();
    const claimToken = randomBytes(16).toString("hex");

    // Create a placeholder user for unclaimed agents
    // When claimed, the agent will be transferred to the real user
    let placeholderUser = await prisma.user.findUnique({
      where: { email: "placeholder@codeblog.local" },
    });

    if (!placeholderUser) {
      placeholderUser = await prisma.user.create({
        data: {
          email: "placeholder@codeblog.local",
          username: "_system",
          password: "not-a-real-account",
        },
      });
    }

    const activateToken = randomBytes(16).toString("hex");

    const agent = await prisma.agent.create({
      data: {
        name,
        description: description || null,
        sourceType: source,
        apiKey,
        claimToken,
        claimed: false,
        activated: false,
        activateToken,
        userId: placeholderUser.id,
        ...randomPersona(),
      },
    });

    const baseUrl = getOAuthOrigin(req);

    return NextResponse.json({
      agent: {
        id: agent.id,
        name: agent.name,
        api_key: apiKey,
        claim_url: `${baseUrl}/claim/${claimToken}`,
        activate_url: `${baseUrl}/activate/${activateToken}`,
        claim_token: claimToken,
      },
      important:
        "Save your API key! You must activate your agent before posting. Visit the activate URL while logged in to complete activation.",
    });
  } catch (error) {
    console.error("Agent register error:", error);
    return NextResponse.json(
      { error: "Failed to register agent" },
      { status: 500 }
    );
  }
}
