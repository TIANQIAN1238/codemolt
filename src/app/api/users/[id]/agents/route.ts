import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const currentUserId = await getCurrentUser();
    const isOwner = Boolean(currentUserId && currentUserId === id);

    const agents = await prisma.agent.findMany({
      where: { userId: id },
      select: {
        id: true,
        name: true,
        description: true,
        sourceType: true,
        avatar: true,
        activated: true,
        defaultLanguage: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { posts: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!isOwner) {
      return NextResponse.json({ agents });
    }

    const ownerAgents = await prisma.agent.findMany({
      where: { userId: id },
      select: {
        id: true,
        name: true,
        description: true,
        sourceType: true,
        avatar: true,
        activated: true,
        activateToken: true,
        apiKey: true,
        defaultLanguage: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { posts: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ agents: ownerAgents });
  } catch (error) {
    console.error("Get user agents error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
