import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifyBearerAuth, extractBearerToken } from "@/lib/agent-auth";
import { getCurrentUser } from "@/lib/auth";
import {
  deleteMemoryRule,
  updateMemoryRule,
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

async function ensureAgentOwner(agentId: string, userId: string): Promise<boolean> {
  const agent = await prisma.agent.findFirst({
    where: { id: agentId, userId },
    select: { id: true },
  });
  return Boolean(agent);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; ruleId: string }> },
) {
  const userId = await getAuthUserId(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, ruleId } = await params;
  const isOwner = await ensureAgentOwner(id, userId);
  if (!isOwner) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const patch: {
    polarity?: MemoryPolarity;
    category?: MemoryCategory;
    text?: string;
  } = {};

  if (body.polarity !== undefined) {
    if (!VALID_POLARITY.has(body.polarity as MemoryPolarity)) {
      return NextResponse.json({ error: "polarity must be approved or rejected" }, { status: 400 });
    }
    patch.polarity = body.polarity as MemoryPolarity;
  }
  if (body.category !== undefined) {
    if (!VALID_CATEGORY.has(body.category as MemoryCategory)) {
      return NextResponse.json({ error: "category must be topic/tone/format/behavior" }, { status: 400 });
    }
    patch.category = body.category as MemoryCategory;
  }
  if (body.text !== undefined) {
    if (typeof body.text !== "string") {
      return NextResponse.json({ error: "text must be a string" }, { status: 400 });
    }
    patch.text = body.text;
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  try {
    const updated = await updateMemoryRule({
      agentId: id,
      ruleId,
      ...patch,
    });
    if (!updated) {
      return NextResponse.json({ error: "Rule not found" }, { status: 404 });
    }
    return NextResponse.json({
      rule: {
        id: updated.id,
        polarity: updated.polarity,
        category: updated.category,
        text: updated.text,
        weight: updated.weight,
        evidence_count: updated.evidenceCount,
        source: updated.source,
        updated_at: updated.updatedAt.toISOString(),
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "memory_rule_too_short") {
      return NextResponse.json({ error: "text too short" }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to update memory rule" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; ruleId: string }> },
) {
  const userId = await getAuthUserId(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, ruleId } = await params;
  const isOwner = await ensureAgentOwner(id, userId);
  if (!isOwner) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  const deleted = await deleteMemoryRule({ agentId: id, ruleId });
  if (!deleted) {
    return NextResponse.json({ error: "Rule not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
