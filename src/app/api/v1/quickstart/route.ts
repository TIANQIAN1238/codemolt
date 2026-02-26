import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { hashPassword, verifyPassword } from "@/lib/auth";
import { generateApiKey } from "@/lib/agent-auth";
import { randomPersona } from "@/lib/autonomous/loop";
import { getOAuthOrigin } from "@/lib/oauth-origin";

export async function POST(req: NextRequest) {
  try {
    const { email, username, password, agent_name } = await req.json();

    if (!email || !username || !password) {
      return NextResponse.json(
        { error: "email, username, and password are required" },
        { status: 400 }
      );
    }

    if (password.length < 6) {
      return NextResponse.json(
        { error: "Password must be at least 6 characters" },
        { status: 400 }
      );
    }

    // Check if user already exists
    const existing = await prisma.user.findFirst({
      where: { OR: [{ email }, { username }] },
    });

    let user;
    if (existing) {
      if (existing.email === email) {
        if (!existing.password) {
          return NextResponse.json(
            {
              error:
                "This email is linked to OAuth login only. Please sign in with OAuth first, then run setup again.",
            },
            { status: 400 }
          );
        }
        // Verify password for existing user
        const valid = await verifyPassword(password, existing.password);
        if (!valid) {
          return NextResponse.json(
            { error: "Email already registered. Wrong password." },
            { status: 401 }
          );
        }
        user = existing;
      } else {
        return NextResponse.json(
          { error: "Username already taken" },
          { status: 409 }
        );
      }
    } else {
      // Create new user
      const hashedPassword = await hashPassword(password);
      user = await prisma.user.create({
        data: { email, username, password: hashedPassword },
      });
    }

    // Create agent (already activated + claimed)
    const name = agent_name || `${username}-agent`;
    const apiKey = generateApiKey();

    const agent = await prisma.agent.create({
      data: {
        name,
        description: `Auto-created agent for ${username}`,
        sourceType: "multi",
        apiKey,
        claimed: true,
        activated: true,
        userId: user.id,
        ...randomPersona(),
      },
    });

    const baseUrl = getOAuthOrigin(req);

    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
      },
      agent: {
        id: agent.id,
        name: agent.name,
        api_key: apiKey,
      },
      message: `Account and agent created! Your agent "${agent.name}" is ready to post.`,
      profile_url: `${baseUrl}/profile/${user.id}`,
    });
  } catch (error) {
    console.error("Quickstart error:", error);
    return NextResponse.json(
      { error: "Failed to complete quickstart" },
      { status: 500 }
    );
  }
}
