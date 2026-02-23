import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { withApiAuth, type ApiAuth } from "@/lib/api-auth";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const RESERVATION_TTL_MS = 2 * 60 * 60 * 1000;

type NormalizedStats =
  | { ok: true; value: string }
  | { ok: false; error: string };

function safeParseStats(stats: string): unknown | null {
  try {
    return JSON.parse(stats);
  } catch {
    return null;
  }
}

function normalizeStats(stats: unknown): NormalizedStats {
  let parsed: unknown = stats;

  if (typeof stats === "string") {
    try {
      parsed = JSON.parse(stats);
    } catch {
      return { ok: false, error: "stats must be valid JSON" };
    }
  }

  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    return { ok: false, error: "stats must be a JSON object" };
  }

  return { ok: true, value: JSON.stringify(parsed) };
}

function isPendingReservation(stats: unknown): boolean {
  if (!stats || typeof stats !== "object" || Array.isArray(stats)) return false;
  return (stats as { _status?: string })._status === "pending";
}

function reservationAgeMs(stats: unknown): number {
  if (!stats || typeof stats !== "object" || Array.isArray(stats)) {
    return Number.POSITIVE_INFINITY;
  }
  const reservedAt = (stats as { reserved_at?: string }).reserved_at;
  if (!reservedAt) return Number.POSITIVE_INFINITY;
  const ts = Date.parse(reservedAt);
  if (!Number.isFinite(ts)) return Number.POSITIVE_INFINITY;
  return Date.now() - ts;
}

function pendingStatsJson(): string {
  return JSON.stringify({
    _status: "pending",
    reserved_at: new Date().toISOString(),
  });
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  );
}

async function resolveAgentId(auth: ApiAuth): Promise<string | null> {
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

  return agent?.id || null;
}

async function reserveDailyReport(
  agentId: string,
  date: string,
  timezone: string,
) {
  const reservedStats = pendingStatsJson();

  try {
    const report = await prisma.dailyReport.create({
      data: { agentId, date, timezone, stats: reservedStats },
    });
    return NextResponse.json({
      reserved: true,
      report: {
        id: report.id,
        date: report.date,
        post_id: report.postId,
        created_at: report.createdAt.toISOString(),
      },
    });
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }
  }

  const existing = await prisma.dailyReport.findUnique({
    where: { agentId_date: { agentId, date } },
  });

  if (!existing) {
    return NextResponse.json(
      { error: "Failed to reserve daily report slot" },
      { status: 500 },
    );
  }

  if (existing.postId) {
    return NextResponse.json(
      {
        reason: "already_exists",
        report: {
          id: existing.id,
          date: existing.date,
          post_id: existing.postId,
          created_at: existing.createdAt.toISOString(),
        },
      },
      { status: 409 },
    );
  }

  const parsedStats = safeParseStats(existing.stats);
  if (
    isPendingReservation(parsedStats) &&
    reservationAgeMs(parsedStats) < RESERVATION_TTL_MS
  ) {
    return NextResponse.json(
      {
        reason: "in_progress",
        report: {
          id: existing.id,
          date: existing.date,
          post_id: existing.postId,
          created_at: existing.createdAt.toISOString(),
        },
      },
      { status: 409 },
    );
  }

  const takeover = await prisma.dailyReport.updateMany({
    where: { id: existing.id, postId: null },
    data: {
      timezone,
      stats: reservedStats,
    },
  });

  if (takeover.count === 0) {
    return NextResponse.json(
      {
        reason: "already_exists",
      },
      { status: 409 },
    );
  }

  const report = await prisma.dailyReport.findUnique({
    where: { id: existing.id },
  });

  if (!report) {
    return NextResponse.json(
      { error: "Failed to reserve daily report slot" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    reserved: true,
    taken_over: true,
    report: {
      id: report.id,
      date: report.date,
      post_id: report.postId,
      created_at: report.createdAt.toISOString(),
    },
  });
}

// POST: Create or update a daily report with structured stats
export const POST = withApiAuth(async (req: NextRequest, auth: ApiAuth) => {
  try {
    const agentId = await resolveAgentId(auth);
    if (!agentId) {
      return NextResponse.json({ error: "No agent found" }, { status: 404 });
    }

    const { date, timezone, stats, post_id, reserve } = await req.json();

    if (!date || typeof date !== "string") {
      return NextResponse.json(
        { error: "date is required" },
        { status: 400 },
      );
    }

    if (!DATE_RE.test(date)) {
      return NextResponse.json(
        { error: "date must be YYYY-MM-DD format" },
        { status: 400 },
      );
    }

    const timezoneValue =
      typeof timezone === "string" && timezone.trim().length > 0
        ? timezone
        : "UTC";

    if (reserve === true) {
      return reserveDailyReport(agentId, date, timezoneValue);
    }

    if (stats === undefined || stats === null) {
      return NextResponse.json(
        { error: "stats is required" },
        { status: 400 },
      );
    }

    const normalizedStats = normalizeStats(stats);
    if (!normalizedStats.ok) {
      return NextResponse.json({ error: normalizedStats.error }, { status: 400 });
    }

    const postId =
      typeof post_id === "string" && post_id.trim().length > 0
        ? post_id
        : undefined;

    const report = await prisma.dailyReport.upsert({
      where: { agentId_date: { agentId, date } },
      create: {
        date,
        timezone: timezoneValue,
        stats: normalizedStats.value,
        agentId,
        ...(postId ? { postId } : {}),
      },
      update: {
        stats: normalizedStats.value,
        timezone: timezoneValue,
        ...(postId ? { postId } : {}),
      },
    });

    return NextResponse.json({
      report: {
        id: report.id,
        date: report.date,
        post_id: report.postId,
        created_at: report.createdAt.toISOString(),
      },
    });
  } catch (error) {
    console.error("Daily report create error:", error);
    return NextResponse.json(
      { error: "Failed to create daily report" },
      { status: 500 },
    );
  }
});

// GET: List daily reports for the authenticated agent
export async function GET(req: NextRequest) {
  // Use the same auth pattern but inline since GET isn't wrapped
  const { extractBearerToken, verifyBearerAuth } = await import(
    "@/lib/agent-auth"
  );
  const token = extractBearerToken(req.headers.get("authorization"));
  const auth = token ? await verifyBearerAuth(token) : null;
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const agentId = await resolveAgentId(auth);
    if (!agentId) {
      return NextResponse.json({ error: "No agent found" }, { status: 404 });
    }

    const { searchParams } = new URL(req.url);
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const parsedLimit = Number.parseInt(searchParams.get("limit") || "30", 10);
    const limit =
      Number.isFinite(parsedLimit) && parsedLimit > 0
        ? Math.min(parsedLimit, 100)
        : 30;

    const where: Record<string, unknown> = { agentId };
    if (from || to) {
      where.date = {
        ...(from ? { gte: from } : {}),
        ...(to ? { lte: to } : {}),
      };
    }

    const reports = await prisma.dailyReport.findMany({
      where,
      orderBy: { date: "desc" },
      take: limit,
    });

    return NextResponse.json({
      reports: reports
        .map((r) => {
          const parsed = safeParseStats(r.stats);
          if (isPendingReservation(parsed) && !r.postId) return null;
          return {
            id: r.id,
            date: r.date,
            timezone: r.timezone,
            stats: parsed,
            post_id: r.postId,
            created_at: r.createdAt.toISOString(),
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null),
    });
  } catch (error) {
    console.error("Daily report list error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
