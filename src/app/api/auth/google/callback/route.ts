import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { createToken, verifyToken } from "@/lib/auth";
import { getOAuthOrigin } from "@/lib/oauth-origin";
import { linkReferral } from "@/lib/referral";
import { transferExternalAvatarAsync } from "@/lib/avatar";

function cleanupOAuthCookies(response: NextResponse) {
  response.cookies.delete("oauth_state_google");
  response.cookies.delete("oauth_intent_google");
  response.cookies.delete("oauth_return_to_google");
}

// Generate a username from Google profile name/email
function generateUsername(name: string, email: string, providerId: string): string {
  let username = name.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 20);
  if (!username || username.length < 2) {
    username = email.split("@")[0].toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 20);
  }
  if (!username || username.length < 2) {
    username = `u_${providerId.slice(-8)}`;
  }
  return username;
}

// Google OAuth Step 2: Handle callback, exchange code for token, create/login or link user
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const savedState = req.cookies.get("oauth_state_google")?.value;
  const cookieIntent = req.cookies.get("oauth_intent_google")?.value;
  const intent = cookieIntent === "link" || cookieIntent === "signup" ? cookieIntent : "login";
  const rawReturnTo = req.cookies.get("oauth_return_to_google")?.value;
  const defaultReturnTo = intent === "link" ? "/settings" : "/";
  const returnTo = rawReturnTo && rawReturnTo.startsWith("/") ? rawReturnTo : defaultReturnTo;
  const origin = getOAuthOrigin(req);

  const invalidStateResponse = NextResponse.redirect(`${origin}/login?error=invalid_state`);
  cleanupOAuthCookies(invalidStateResponse);
  if (!code || !state || state !== savedState) {
    console.error("Google OAuth state mismatch:", { code: !!code, state: !!state, savedState: !!savedState, match: state === savedState });
    return invalidStateResponse;
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    const response = NextResponse.redirect(`${origin}/login?error=oauth_not_configured`);
    cleanupOAuthCookies(response);
    return response;
  }

  const redirectUri = `${origin}/api/auth/google/callback`;

  try {
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
      const response = NextResponse.redirect(`${origin}/login?error=token_exchange_failed`);
      cleanupOAuthCookies(response);
      return response;
    }

    const userRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const googleUser = await userRes.json();

    const email = String(googleUser.email || "").trim().toLowerCase();
    if (!email) {
      const response = NextResponse.redirect(`${origin}/login?error=no_email`);
      cleanupOAuthCookies(response);
      return response;
    }

    const provider = "google";
    const providerId = String(googleUser.id);
    const name = googleUser.name || email.split("@")[0];
    const avatar = googleUser.picture;

    const currentToken = req.cookies.get("token")?.value;
    const currentPayload = currentToken ? await verifyToken(currentToken) : null;
    const currentUserId = currentPayload?.userId || null;

    let user = await prisma.user.findFirst({
      where: {
        oauthAccounts: {
          some: { provider, providerId },
        },
      },
    });

    let isNewUser = false;

    if (intent === "link") {
      if (!currentUserId) {
        const response = NextResponse.redirect(`${origin}/login?error=link_requires_login`);
        cleanupOAuthCookies(response);
        return response;
      }

      if (user && user.id !== currentUserId) {
        const response = NextResponse.redirect(`${origin}${returnTo}?error=google_already_linked`);
        cleanupOAuthCookies(response);
        return response;
      }

      if (!user) {
        user = await prisma.user.findUnique({ where: { id: currentUserId } });
      }

      if (!user) {
        const response = NextResponse.redirect(`${origin}/login?error=user_not_found`);
        cleanupOAuthCookies(response);
        return response;
      }

      const existingProvider = await prisma.oAuthAccount.findUnique({
        where: { userId_provider: { userId: user.id, provider } },
      });

      if (existingProvider && existingProvider.providerId !== providerId) {
        const response = NextResponse.redirect(`${origin}${returnTo}?error=google_conflict`);
        cleanupOAuthCookies(response);
        return response;
      }

      if (!existingProvider) {
        await prisma.oAuthAccount.create({
          data: {
            userId: user.id,
            provider,
            providerId,
            email,
          },
        });
      }

      const updates: Record<string, string> = {};
      if (!user.provider) {
        updates.provider = provider;
        updates.providerId = providerId;
      }
      if (Object.keys(updates).length > 0) {
        await prisma.user.update({ where: { id: user.id }, data: updates });
      }

      // Async transfer OAuth avatar to R2 (non-blocking)
      if (avatar && !user.avatar) {
        transferExternalAvatarAsync("users", user.id, avatar);
      }

      const response = NextResponse.redirect(`${origin}${returnTo}?linked=google`);
      cleanupOAuthCookies(response);
      return response;
    }

    if (!user) {
      user = await prisma.user.findUnique({ where: { email } });
    }

    if (user) {
      const existingProvider = await prisma.oAuthAccount.findUnique({
        where: { userId_provider: { userId: user.id, provider } },
      });

      if (existingProvider && existingProvider.providerId !== providerId) {
        const response = NextResponse.redirect(`${origin}/login?error=oauth_mismatch`);
        cleanupOAuthCookies(response);
        return response;
      }

      if (!existingProvider) {
        await prisma.oAuthAccount.create({
          data: {
            userId: user.id,
            provider,
            providerId,
            email,
          },
        });
      }

      const updates: Record<string, string> = {};
      if (!user.provider) {
        updates.provider = provider;
        updates.providerId = providerId;
      }
      if (user.username === "user" || user.username.startsWith("user")) {
        const betterName = generateUsername(name, email, providerId);
        if (betterName !== "user") updates.username = betterName;
      }
      if (Object.keys(updates).length > 0) {
        user = await prisma.user.update({ where: { id: user.id }, data: updates });
      }

      // Async transfer OAuth avatar to R2 (non-blocking)
      if (avatar && !user.avatar) {
        transferExternalAvatarAsync("users", user.id, avatar);
      }
    } else {
      // Auto-register on first OAuth login/signup when no account exists.
      const username = generateUsername(name, email, providerId);
      user = await prisma.user.create({
        data: {
          email,
          username,
          password: "",
          provider,
          providerId,
          oauthAccounts: {
            create: {
              provider,
              providerId,
              email,
            },
          },
        },
      });
      isNewUser = true;

      // Async transfer OAuth avatar to R2 (non-blocking)
      if (avatar) {
        transferExternalAvatarAsync("users", user.id, avatar);
      }

      // Link referral from cookie
      const refCode = req.cookies.get("ref_code")?.value;
      if (refCode) {
        await linkReferral(user.id, refCode).catch(() => {});
      }
    }

    const token = await createToken(user.id);
    const response = NextResponse.redirect(`${origin}${isNewUser ? "/onboarding/create-agent" : returnTo}`);
    response.cookies.set("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7,
      path: "/",
    });
    cleanupOAuthCookies(response);
    response.cookies.delete("ref_code");

    return response;
  } catch (error) {
    console.error("Google OAuth error:", error instanceof Error ? error.message : error);
    console.error("Google OAuth stack:", error instanceof Error ? error.stack : "no stack");
    const response = NextResponse.redirect(`${origin}/login?error=oauth_failed`);
    cleanupOAuthCookies(response);
    return response;
  }
}
