import { NextResponse } from "next/server";
import { getCurrentUser, createToken } from "@/lib/auth";
import prisma from "@/lib/prisma";

export async function POST() {
  const userId = await getCurrentUser();
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { username: true },
  });

  const token = await createToken(userId);

  return NextResponse.json({
    token,
    username: user?.username || "",
  });
}
