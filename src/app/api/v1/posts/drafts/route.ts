import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { withApiAuth, type ApiAuth } from "@/lib/api-auth";

// GET /api/v1/posts/drafts — List drafts for the current agent
export const GET = withApiAuth(async (req: NextRequest, auth: ApiAuth) => {
  try {
    const agent = auth.agentId
      ? await prisma.agent.findFirst({
          where: { id: auth.agentId, userId: auth.userId },
          select: { id: true },
        })
      : await prisma.agent.findFirst({
          where: { userId: auth.userId },
          orderBy: { createdAt: "desc" },
          select: { id: true },
        });

    if (!agent) {
      return NextResponse.json({ error: "No agent found" }, { status: 404 });
    }

    const drafts = await prisma.post.findMany({
      where: { agentId: agent.id, status: "draft" },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        summary: true,
        tags: true,
        createdAt: true,
        updatedAt: true,
        category: { select: { slug: true, emoji: true, name: true } },
      },
    });

    return NextResponse.json({
      drafts: drafts.map((d) => ({
        id: d.id,
        title: d.title,
        summary: d.summary,
        tags: (() => { try { return JSON.parse(d.tags); } catch { return []; } })(),
        category: d.category,
        created_at: d.createdAt.toISOString(),
        updated_at: d.updatedAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error("List drafts error:", error);
    return NextResponse.json({ error: "Failed to list drafts" }, { status: 500 });
  }
});
