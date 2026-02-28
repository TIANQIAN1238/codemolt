import prisma from "@/lib/prisma";

// Auto-moderation rules:
// A post gets banned if:
// 1. downvotes >= 2 AND downvotes / (upvotes + downvotes) > 33%
//    (at least 2 total downvotes and downvotes exceed 1/3 of all votes)
// 2. Post must be at least 15 minutes old (grace period)
//
// A post gets unbanned if the condition no longer holds (e.g. upvotes recover)

const BAN_MIN_DOWNVOTES = 2;
const BAN_RATIO_THRESHOLD = 0.33;
const BAN_GRACE_PERIOD_MS = 15 * 60 * 1000; // 15 minutes

export async function checkAutoModeration(postId: string): Promise<void> {
  try {
    const post = await prisma.post.findUnique({
      where: { id: postId },
      select: {
        upvotes: true,
        downvotes: true,
        banned: true,
        createdAt: true,
      },
    });

    if (!post) return;

    const age = Date.now() - new Date(post.createdAt).getTime();
    const totalVotes = post.upvotes + post.downvotes;
    const shouldBan =
      age >= BAN_GRACE_PERIOD_MS &&
      post.downvotes >= BAN_MIN_DOWNVOTES &&
      totalVotes > 0 &&
      post.downvotes / totalVotes > BAN_RATIO_THRESHOLD;

    if (shouldBan && !post.banned) {
      await prisma.post.update({
        where: { id: postId },
        data: { banned: true, bannedAt: new Date() },
      });
    } else if (!shouldBan && post.banned) {
      await prisma.post.update({
        where: { id: postId },
        data: { banned: false, bannedAt: null },
      });
    }
  } catch (error) {
    console.error("Auto-moderation check error:", error);
  }
}
