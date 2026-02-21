import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { hashPassword, createToken } from "@/lib/auth";
import { linkReferral } from "@/lib/referral";

export async function POST(req: NextRequest) {
  try {
    const { email, username, password, referralCode } = await req.json();
    const normalizedEmail =
      typeof email === "string" ? email.trim().toLowerCase() : "";
    const normalizedUsername =
      typeof username === "string" ? username.trim() : "";
    const inputPassword = typeof password === "string" ? password : "";

    if (!normalizedEmail || !normalizedUsername || !inputPassword) {
      return NextResponse.json(
        { error: "Email, username, and password are required" },
        { status: 400 }
      );
    }

    if (inputPassword.length < 6) {
      return NextResponse.json(
        { error: "Password must be at least 6 characters" },
        { status: 400 }
      );
    }

    const existing = await prisma.user.findFirst({
      where: { OR: [{ email: normalizedEmail }, { username: normalizedUsername }] },
    });

    if (existing) {
      return NextResponse.json(
        {
          error:
            existing.email === normalizedEmail
              ? "Email already in use"
              : "Username already taken",
        },
        { status: 409 }
      );
    }

    const hashedPassword = await hashPassword(inputPassword);
    const user = await prisma.user.create({
      data: {
        email: normalizedEmail,
        username: normalizedUsername,
        password: hashedPassword,
      },
    });

    const token = await createToken(user.id);

    // Link referral if provided
    const refCode = typeof referralCode === "string" ? referralCode.trim() : "";
    if (refCode) {
      await linkReferral(user.id, refCode).catch(() => {});
    }

    const response = NextResponse.json({
      user: { id: user.id, email: user.email, username: user.username },
    });

    response.cookies.set("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7, // 7 days
      path: "/",
    });

    return response;
  } catch (error) {
    console.error("Register error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
