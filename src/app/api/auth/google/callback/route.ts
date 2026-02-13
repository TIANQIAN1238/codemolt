import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { createToken } from "@/lib/auth";

function getOrigin(req: NextRequest): string {
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || req.nextUrl.host;
  const proto = req.headers.get("x-forwarded-proto") || "https";
  return `${proto}://${host}`;
}

// Google OAuth Step 2: Handle callback, exchange code for token, create/login user
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const savedState = req.cookies.get("oauth_state")?.value;
  const origin = getOrigin(req);

  if (!code || !state || state !== savedState) {
    console.error("Google OAuth state mismatch:", { code: !!code, state: !!state, savedState: !!savedState, match: state === savedState });
    return NextResponse.redirect(`${origin}/login?error=invalid_state`);
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.redirect(`${origin}/login?error=oauth_not_configured`);
  }

  const redirectUri = `${origin}/api/auth/google/callback`;

  try {
    // Exchange code for access token
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      console.error("Google token exchange failed:", tokenData);
      return NextResponse.redirect(`${origin}/login?error=token_exchange_failed`);
    }

    // Fetch user profile from Google
    const userRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const googleUser = await userRes.json();

    const email = googleUser.email;
    if (!email) {
      return NextResponse.redirect(`${origin}/login?error=no_email`);
    }

    const providerId = String(googleUser.id);
    const name = googleUser.name || email.split("@")[0];
    const avatar = googleUser.picture;

    // Find or create user
    let user = await prisma.user.findFirst({
      where: {
        OR: [
          { provider: "google", providerId },
          { email },
        ],
      },
    });

    if (user) {
      // Link Google provider if user exists but logged in via email before
      if (!user.provider) {
        await prisma.user.update({
          where: { id: user.id },
          data: { provider: "google", providerId, avatar: avatar || user.avatar },
        });
      }
    } else {
      // Create new user — generate unique username from name/email
      let username = name.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 20) || "user";
      const existingUsername = await prisma.user.findUnique({ where: { username } });
      if (existingUsername) {
        username = `${username}${providerId.slice(-4)}`;
      }

      user = await prisma.user.create({
        data: {
          email,
          username,
          password: "", // OAuth users don't have a password
          avatar,
          provider: "google",
          providerId,
        },
      });
    }

    // Create JWT and set cookie
    const token = await createToken(user.id);
    const response = NextResponse.redirect(`${origin}/`);
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
    console.error("Google OAuth error:", error instanceof Error ? error.message : error);
    console.error("Google OAuth stack:", error instanceof Error ? error.stack : "no stack");
    return NextResponse.redirect(`${origin}/login?error=oauth_failed`);
  }
}
