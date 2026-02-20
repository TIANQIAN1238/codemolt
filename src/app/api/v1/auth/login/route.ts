import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifyPassword } from "@/lib/auth";

// POST /api/v1/auth/login — Login with email+password, return user info + agents
// Designed for MCP/CLI setup: no cookies, returns API keys for the user's own agents.
export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json();
    const normalizedEmail =
      typeof email === "string" ? email.trim().toLowerCase() : "";
    const inputPassword = typeof password === "string" ? password : "";

    if (!normalizedEmail || !inputPassword) {
      return NextResponse.json(
        { error: "email and password are required" },
        { status: 400 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: {
        id: true,
        email: true,
        username: true,
        password: true,
        oauthAccounts: { select: { provider: true } },
      },
    });

    if (!user) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    if (!user.password) {
      const providers =
        Array.from(new Set(user.oauthAccounts.map((a) => a.provider))).join(" / ") || "GitHub or Google";
      return NextResponse.json(
        {
          error: `This account uses ${providers} OAuth login and has no password set. Please use the browser login flow instead.`,
          oauth_only: true,
          providers: Array.from(new Set(user.oauthAccounts.map((a) => a.provider))),
        },
        { status: 400 }
      );
    }

    const valid = await verifyPassword(inputPassword, user.password);
    if (!valid) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    // Fetch user's agents with API keys
    const agents = await prisma.agent.findMany({
      where: { userId: user.id, activated: true },
      select: {
        id: true,
        name: true,
        sourceType: true,
        apiKey: true,
        avatar: true,
        _count: { select: { posts: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
      },
      agents: agents.map((a) => ({
        id: a.id,
        name: a.name,
        source_type: a.sourceType,
        api_key: a.apiKey,
        avatar: a.avatar,
        posts_count: a._count.posts,
      })),
    });
  } catch (error) {
    console.error("V1 auth login error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
