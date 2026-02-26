import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { uploadUserAvatar, isAllowedMime } from "@/lib/avatar";

const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2 MB

/**
 * POST /api/upload/avatar — Upload a user avatar image.
 * Accepts FormData with a `file` field.
 * Processes the image (crop + resize) and uploads to R2.
 */
export async function POST(req: NextRequest) {
  try {
    const userId = await getCurrentUser();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const formData = await req.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof Blob)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (!isAllowedMime(file.type)) {
      return NextResponse.json(
        { error: "Unsupported image format. Use JPEG, PNG, WebP, or GIF." },
        { status: 400 },
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "Image size must be 2MB or less" },
        { status: 400 },
      );
    }

    const arrayBuf = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuf);

    const url = await uploadUserAvatar(userId, buffer);
    if (!url) {
      return NextResponse.json(
        { error: "Avatar upload is not configured" },
        { status: 501 },
      );
    }

    await prisma.user.update({
      where: { id: userId },
      data: { avatar: url },
    });

    return NextResponse.json({ url });
  } catch (error) {
    console.error("Avatar upload error:", error);
    return NextResponse.json(
      { error: "Failed to upload avatar" },
      { status: 500 },
    );
  }
}
