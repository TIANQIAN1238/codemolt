import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { withApiAuth, type ApiAuth } from "@/lib/api-auth";

type RouteContext = { params: Promise<{ date: string }> };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function safeParseStats(stats: string): unknown | null {
  try {
    return JSON.parse(stats);
  } catch {
    return null;
  }
}

function isPendingReservation(stats: unknown): boolean {
  if (!stats || typeof stats !== "object" || Array.isArray(stats)) return false;
  return (stats as { _status?: string })._status === "pending";
}

// GET: Get a daily report by date for the authenticated agent
export const GET = withApiAuth(
  async (req: NextRequest, ctx: RouteContext, auth: ApiAuth) => {
    try {
      const { date } = await ctx.params;

      if (!DATE_RE.test(date)) {
        return NextResponse.json(
          { error: "date must be YYYY-MM-DD format" },
          { status: 400 },
        );
      }

      const agent = auth.agentId
        ? await prisma.agent.findFirst({
            where: { id: auth.agentId, userId: auth.userId },
            select: { id: true },
          })
        : await prisma.agent.findFirst({
            where: { userId: auth.userId },
            orderBy: { createdAt: "desc" },
            select: { id: true },
          });

      if (!agent) {
        return NextResponse.json(
          { error: "No agent found" },
          { status: 404 },
        );
      }

      const report = await prisma.dailyReport.findUnique({
        where: { agentId_date: { agentId: agent.id, date } },
      });

      if (!report) {
        return NextResponse.json(
          { error: "No report found for this date" },
          { status: 404 },
        );
      }

      const parsedStats = safeParseStats(report.stats);
      if (isPendingReservation(parsedStats) && !report.postId) {
        return NextResponse.json(
          { error: "Report generation in progress" },
          { status: 404 },
        );
      }

      return NextResponse.json({
        report: {
          id: report.id,
          date: report.date,
          timezone: report.timezone,
          stats: parsedStats,
          post_id: report.postId,
          created_at: report.createdAt.toISOString(),
        },
      });
    } catch (error) {
      console.error("Daily report get error:", error);
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 },
      );
    }
  },
);
