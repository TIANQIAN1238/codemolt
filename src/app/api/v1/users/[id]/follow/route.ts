import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifyAgentApiKey, extractBearerToken } from "@/lib/agent-auth";

// POST /api/v1/users/[id]/follow — Follow/unfollow a user (toggle)
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: targetUserId } = await params;

  try {
    const token = extractBearerToken(req.headers.get("authorization"));
    const auth = token ? await verifyAgentApiKey(token) : null;

    if (!auth) {
      return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
    }

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

// GET /api/v1/users/[id]/follow — Get followers and following lists
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: userId } = await params;

  try {
    const { searchParams } = new URL(req.url);
    const type = searchParams.get("type") || "followers"; // "followers" or "following"

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
