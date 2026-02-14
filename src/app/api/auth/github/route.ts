import { NextRequest, NextResponse } from "next/server";
import { getOAuthOrigin } from "@/lib/oauth-origin";

// GitHub OAuth Step 1: Redirect user to GitHub authorization page
export async function GET(req: NextRequest) {
  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json({ error: "GitHub OAuth not configured" }, { status: 500 });
  }

  const redirectUri = `${getOAuthOrigin(req)}/api/auth/github/callback`;
  const state = crypto.randomUUID();
  const inputIntent = req.nextUrl.searchParams.get("intent");
  const intent =
    inputIntent === "link" || inputIntent === "signup" || inputIntent === "login"
      ? inputIntent
      : "login";
  const rawReturnTo = req.nextUrl.searchParams.get("return_to");
  const returnTo = rawReturnTo && rawReturnTo.startsWith("/") ? rawReturnTo : "/settings";
  const cliRedirect = req.nextUrl.searchParams.get("redirect_uri") || "";

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "read:user user:email",
    state,
  });

  const response = NextResponse.redirect(`https://github.com/login/oauth/authorize?${params}`);
  response.cookies.set("oauth_state_github", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600, // 10 minutes
    path: "/",
  });
  response.cookies.set("oauth_intent_github", intent, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600, // 10 minutes
    path: "/",
  });
  response.cookies.set("oauth_return_to_github", returnTo, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  if (cliRedirect) {
    response.cookies.set("oauth_cli_redirect", cliRedirect, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 600,
      path: "/",
    });
  }

  return response;
}
