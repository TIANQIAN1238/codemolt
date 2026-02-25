import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifyBearerAuth, extractBearerToken } from "@/lib/agent-auth";
import { getCurrentUser } from "@/lib/auth";
import {
  createManualMemoryRule,
  listMemoryRules,
  listSystemMemoryLogs,
  type MemoryCategory,
  type MemoryPolarity,
} from "@/lib/memory/learning";

const VALID_POLARITY = new Set<MemoryPolarity>(["approved", "rejected"]);
const VALID_CATEGORY = new Set<MemoryCategory>(["topic", "tone", "format", "behavior"]);

async function getAuthUserId(req: NextRequest): Promise<string | null> {
  const token = extractBearerToken(req.headers.get("authorization"));
  const agentAuth = token ? await verifyBearerAuth(token) : null;
  return agentAuth?.userId || (await getCurrentUser());
}

async function ensureAgentOwner(agentId: string, userId: string): Promise<{ id: string; name: string } | null> {
  return prisma.agent.findFirst({
    where: { id: agentId, userId },
    select: { id: true, name: true },
  });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getAuthUserId(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const agent = await ensureAgentOwner(id, userId);
  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  const [memory, systemLogs] = await Promise.all([
    listMemoryRules(agent.id),
    listSystemMemoryLogs(agent.id, 100),
  ]);

  return NextResponse.json({
    agent: { id: agent.id, name: agent.name },
    approved_rules: memory.approved.map((row) => ({
      id: row.id,
      category: row.category,
      text: row.text,
      weight: row.weight,
      evidence_count: row.evidenceCount,
      source: row.source,
      updated_at: row.updatedAt.toISOString(),
    })),
    rejected_rules: memory.rejected.map((row) => ({
      id: row.id,
      category: row.category,
      text: row.text,
      weight: row.weight,
      evidence_count: row.evidenceCount,
      source: row.source,
      updated_at: row.updatedAt.toISOString(),
    })),
    system_logs: systemLogs.map((log) => ({
      id: log.id,
      review_action: log.reviewAction,
      message: log.message,
      note: log.note,
      notification_id: log.notificationId,
      created_at: log.createdAt.toISOString(),
    })),
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getAuthUserId(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const agent = await ensureAgentOwner(id, userId);
  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const polarity = body.polarity as MemoryPolarity;
  const category = body.category as MemoryCategory;
  const text = typeof body.text === "string" ? body.text : "";

  if (!VALID_POLARITY.has(polarity)) {
    return NextResponse.json({ error: "polarity must be approved or rejected" }, { status: 400 });
  }
  if (!VALID_CATEGORY.has(category)) {
    return NextResponse.json({ error: "category must be topic/tone/format/behavior" }, { status: 400 });
  }
  if (!text.trim()) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }

  try {
    const created = await createManualMemoryRule({
      agentId: agent.id,
      polarity,
      category,
      text,
    });
    return NextResponse.json({
      rule: {
        id: created.id,
        polarity: created.polarity,
        category: created.category,
        text: created.text,
        weight: created.weight,
        evidence_count: created.evidenceCount,
        source: created.source,
        updated_at: created.updatedAt.toISOString(),
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "memory_rule_too_short") {
      return NextResponse.json({ error: "text too short" }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to create memory rule" }, { status: 500 });
  }
}
