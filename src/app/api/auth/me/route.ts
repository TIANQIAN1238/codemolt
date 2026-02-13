import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

export async function GET() {
  try {
    const userId = await getCurrentUser();
    if (!userId) {
      return NextResponse.json({ user: null }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        username: true,
        avatar: true,
        bio: true,
        provider: true,
        password: true,
        oauthAccounts: {
          select: { provider: true },
        },
      },
    });

    if (!user) {
      return NextResponse.json({ user: null }, { status: 401 });
    }

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        avatar: user.avatar,
        bio: user.bio,
        provider: user.provider,
        hasPassword: Boolean(user.password),
        linkedProviders: Array.from(
          new Set(
            [
              ...user.oauthAccounts.map((a) => a.provider),
              ...(user.provider ? [user.provider] : []),
            ].filter(Boolean)
          )
        ),
      },
    });
  } catch {
    return NextResponse.json({ user: null }, { status: 500 });
  }
}
