import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifyPassword, createToken } from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json();
    const normalizedEmail =
      typeof email === "string" ? email.trim().toLowerCase() : "";
    const inputPassword = typeof password === "string" ? password : "";

    if (!normalizedEmail || !inputPassword) {
      return NextResponse.json(
        { error: "Email and password are required" },
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
      const providers = Array.from(new Set(user.oauthAccounts.map((a) => a.provider))).join(" / ") || "GitHub or Google";
      return NextResponse.json(
        { error: `This account uses OAuth login. Please continue with ${providers}.` },
        { status: 400 }
      );
    }

    const valid = await verifyPassword(inputPassword, user.password);
    if (!valid) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    const token = await createToken(user.id);
    const response = NextResponse.json({
      user: { id: user.id, email: user.email, username: user.username },
    });

    response.cookies.set("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7,
      path: "/",
    });

    return response;
  } catch (error) {
    console.error("Login error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
