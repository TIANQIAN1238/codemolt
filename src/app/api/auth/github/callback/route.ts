import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { createToken, verifyToken } from "@/lib/auth";
import { getOAuthOrigin } from "@/lib/oauth-origin";
import { linkReferral } from "@/lib/referral";

function cleanupOAuthCookies(response: NextResponse) {
  response.cookies.delete("oauth_state_github");
  response.cookies.delete("oauth_intent_github");
  response.cookies.delete("oauth_return_to_github");
  response.cookies.delete("oauth_cli_redirect");
}

// GitHub OAuth Step 2: Handle callback, exchange code for token, create/login or link user
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const savedState = req.cookies.get("oauth_state_github")?.value;
  const cookieIntent = req.cookies.get("oauth_intent_github")?.value;
  const intent = cookieIntent === "link" || cookieIntent === "signup" ? cookieIntent : "login";
  const rawReturnTo = req.cookies.get("oauth_return_to_github")?.value;
  const defaultReturnTo = intent === "link" ? "/settings" : "/";
  const returnTo = rawReturnTo && rawReturnTo.startsWith("/") ? rawReturnTo : defaultReturnTo;
  const origin = getOAuthOrigin(req);

  const invalidStateResponse = NextResponse.redirect(`${origin}/login?error=invalid_state`);
  cleanupOAuthCookies(invalidStateResponse);
  if (!code || !state || state !== savedState) {
    return invalidStateResponse;
  }

  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    const response = NextResponse.redirect(`${origin}/login?error=oauth_not_configured`);
    cleanupOAuthCookies(response);
    return response;
  }

  try {
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
      const response = NextResponse.redirect(`${origin}/login?error=token_exchange_failed`);
      cleanupOAuthCookies(response);
      return response;
    }

    const userRes = await fetch("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const githubUser = await userRes.json();

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
      const response = NextResponse.redirect(`${origin}/login?error=no_email`);
      cleanupOAuthCookies(response);
      return response;
    }

    email = String(email).trim().toLowerCase();

    const provider = "github";
    const providerId = String(githubUser.id);
    const username = githubUser.login;
    const avatar = githubUser.avatar_url;

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
        const response = NextResponse.redirect(`${origin}${returnTo}?error=github_already_linked`);
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
        const response = NextResponse.redirect(`${origin}${returnTo}?error=github_conflict`);
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
      if (avatar && !user.avatar) {
        updates.avatar = avatar;
      }
      if (Object.keys(updates).length > 0) {
        await prisma.user.update({ where: { id: user.id }, data: updates });
      }

      const response = NextResponse.redirect(`${origin}${returnTo}?linked=github`);
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
      if (avatar && !user.avatar) {
        updates.avatar = avatar;
      }
      if (Object.keys(updates).length > 0) {
        user = await prisma.user.update({ where: { id: user.id }, data: updates });
      }
    } else {
      // Auto-register on first OAuth login/signup when no account exists.
      let finalUsername = username;
      const existingUsername = await prisma.user.findUnique({ where: { username } });
      if (existingUsername) {
        finalUsername = `${username}_${providerId.slice(-4)}`;
      }

      user = await prisma.user.create({
        data: {
          email,
          username: finalUsername,
          password: "",
          avatar,
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

      // Link referral from cookie
      const refCode = req.cookies.get("ref_code")?.value;
      if (refCode) {
        await linkReferral(user.id, refCode).catch(() => {});
      }
    }

    const token = await createToken(user.id);

    const cliRedirect = req.cookies.get("oauth_cli_redirect")?.value;
    if (cliRedirect && cliRedirect.startsWith("http://localhost:")) {
      const url = new URL(cliRedirect);
      url.searchParams.set("token", token);
      url.searchParams.set("username", user.username || "");
      const response = NextResponse.redirect(url.toString());
      cleanupOAuthCookies(response);
      return response;
    }

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
    console.error("GitHub OAuth error:", error);
    const response = NextResponse.redirect(`${origin}/login?error=oauth_failed`);
    cleanupOAuthCookies(response);
    return response;
  }
}
