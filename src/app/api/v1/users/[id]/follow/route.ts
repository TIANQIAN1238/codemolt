import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifyBearerAuth, extractBearerToken } from "@/lib/agent-auth";
import { getCurrentUser } from "@/lib/auth";

// POST /api/v1/users/[id]/follow — Follow/unfollow a user (toggle)
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: targetUserId } = await params;

  try {
    // Try agent API key first, then fall back to session cookie
    const token = extractBearerToken(req.headers.get("authorization"));
    const agentAuth = token ? await verifyBearerAuth(token) : null;
    const userId = agentAuth?.userId || (await getCurrentUser());

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const auth = { userId };

    if (auth.userId === targetUserId) {
      return NextResponse.json({ error: "You cannot follow yourself" }, { status: 400 });
    }

    const targetUser = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, username: true },
    });

    if (!targetUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const body = await req.json().catch(() => ({}));
    const requestedAction = (body as { action?: string }).action; // "follow" or "unfollow"

    const existing = await prisma.follow.findUnique({
      where: {
        followerId_followingId: {
          followerId: auth.userId,
          followingId: targetUserId,
        },
      },
    });

    // If explicit action is provided, honor it instead of toggling
    if (requestedAction === "follow" && existing) {
      return NextResponse.json({ following: true, message: `Already following @${targetUser.username}` });
    }
    if (requestedAction === "unfollow" && !existing) {
      return NextResponse.json({ following: false, message: `Not following @${targetUser.username}` });
    }

    if (existing) {
      await prisma.follow.delete({ where: { id: existing.id } });
      return NextResponse.json({ following: false, message: `Unfollowed @${targetUser.username}` });
    } else {
      await prisma.follow.create({
        data: {
          followerId: auth.userId,
          followingId: targetUserId,
        },
      });

      // Create notification for the followed user
      try {
        const follower = await prisma.user.findUnique({
          where: { id: auth.userId },
          select: { username: true },
        });
        await prisma.notification.create({
          data: {
            type: "follow",
            message: `@${follower?.username || "someone"} started following you`,
            userId: targetUserId,
            fromUserId: auth.userId,
          },
        });
      } catch {
        // Non-critical
      }

      return NextResponse.json({ following: true, message: `Now following @${targetUser.username}` });
    }
  } catch (error) {
    console.error("Follow error:", error);
    return NextResponse.json({ error: "Failed to follow/unfollow" }, { status: 500 });
  }
}

// GET /api/v1/users/[id]/follow — Get followers/following count or list
// Query params:
//   type=followers|following (default: followers)
//   count_only=true — return only { total } (and optionally isFollowing)
//   check_user=<userId> — when count_only, also check if this user is in the followers list
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: userId } = await params;

  try {
    const { searchParams } = new URL(req.url);
    const type = searchParams.get("type") || "followers";
    const countOnly = searchParams.get("count_only") === "true";
    const checkUser = searchParams.get("check_user") || "";

    if (countOnly) {
      const total = await prisma.follow.count({
        where: type === "following" ? { followerId: userId } : { followingId: userId },
      });
      // Optionally check if a specific user is following this profile
      let isFollowing: boolean | undefined;
      if (checkUser && type === "followers") {
        const rel = await prisma.follow.findUnique({
          where: { followerId_followingId: { followerId: checkUser, followingId: userId } },
          select: { id: true },
        });
        isFollowing = !!rel;
      }
      return NextResponse.json({ users: [], total, ...(isFollowing !== undefined && { isFollowing }) });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (type === "following") {
      const following = await prisma.follow.findMany({
        where: { followerId: userId },
        include: {
          following: {
            select: { id: true, username: true, avatar: true, bio: true },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 200,
      });

      return NextResponse.json({
        users: following.map((f) => ({
          id: f.following.id,
          username: f.following.username,
          avatar: f.following.avatar,
          bio: f.following.bio,
          followed_at: f.createdAt.toISOString(),
        })),
        total: following.length,
      });
    }

    // Default: followers
    const followers = await prisma.follow.findMany({
      where: { followingId: userId },
      include: {
        follower: {
          select: { id: true, username: true, avatar: true, bio: true },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    return NextResponse.json({
      users: followers.map((f) => ({
        id: f.follower.id,
        username: f.follower.username,
        avatar: f.follower.avatar,
        bio: f.follower.bio,
        followed_at: f.createdAt.toISOString(),
      })),
      total: followers.length,
    });
  } catch (error) {
    console.error("Get follow list error:", error);
    return NextResponse.json({ error: "Failed to get follow list" }, { status: 500 });
  }
}
