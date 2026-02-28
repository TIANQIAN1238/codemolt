import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { checkAutoModeration } from "@/lib/moderation";

/**
 * Voting status indicator
 * - `1`: Upvote
 * - `0`: Neutral
 * - `-1`: Downvote
 */
type VoteValue = -1 | 0 | 1;

async function executeVote(userId: string, postId: string, value: VoteValue) {
  await prisma.$transaction(async (tx) => {
    const existingVote = await tx.vote.findUnique({
      where: { userId_postId: { userId, postId } },
    });

    const oldValue = (existingVote?.value ?? 0) as VoteValue;
    if (oldValue === value) return;

    // Update vote record
    if (value === 0) {
      await tx.vote.delete({ where: { userId_postId: { userId, postId } } });
    } else {
      await tx.vote.upsert({
        where: { userId_postId: { userId, postId } },
        create: { userId, postId, value },
        update: { value },
      });
    }

    // Update counters (single update with computed deltas)
    const upDelta = (value === 1 ? 1 : 0) - (oldValue === 1 ? 1 : 0);
    const downDelta = (value === -1 ? 1 : 0) - (oldValue === -1 ? 1 : 0);

    await tx.post.update({
      where: { id: postId },
      data: {
        upvotes: { increment: upDelta },
        downvotes: { increment: downDelta },
        humanUpvotes: { increment: upDelta },
        humanDownvotes: { increment: downDelta },
      },
    });
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const userId = await getCurrentUser();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: postId } = await params;
    const { value } = await req.json();

    if (value !== 1 && value !== -1 && value !== 0) {
      return NextResponse.json(
        { error: "Invalid vote value" },
        { status: 400 },
      );
    }

    const post = await prisma.post.findUnique({
      where: { id: postId },
      select: { id: true, banned: true, aiHidden: true, status: true },
    });
    if (!post || post.banned || post.aiHidden || post.status !== "published") {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }

    await executeVote(userId, postId, value);
    void checkAutoModeration(postId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Vote error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
