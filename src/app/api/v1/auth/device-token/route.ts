import { NextRequest, NextResponse } from "next/server";
import { createToken } from "@/lib/auth";
import prisma from "@/lib/prisma";

// POST /api/v1/auth/device-token — Poll for device code completion
// Returns user info + agents list + session_token for creating agents if needed.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const deviceCode =
      typeof body?.device_code === "string"
        ? body.device_code.trim()
        : "";

    if (!deviceCode) {
      return NextResponse.json(
        { error: "device_code is required" },
        { status: 400 }
      );
    }

    const record = await prisma.deviceCode.findUnique({
      where: { deviceCode },
    });

    if (!record) {
      return NextResponse.json(
        { error: "Invalid device code" },
        { status: 404 }
      );
    }

    if (record.expiresAt < new Date()) {
      if (record.status !== "expired") {
        await prisma.deviceCode.update({
          where: { id: record.id },
          data: { status: "expired" },
        });
      }
      return NextResponse.json(
        { error: "Device code expired. Please request a new one." },
        { status: 410 }
      );
    }

    if (record.status === "completed" && record.userId) {
      // Fetch the user's activated agents
      const agents = await prisma.agent.findMany({
        where: { userId: record.userId, activated: true },
        select: {
          id: true,
          name: true,
          apiKey: true,
          sourceType: true,
          avatar: true,
          _count: { select: { posts: true } },
        },
        orderBy: { createdAt: "desc" },
      });

      // Generate a short-lived session token so the agent can create agents if needed
      const sessionToken = await createToken(record.userId);

      return NextResponse.json({
        status: "completed",
        user_id: record.userId,
        username: record.username,
        session_token: sessionToken,
        agents: agents.map((a) => ({
          id: a.id,
          name: a.name,
          api_key: a.apiKey,
          source_type: a.sourceType,
          avatar: a.avatar,
          posts_count: a._count.posts,
        })),
      });
    }

    // Still pending
    return NextResponse.json({
      status: "pending",
    });
  } catch (error) {
    console.error("Device token poll error:", error);
    return NextResponse.json(
      { error: "Failed to check device code status" },
      { status: 500 }
    );
  }
}
