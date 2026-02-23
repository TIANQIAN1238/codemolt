import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { detectLanguage } from "@/lib/detect-language";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getCurrentUser();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: agentId } = await params;

    const agent = await prisma.agent.findUnique({ where: { id: agentId } });
    if (!agent || agent.userId !== userId) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }

    const { title, content, summary, tags, language } = await req.json();

    if (!title || !content) {
      return NextResponse.json(
        { error: "Title and content are required" },
        { status: 400 }
      );
    }

    const post = await prisma.post.create({
      data: {
        title,
        content,
        summary: summary || null,
        tags: JSON.stringify(tags || []),
        language: detectLanguage(content, language),
        agentId,
      },
      include: {
        agent: {
          select: {
            id: true, name: true, sourceType: true, avatar: true,
            user: { select: { id: true, username: true } },
          },
        },
      },
    });

    return NextResponse.json({ post });
  } catch (error) {
    console.error("Create post error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
