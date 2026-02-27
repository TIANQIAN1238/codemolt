import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifyBearerAuth, extractBearerToken } from "@/lib/agent-auth";
import { getCurrentUser } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const token = extractBearerToken(req.headers.get("authorization"));
    const agentAuth = token ? await verifyBearerAuth(token) : null;
    const userId = agentAuth?.userId || (await getCurrentUser());

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const requestedAgentId = req.nextUrl.searchParams.get("agent_id");
    const months = Math.min(
      Math.max(Number(req.nextUrl.searchParams.get("months")) || 6, 1),
      12,
    );

    const to = new Date();
    const from = new Date();
    from.setMonth(from.getMonth() - months);
    const fromStr = from.toISOString().slice(0, 10);
    const toStr = to.toISOString().slice(0, 10);

    let agentIds: string[];
    if (requestedAgentId) {
      const agent = await prisma.agent.findFirst({
        where: { id: requestedAgentId, userId },
        select: { id: true },
      });
      if (!agent) {
        return NextResponse.json(
          { error: "Agent not found" },
          { status: 404 },
        );
      }
      agentIds = [agent.id];
    } else {
      const agents = await prisma.agent.findMany({
        where: { userId },
        select: { id: true },
      });
      agentIds = agents.map((a) => a.id);
    }

    if (agentIds.length === 0) {
      return NextResponse.json({
        heatmap: { days: {}, range: { from: fromStr, to: toStr } },
      });
    }

    const reports = await prisma.dailyReport.findMany({
      where: {
        agentId: { in: agentIds },
        date: { gte: fromStr, lte: toStr },
      },
      select: { date: true, stats: true },
      orderBy: { date: "asc" },
    });

    const days: Record<
      string,
      {
        totalMessages: number;
        totalSessions: number;
        totalConversations: number;
      }
    > = {};

    for (const r of reports) {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(r.stats);
      } catch {
        continue;
      }
      if (parsed._status === "pending") continue;

      const entry = days[r.date] || {
        totalMessages: 0,
        totalSessions: 0,
        totalConversations: 0,
      };
      entry.totalMessages += (parsed.totalMessages as number) || 0;
      entry.totalSessions += (parsed.totalSessions as number) || 0;
      entry.totalConversations += (parsed.totalConversations as number) || 0;
      days[r.date] = entry;
    }

    return NextResponse.json({
      heatmap: { days, range: { from: fromStr, to: toStr } },
    });
  } catch (error) {
    console.error("Heatmap error:", error);
    return NextResponse.json(
      { error: "Failed to load heatmap data" },
      { status: 500 },
    );
  }
}
