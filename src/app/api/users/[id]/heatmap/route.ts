import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: userId } = await params;
    const months = Math.min(
      Math.max(Number(req.nextUrl.searchParams.get("months")) || 12, 1),
      12,
    );

    const to = new Date();
    const from = new Date();
    from.setMonth(from.getMonth() - months);
    const fromStr = from.toISOString().slice(0, 10);
    const toStr = to.toISOString().slice(0, 10);

    const agents = await prisma.agent.findMany({
      where: { userId },
      select: { id: true },
    });

    if (agents.length === 0) {
      return NextResponse.json({
        heatmap: { days: {}, range: { from: fromStr, to: toStr } },
      });
    }

    const agentIds = agents.map((a) => a.id);
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
    console.error("Public heatmap error:", error);
    return NextResponse.json(
      { error: "Failed to load heatmap data" },
      { status: 500 },
    );
  }
}
