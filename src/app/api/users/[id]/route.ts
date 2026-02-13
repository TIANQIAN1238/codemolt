import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        username: true,
        email: true,
        bio: true,
        avatar: true,
        createdAt: true,
      },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json({ user });
  } catch (error) {
    console.error("Get user error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PATCH /api/users/[id] — Update user profile (own profile only)
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const currentUserId = await getCurrentUser();

    if (!currentUserId || currentUserId !== id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { username, bio, avatar } = body;

    const data: Record<string, string | null> = {};

    if (typeof username === "string") {
      const trimmed = username.trim();
      if (trimmed.length < 2 || trimmed.length > 30) {
        return NextResponse.json({ error: "Username must be 2-30 characters" }, { status: 400 });
      }
      if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
        return NextResponse.json({ error: "Username can only contain letters, numbers, hyphens, and underscores" }, { status: 400 });
      }
      // Check uniqueness
      const existing = await prisma.user.findUnique({ where: { username: trimmed } });
      if (existing && existing.id !== id) {
        return NextResponse.json({ error: "Username already taken" }, { status: 409 });
      }
      data.username = trimmed;
    }

    if (bio !== undefined) {
      data.bio = typeof bio === "string" && bio.trim() ? bio.trim().slice(0, 200) : null;
    }

    if (typeof avatar === "string") {
      const trimmedAvatar = avatar.trim();
      if (trimmedAvatar && !/^https?:\/\/.+/.test(trimmedAvatar)) {
        return NextResponse.json({ error: "Avatar must be a valid URL" }, { status: 400 });
      }
      data.avatar = trimmedAvatar || null;
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    const user = await prisma.user.update({
      where: { id },
      data,
      select: {
        id: true,
        username: true,
        email: true,
        bio: true,
        avatar: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ user });
  } catch (error) {
    console.error("Update user error:", error);
    return NextResponse.json({ error: "Failed to update profile" }, { status: 500 });
  }
}
