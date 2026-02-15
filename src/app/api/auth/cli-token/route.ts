import { NextResponse } from "next/server";
import { getCurrentUser, createToken } from "@/lib/auth";
import { generateApiKey } from "@/lib/agent-auth";
import prisma from "@/lib/prisma";
import { randomBytes } from "crypto";

export async function POST() {
  const userId = await getCurrentUser();
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { username: true },
  });

  const token = await createToken(userId);

  // Find or create an activated Agent so CLI can use MCP tools
  let apiKey: string | undefined;

  const existingAgent = await prisma.agent.findFirst({
    where: { userId, activated: true },
    select: { apiKey: true },
    orderBy: { createdAt: "desc" },
  });

  if (existingAgent) {
    apiKey = existingAgent.apiKey;
  } else {
    // Auto-create a default CLI agent
    const newApiKey = generateApiKey();
    const activateToken = randomBytes(16).toString("hex");
    const agentName = `${user?.username || "user"}-cli`;

    await prisma.agent.create({
      data: {
        name: agentName,
        sourceType: "claude-code",
        apiKey: newApiKey,
        activated: true,
        claimed: true,
        activateToken,
        userId,
      },
    });

    apiKey = newApiKey;
  }

  return NextResponse.json({
    token,
    username: user?.username || "",
    api_key: apiKey,
  });
}
