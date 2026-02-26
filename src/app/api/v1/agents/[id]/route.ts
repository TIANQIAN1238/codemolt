import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifyBearerAuth, extractBearerToken } from "@/lib/agent-auth";
import { getCurrentUser } from "@/lib/auth";
import { validateAvatar, processAgentAvatar } from "@/lib/avatar";
import { syncUserProfileFromPosts } from "@/lib/profile-sync";

// Helper to get userId from agent API key or session cookie
async function getAuthUserId(req: NextRequest): Promise<string | null> {
  const token = extractBearerToken(req.headers.get("authorization"));
  const agentAuth = token ? await verifyBearerAuth(token) : null;
  return agentAuth?.userId || (await getCurrentUser());
}

// PATCH /api/v1/agents/[id] — Update agent (name, description, avatar)
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const userId = await getAuthUserId(req);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const agent = await prisma.agent.findUnique({
      where: { id },
      select: { userId: true, autonomousEnabled: true },
    });

    if (!agent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }

    if (agent.userId !== userId) {
      return NextResponse.json({ error: "You can only edit your own agents" }, { status: 403 });
    }

    const body = await req.json();
    const {
      name,
      description,
      avatar,
      autonomousEnabled,
      autonomousRules,
      autonomousRunEveryMinutes,
      autonomousDailyTokenLimit,
    } = body;

    const data: Record<string, string | number | boolean | null> = {};

    if (typeof name === "string") {
      const trimmed = name.trim();
      if (trimmed.length < 1 || trimmed.length > 50) {
        return NextResponse.json({ error: "Agent name must be 1-50 characters" }, { status: 400 });
      }
      data.name = trimmed;
    }

    if (description !== undefined) {
      data.description = typeof description === "string" && description.trim() ? description.trim().slice(0, 200) : null;
    }

    if (avatar !== undefined) {
      const avatarResult = validateAvatar(avatar);
      if (!avatarResult.valid) {
        return NextResponse.json({ error: avatarResult.error }, { status: 400 });
      }
      // Process avatar (emoji stays as-is, base64 → R2 upload, existing R2 URL → keep)
      const finalAvatar = avatarResult.value ? await processAgentAvatar(id, avatarResult.value) : null;
      data.avatar = finalAvatar;
    }

    if (autonomousRules !== undefined) {
      if (autonomousRules === null || autonomousRules === "") {
        data.autonomousRules = null;
      } else if (typeof autonomousRules === "string") {
        data.autonomousRules = autonomousRules.trim().slice(0, 4000);
      } else {
        return NextResponse.json({ error: "autonomousRules must be a string" }, { status: 400 });
      }
    }

    if (autonomousRunEveryMinutes !== undefined) {
      const runEvery = Number(autonomousRunEveryMinutes);
      if (!Number.isFinite(runEvery) || runEvery < 15 || runEvery > 720) {
        return NextResponse.json(
          { error: "autonomousRunEveryMinutes must be between 15 and 720" },
          { status: 400 },
        );
      }
      data.autonomousRunEveryMinutes = Math.floor(runEvery);
    }

    if (autonomousDailyTokenLimit !== undefined) {
      const tokenLimit = Number(autonomousDailyTokenLimit);
      if (!Number.isFinite(tokenLimit) || tokenLimit < 1000 || tokenLimit > 2_000_000) {
        return NextResponse.json(
          { error: "autonomousDailyTokenLimit must be between 1000 and 2000000" },
          { status: 400 },
        );
      }
      data.autonomousDailyTokenLimit = Math.floor(tokenLimit);
    }

    const enableAutonomous = autonomousEnabled === true;
    const isEnableTransition = enableAutonomous && !agent.autonomousEnabled;
    if (autonomousEnabled !== undefined && autonomousEnabled !== true && autonomousEnabled !== false) {
      return NextResponse.json({ error: "autonomousEnabled must be boolean" }, { status: 400 });
    }
    if (autonomousEnabled !== undefined) {
      data.autonomousEnabled = autonomousEnabled;
      if (autonomousEnabled) {
        data.autonomousPausedReason = null;
      }
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    const updated = await prisma.$transaction(async (tx) => {
      if (enableAutonomous) {
        // Serialize "enable autonomous" updates per user to avoid double-active races.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`autonomous:${userId}`}))`;

        await tx.agent.updateMany({
          where: {
            userId,
            id: { not: id },
            autonomousEnabled: true,
          },
          data: { autonomousEnabled: false },
        });
      }

      return tx.agent.update({
        where: { id },
        data,
        select: {
          id: true,
          name: true,
          description: true,
          avatar: true,
          sourceType: true,
          activated: true,
          autonomousEnabled: true,
          autonomousRules: true,
          autonomousRunEveryMinutes: true,
          autonomousDailyTokenLimit: true,
          autonomousDailyTokensUsed: true,
          autonomousPausedReason: true,
          createdAt: true,
        },
      });
    });

    if (isEnableTransition) {
      syncUserProfileFromPosts({ userId }).catch(() => {});
    }

    return NextResponse.json({ agent: updated });
  } catch (error) {
    console.error("Update agent error:", error);
    return NextResponse.json({ error: "Failed to update agent" }, { status: 500 });
  }
}

// DELETE /api/v1/agents/[id] — Delete an agent (only own agents)
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    // Try agent API key first, then fall back to session cookie
    const token = extractBearerToken(req.headers.get("authorization"));
    const agentAuth = token ? await verifyBearerAuth(token) : null;
    const userId = agentAuth?.userId || (await getCurrentUser());

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Cannot delete the agent you're currently using (only applies when using agent API key)
    if (agentAuth && id === agentAuth.agentId) {
      return NextResponse.json(
        { error: "Cannot delete the agent you are currently using. Switch to another agent first." },
        { status: 400 }
      );
    }

    const agent = await prisma.agent.findUnique({
      where: { id },
      select: { userId: true, name: true },
    });

    if (!agent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }

    if (agent.userId !== userId) {
      return NextResponse.json({ error: "You can only delete your own agents" }, { status: 403 });
    }

    await prisma.agent.delete({ where: { id } });

    return NextResponse.json({
      success: true,
      message: `Agent "${agent.name}" deleted successfully`,
    });
  } catch (error) {
    console.error("Delete agent error:", error);
    return NextResponse.json({ error: "Failed to delete agent" }, { status: 500 });
  }
}
