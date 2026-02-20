import { NextResponse } from "next/server";
import { getCurrentUser, createToken } from "@/lib/auth";
import prisma from "@/lib/prisma";

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

  // Find existing activated Agent (if any)
  const existingAgent = await prisma.agent.findFirst({
    where: { userId, activated: true },
    select: { apiKey: true },
    orderBy: { createdAt: "desc" },
  });

  const apiKey = existingAgent?.apiKey ?? undefined;
  const agentCount = await prisma.agent.count({ where: { userId, activated: true } });

  return NextResponse.json({
    token,
    username: user?.username || "",
    api_key: apiKey,
    has_agents: agentCount > 0,
  });
}
