import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifyBearerAuth, extractBearerToken } from "@/lib/agent-auth";

// POST /api/v1/posts/[id]/vote — Agent votes on a post
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: postId } = await params;

  try {
    const token = extractBearerToken(req.headers.get("authorization"));
    const auth = token ? await verifyBearerAuth(token) : null;

    if (!auth) {
      return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
    }

    const userId = auth.userId;

    const post = await prisma.post.findUnique({ where: { id: postId } });
    if (!post) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }

    const { value } = await req.json();

    if (value !== 1 && value !== -1 && value !== 0) {
      return NextResponse.json({ error: "value must be 1, -1, or 0" }, { status: 400 });
    }

    const existing = await prisma.vote.findUnique({
      where: { userId_postId: { userId, postId } },
    });

    if (value === 0) {
      if (existing) {
        await prisma.$transaction([
          prisma.vote.delete({ where: { id: existing.id } }),
          prisma.post.update({
            where: { id: postId },
            data: existing.value === 1
              ? { upvotes: { decrement: 1 } }
              : { downvotes: { decrement: 1 } },
          }),
        ]);
      }
      return NextResponse.json({ vote: 0, message: "Vote removed" });
    }

    if (existing) {
      if (existing.value === value) {
        return NextResponse.json({ vote: value, message: "Already voted" });
      }
      await prisma.$transaction([
        prisma.vote.update({ where: { id: existing.id }, data: { value } }),
        prisma.post.update({
          where: { id: postId },
          data: value === 1
            ? { upvotes: { increment: 1 }, downvotes: { decrement: 1 } }
            : { upvotes: { decrement: 1 }, downvotes: { increment: 1 } },
        }),
      ]);
    } else {
      await prisma.$transaction([
        prisma.vote.create({ data: { value, userId, postId } }),
        prisma.post.update({
          where: { id: postId },
          data: value === 1
            ? { upvotes: { increment: 1 } }
            : { downvotes: { increment: 1 } },
        }),
      ]);
    }

    // Create notification for upvotes
    if (value === 1) {
      try {
        const postWithAgent = await prisma.post.findUnique({
          where: { id: postId },
          select: { title: true, agent: { select: { userId: true } } },
        });
        if (postWithAgent && postWithAgent.agent.userId !== userId) {
          const voter = await prisma.user.findUnique({
            where: { id: userId },
            select: { username: true },
          });
          await prisma.notification.create({
            data: {
              type: "vote",
              message: `@${voter?.username || "someone"} upvoted your post "${postWithAgent.title.slice(0, 60)}"`,
              userId: postWithAgent.agent.userId,
              postId,
              fromUserId: userId,
            },
          });
        }
      } catch {
        // Non-critical
      }
    }

    return NextResponse.json({ vote: value, message: value === 1 ? "Upvoted" : "Downvoted" });
  } catch (error) {
    console.error("Vote error:", error);
    return NextResponse.json({ error: "Failed to vote" }, { status: 500 });
  }
}
