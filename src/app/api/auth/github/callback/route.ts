import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { createToken } from "@/lib/auth";

// GitHub OAuth Step 2: Handle callback, exchange code for token, create/login user
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const savedState = req.cookies.get("oauth_state")?.value;

  if (!code || !state || state !== savedState) {
    return NextResponse.redirect(new URL("/login?error=invalid_state", req.url));
  }

  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.redirect(new URL("/login?error=oauth_not_configured", req.url));
  }

  try {
    // Exchange code for access token
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
      }),
    });

    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      return NextResponse.redirect(new URL("/login?error=token_exchange_failed", req.url));
    }

    // Fetch user profile
    const userRes = await fetch("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const githubUser = await userRes.json();

    // Fetch user email (may be private)
    let email = githubUser.email;
    if (!email) {
      const emailsRes = await fetch("https://api.github.com/user/emails", {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      const emails = await emailsRes.json();
      const primary = emails.find((e: { primary: boolean; verified: boolean }) => e.primary && e.verified);
      email = primary?.email || emails[0]?.email;
    }

    if (!email) {
      return NextResponse.redirect(new URL("/login?error=no_email", req.url));
    }

    const providerId = String(githubUser.id);
    const username = githubUser.login;
    const avatar = githubUser.avatar_url;

    // Find or create user
    let user = await prisma.user.findFirst({
      where: {
        OR: [
          { provider: "github", providerId },
          { email },
        ],
      },
    });

    if (user) {
      // Update provider info if user exists but logged in via email before
      if (!user.provider) {
        await prisma.user.update({
          where: { id: user.id },
          data: { provider: "github", providerId, avatar: avatar || user.avatar },
        });
      }
    } else {
      // Create new user — ensure unique username
      let finalUsername = username;
      const existingUsername = await prisma.user.findUnique({ where: { username } });
      if (existingUsername) {
        finalUsername = `${username}_${providerId.slice(-4)}`;
      }

      user = await prisma.user.create({
        data: {
          email,
          username: finalUsername,
          password: "", // OAuth users don't have a password
          avatar,
          provider: "github",
          providerId,
        },
      });
    }

    // Create JWT and set cookie
    const token = await createToken(user.id);
    const response = NextResponse.redirect(new URL("/", req.url));
    response.cookies.set("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7, // 7 days
      path: "/",
    });
    response.cookies.delete("oauth_state");

    return response;
  } catch (error) {
    console.error("GitHub OAuth error:", error);
    return NextResponse.redirect(new URL("/login?error=oauth_failed", req.url));
  }
}
