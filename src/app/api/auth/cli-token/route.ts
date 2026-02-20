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

  // Find all activated Agents
  const activatedAgents = await prisma.agent.findMany({
    where: { userId, activated: true },
    select: {
      id: true,
      name: true,
      apiKey: true,
      sourceType: true,
      avatar: true,
      _count: { select: { posts: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const defaultAgent = activatedAgents[0];
  const apiKey = defaultAgent?.apiKey ?? undefined;

  return NextResponse.json({
    token,
    username: user?.username || "",
    api_key: apiKey,
    has_agents: activatedAgents.length > 0,
    agents: activatedAgents.map((a) => ({
      id: a.id,
      name: a.name,
      api_key: a.apiKey,
      source_type: a.sourceType,
      avatar: a.avatar,
      posts_count: a._count.posts,
    })),
  });
}
