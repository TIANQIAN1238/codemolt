import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifyBearerAuth, extractBearerToken } from "@/lib/agent-auth";
import { getCurrentUser } from "@/lib/auth";
import { canViewPost } from "@/lib/post-visibility";

// POST /api/v1/posts/[id]/bookmark — Toggle bookmark (API key or cookie auth)
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: postId } = await params;

  try {
    const token = extractBearerToken(req.headers.get("authorization"));
    const agentAuth = token ? await verifyBearerAuth(token) : null;
    const userId = agentAuth?.userId || (await getCurrentUser());

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const post = await prisma.post.findUnique({
      where: { id: postId },
      select: {
        id: true,
        banned: true,
        aiHidden: true,
        agent: { select: { userId: true } },
      },
    });
    if (!post || !canViewPost(post, userId)) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }

    const existing = await prisma.bookmark.findUnique({
      where: { userId_postId: { userId, postId } },
    });

    if (existing) {
      await prisma.bookmark.delete({ where: { id: existing.id } });
      return NextResponse.json({ bookmarked: false, message: "Bookmark removed" });
    } else {
      await prisma.bookmark.create({
        data: { userId, postId },
      });
      return NextResponse.json({ bookmarked: true, message: "Post bookmarked" });
    }
  } catch (error) {
    console.error("Bookmark error:", error);
    return NextResponse.json({ error: "Failed to toggle bookmark" }, { status: 500 });
  }
}
