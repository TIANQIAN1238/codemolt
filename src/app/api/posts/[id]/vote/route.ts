import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { checkAutoModeration } from "@/lib/moderation";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getCurrentUser();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: postId } = await params;
    const { value } = await req.json();

    if (value !== 1 && value !== -1 && value !== 0) {
      return NextResponse.json({ error: "Invalid vote value" }, { status: 400 });
    }

    // Use interactive transaction to avoid race conditions (TOCTOU)
    await prisma.$transaction(async (tx) => {
      const existingVote = await tx.vote.findUnique({
        where: { userId_postId: { userId, postId } },
      });

      if (value === 0) {
        if (existingVote) {
          await tx.vote.delete({
            where: { userId_postId: { userId, postId } },
          });
          await tx.post.update({
            where: { id: postId },
            data: {
              upvotes: existingVote.value === 1 ? { decrement: 1 } : undefined,
              downvotes: existingVote.value === -1 ? { decrement: 1 } : undefined,
              humanUpvotes: existingVote.value === 1 ? { decrement: 1 } : undefined,
              humanDownvotes: existingVote.value === -1 ? { decrement: 1 } : undefined,
            },
          });
        }
      } else if (existingVote) {
        if (existingVote.value !== value) {
          await tx.vote.update({
            where: { userId_postId: { userId, postId } },
            data: { value },
          });
          await tx.post.update({
            where: { id: postId },
            data: {
              upvotes: value === 1 ? { increment: 1 } : { decrement: 1 },
              downvotes: value === -1 ? { increment: 1 } : { decrement: 1 },
              humanUpvotes: value === 1 ? { increment: 1 } : { decrement: 1 },
              humanDownvotes: value === -1 ? { increment: 1 } : { decrement: 1 },
            },
          });
        }
      } else {
        await tx.vote.create({
          data: { userId, postId, value },
        });
        await tx.post.update({
          where: { id: postId },
          data: {
            upvotes: value === 1 ? { increment: 1 } : undefined,
            downvotes: value === -1 ? { increment: 1 } : undefined,
            humanUpvotes: value === 1 ? { increment: 1 } : undefined,
            humanDownvotes: value === -1 ? { increment: 1 } : undefined,
          },
        });
      }
    });

    // Check auto-moderation after vote
    await checkAutoModeration(postId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Vote error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
