import prisma from "@/lib/prisma";
import {
  extractJsonObject,
  refundPlatformCredit,
  reservePlatformCredit,
  resolveAiProviderForUser,
  runModelTextCompletion,
} from "@/lib/ai-provider";

const MEMORY_CATEGORIES = ["topic", "tone", "format", "behavior"] as const;
const MEMORY_POLARITIES = ["approved", "rejected"] as const;
const MEMORY_SOURCES = ["approve_review", "reject_review", "cycle_summary", "manual"] as const;

export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];
export type MemoryPolarity = (typeof MEMORY_POLARITIES)[number];
export type MemorySource = (typeof MEMORY_SOURCES)[number];

type MemoryRuleInput = {
  category: MemoryCategory;
  text: string;
};

type CycleRulePayload = {
  approved: MemoryRuleInput[];
  rejected: MemoryRuleInput[];
};

const MAX_RULE_TEXT = 300;
const MAX_RULES_PER_POLARITY = 60;
const REVIEW_FEEDBACK_COST_CENTS = 1;

function isMemoryCategory(value: unknown): value is MemoryCategory {
  return typeof value === "string" && MEMORY_CATEGORIES.includes(value as MemoryCategory);
}

function normalizeRuleText(input: string): string {
  return input.replace(/\s+/g, " ").trim().slice(0, MAX_RULE_TEXT);
}

function normalizeRuleKey(text: string): string {
  const compact = text
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return compact.slice(0, 120) || "rule";
}

function parseJsonArray(text: string): unknown[] {
  const trimmed = text.trim();
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  const blockMatch = text.match(/```json\s*([\s\S]*?)\s*```/i);
  if (blockMatch?.[1]) {
    try {
      const parsed = JSON.parse(blockMatch[1]);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function toRules(payload: unknown, maxRules: number): MemoryRuleInput[] {
  if (!Array.isArray(payload)) return [];
  return payload
    .map((row) => row as Record<string, unknown>)
    .filter((row) => isMemoryCategory(row.category) && typeof row.text === "string")
    .map((row) => ({
      category: row.category as MemoryCategory,
      text: normalizeRuleText(String(row.text)),
    }))
    .filter((row) => row.text.length >= 6)
    .slice(0, maxRules);
}

function dedupeRules(rules: MemoryRuleInput[]): MemoryRuleInput[] {
  const map = new Map<string, MemoryRuleInput>();
  for (const rule of rules) {
    const key = `${rule.category}:${normalizeRuleKey(rule.text)}`;
    if (!map.has(key)) {
      map.set(key, rule);
    }
  }
  return Array.from(map.values());
}

async function trimMemoryRules(agentId: string, polarity: MemoryPolarity): Promise<void> {
  const rows = await prisma.agentMemoryRule.findMany({
    where: { agentId, polarity },
    select: { id: true },
    orderBy: [{ weight: "desc" }, { lastEvidenceAt: "desc" }, { createdAt: "desc" }],
  });
  if (rows.length <= MAX_RULES_PER_POLARITY) return;

  const deleteIds = rows.slice(MAX_RULES_PER_POLARITY).map((row) => row.id);
  if (deleteIds.length === 0) return;

  await prisma.agentMemoryRule.deleteMany({
    where: { id: { in: deleteIds } },
  });
}

export async function mergeMemoryRules(args: {
  agentId: string;
  polarity: MemoryPolarity;
  rules: MemoryRuleInput[];
  source: MemorySource;
  weightDelta?: number;
}): Promise<number> {
  const weightDelta = Math.max(1, Math.floor(args.weightDelta ?? 1));
  const rules = dedupeRules(args.rules);
  if (rules.length === 0) return 0;

  const now = new Date();
  for (const rule of rules) {
    const key = normalizeRuleKey(rule.text);
    await prisma.agentMemoryRule.upsert({
      where: {
        agentId_polarity_category_key: {
          agentId: args.agentId,
          polarity: args.polarity,
          category: rule.category,
          key,
        },
      },
      update: {
        text: rule.text,
        weight: { increment: weightDelta },
        evidenceCount: { increment: 1 },
        source: args.source,
        lastEvidenceAt: now,
      },
      create: {
        agentId: args.agentId,
        polarity: args.polarity,
        category: rule.category,
        key,
        text: rule.text,
        source: args.source,
        weight: weightDelta,
        evidenceCount: 1,
        lastEvidenceAt: now,
      },
    });
  }

  await trimMemoryRules(args.agentId, args.polarity);
  return rules.length;
}

async function extractReviewRules(args: {
  userId: string;
  agentName: string;
  polarity: MemoryPolarity;
  actionMessage: string;
  note?: string;
}): Promise<MemoryRuleInput[]> {
  const provider = await resolveAiProviderForUser(args.userId);
  if (!provider) return [];
  const shouldCharge = provider.source === "platform";
  if (shouldCharge) {
    const reserved = await reservePlatformCredit(args.userId, REVIEW_FEEDBACK_COST_CENTS);
    if (!reserved) return [];
  }

  const systemPrompt = [
    `You are extracting durable owner preferences for agent "${args.agentName}".`,
    "Return strict JSON array only.",
    "Each element: {\"category\":\"topic|tone|format|behavior\",\"text\":\"...\"}.",
    "Output at most 3 items, concise and reusable.",
    args.polarity === "approved"
      ? "These are POSITIVE preferences the owner likes and wants repeated."
      : "These are NEGATIVE preferences the owner dislikes and wants avoided.",
  ].join("\n");

  const userPrompt = [
    `Action message: ${args.actionMessage}`,
    `Owner note: ${args.note?.trim() || "(none)"}`,
    "Extract stable preference rules, not one-off details.",
  ].join("\n");

  try {
    const { text } = await runModelTextCompletion({
      provider,
      systemPrompt,
      userPrompt,
      maxTokens: 400,
      temperature: 0.2,
    });
    return toRules(parseJsonArray(text), 3);
  } catch (error) {
    if (shouldCharge) {
      await refundPlatformCredit(args.userId, REVIEW_FEEDBACK_COST_CENTS).catch(() => {});
    }
    throw error;
  }
}

export async function learnFromReviewFeedback(args: {
  userId: string;
  agentId: string;
  agentName: string;
  polarity: MemoryPolarity;
  actionMessage: string;
  note?: string;
}): Promise<number> {
  const extractedRules = await extractReviewRules(args);
  if (extractedRules.length === 0) return 0;
  return mergeMemoryRules({
    agentId: args.agentId,
    polarity: args.polarity,
    rules: extractedRules,
    source: args.polarity === "approved" ? "approve_review" : "reject_review",
    weightDelta: 2,
  });
}

function parseCyclePayload(text: string): CycleRulePayload {
  const parsed = extractJsonObject(text);
  if (!parsed) {
    return { approved: [], rejected: [] };
  }
  return {
    approved: toRules((parsed as Record<string, unknown>).approved, 3),
    rejected: toRules((parsed as Record<string, unknown>).rejected, 3),
  };
}

export async function learnFromCycleSummary(args: {
  userId: string;
  agentId: string;
  agentName: string;
  summary: string;
}): Promise<{ approved: number; rejected: number; tokensUsed: number }> {
  const provider = await resolveAiProviderForUser(args.userId);
  if (!provider) return { approved: 0, rejected: 0, tokensUsed: 0 };

  const shouldCharge = provider.source === "platform";
  if (shouldCharge) {
    const reserved = await reservePlatformCredit(args.userId, 1);
    if (!reserved) {
      return { approved: 0, rejected: 0, tokensUsed: 0 };
    }
  }

  const systemPrompt = [
    `You summarize behavior signals for agent "${args.agentName}".`,
    "Return strict JSON object only.",
    "Format:",
    "{\"approved\":[{\"category\":\"topic|tone|format|behavior\",\"text\":\"...\"}],\"rejected\":[{\"category\":\"topic|tone|format|behavior\",\"text\":\"...\"}]}",
    "Each side at most 3 rules. Rules must be stable and reusable.",
  ].join("\n");

  let text = "";
  let tokensUsed = 0;
  try {
    const result = await runModelTextCompletion({
      provider,
      systemPrompt,
      userPrompt: args.summary,
      maxTokens: 500,
      temperature: 0.2,
    });
    text = result.text;
    tokensUsed = result.usage.totalTokens;
  } catch (error) {
    if (shouldCharge) {
      await refundPlatformCredit(args.userId, 1).catch(() => {});
    }
    throw error;
  }

  const parsed = parseCyclePayload(text);

  const approved = await mergeMemoryRules({
    agentId: args.agentId,
    polarity: "approved",
    rules: parsed.approved,
    source: "cycle_summary",
    weightDelta: 1,
  });
  const rejected = await mergeMemoryRules({
    agentId: args.agentId,
    polarity: "rejected",
    rules: parsed.rejected,
    source: "cycle_summary",
    weightDelta: 1,
  });

  return { approved, rejected, tokensUsed };
}

export async function listMemoryRules(agentId: string): Promise<{
  approved: Array<{
    id: string;
    category: MemoryCategory;
    text: string;
    weight: number;
    evidenceCount: number;
    source: MemorySource;
    updatedAt: Date;
  }>;
  rejected: Array<{
    id: string;
    category: MemoryCategory;
    text: string;
    weight: number;
    evidenceCount: number;
    source: MemorySource;
    updatedAt: Date;
  }>;
}> {
  const rows = await prisma.agentMemoryRule.findMany({
    where: { agentId },
    select: {
      id: true,
      polarity: true,
      category: true,
      text: true,
      weight: true,
      evidenceCount: true,
      source: true,
      updatedAt: true,
    },
    orderBy: [{ weight: "desc" }, { updatedAt: "desc" }],
  });

  const approved = rows
    .filter((row) => row.polarity === "approved")
    .map((row) => ({
      id: row.id,
      category: row.category as MemoryCategory,
      text: row.text,
      weight: row.weight,
      evidenceCount: row.evidenceCount,
      source: row.source as MemorySource,
      updatedAt: row.updatedAt,
    }));
  const rejected = rows
    .filter((row) => row.polarity === "rejected")
    .map((row) => ({
      id: row.id,
      category: row.category as MemoryCategory,
      text: row.text,
      weight: row.weight,
      evidenceCount: row.evidenceCount,
      source: row.source as MemorySource,
      updatedAt: row.updatedAt,
    }));

  return { approved, rejected };
}

export async function listTopRules(args: {
  agentId: string;
  polarity: MemoryPolarity;
  limit?: number;
}): Promise<string[]> {
  const rows = await prisma.agentMemoryRule.findMany({
    where: { agentId: args.agentId, polarity: args.polarity },
    orderBy: [{ weight: "desc" }, { lastEvidenceAt: "desc" }],
    take: Math.max(1, Math.min(args.limit ?? 8, 20)),
    select: { text: true },
  });
  return rows.map((row) => row.text);
}

export async function createManualMemoryRule(args: {
  agentId: string;
  polarity: MemoryPolarity;
  category: MemoryCategory;
  text: string;
}): Promise<{
  id: string;
  polarity: MemoryPolarity;
  category: MemoryCategory;
  text: string;
  weight: number;
  evidenceCount: number;
  source: MemorySource;
  updatedAt: Date;
}> {
  const normalizedText = normalizeRuleText(args.text);
  if (normalizedText.length < 3) {
    throw new Error("memory_rule_too_short");
  }
  const key = normalizeRuleKey(normalizedText);
  const now = new Date();
  const row = await prisma.agentMemoryRule.upsert({
    where: {
      agentId_polarity_category_key: {
        agentId: args.agentId,
        polarity: args.polarity,
        category: args.category,
        key,
      },
    },
    update: {
      text: normalizedText,
      source: "manual",
      weight: { increment: 1 },
      evidenceCount: { increment: 1 },
      lastEvidenceAt: now,
    },
    create: {
      agentId: args.agentId,
      polarity: args.polarity,
      category: args.category,
      key,
      text: normalizedText,
      source: "manual",
      weight: 1,
      evidenceCount: 1,
      lastEvidenceAt: now,
    },
    select: {
      id: true,
      polarity: true,
      category: true,
      text: true,
      weight: true,
      evidenceCount: true,
      source: true,
      updatedAt: true,
    },
  });

  await trimMemoryRules(args.agentId, args.polarity);
  return {
    id: row.id,
    polarity: row.polarity as MemoryPolarity,
    category: row.category as MemoryCategory,
    text: row.text,
    weight: row.weight,
    evidenceCount: row.evidenceCount,
    source: row.source as MemorySource,
    updatedAt: row.updatedAt,
  };
}

export async function updateMemoryRule(args: {
  agentId: string;
  ruleId: string;
  category?: MemoryCategory;
  text?: string;
  polarity?: MemoryPolarity;
}): Promise<{
  id: string;
  polarity: MemoryPolarity;
  category: MemoryCategory;
  text: string;
  weight: number;
  evidenceCount: number;
  source: MemorySource;
  updatedAt: Date;
} | null> {
  const current = await prisma.agentMemoryRule.findFirst({
    where: { id: args.ruleId, agentId: args.agentId },
    select: {
      id: true,
      polarity: true,
      category: true,
      text: true,
      weight: true,
      evidenceCount: true,
      source: true,
      updatedAt: true,
    },
  });
  if (!current) return null;

  const nextPolarity = args.polarity || (current.polarity as MemoryPolarity);
  const nextCategory = args.category || (current.category as MemoryCategory);
  const nextText = args.text ? normalizeRuleText(args.text) : current.text;
  if (nextText.length < 3) {
    throw new Error("memory_rule_too_short");
  }
  const nextKey = normalizeRuleKey(nextText);

  // If uniqueness dimensions changed, prefer updating the current row to keep rule ID stable.
  const changedIdentity =
    nextPolarity !== current.polarity || nextCategory !== current.category || nextKey !== normalizeRuleKey(current.text);
  if (changedIdentity) {
    const conflict = await prisma.agentMemoryRule.findFirst({
      where: {
        agentId: args.agentId,
        polarity: nextPolarity,
        category: nextCategory,
        key: nextKey,
        id: { not: current.id },
      },
      select: { id: true },
    });

    if (conflict) {
      const merged = await prisma.agentMemoryRule.update({
        where: { id: conflict.id },
        data: {
          text: nextText,
          source: "manual",
          weight: { increment: 1 },
          evidenceCount: { increment: 1 },
          lastEvidenceAt: new Date(),
        },
        select: {
          id: true,
          polarity: true,
          category: true,
          text: true,
          weight: true,
          evidenceCount: true,
          source: true,
          updatedAt: true,
        },
      });
      await prisma.agentMemoryRule.delete({
        where: { id: current.id },
      });
      return {
        id: merged.id,
        polarity: merged.polarity as MemoryPolarity,
        category: merged.category as MemoryCategory,
        text: merged.text,
        weight: merged.weight,
        evidenceCount: merged.evidenceCount,
        source: merged.source as MemorySource,
        updatedAt: merged.updatedAt,
      };
    }

    const updatedCurrent = await prisma.agentMemoryRule.update({
      where: { id: current.id },
      data: {
        polarity: nextPolarity,
        category: nextCategory,
        key: nextKey,
        text: nextText,
        source: "manual",
        lastEvidenceAt: new Date(),
      },
      select: {
        id: true,
        polarity: true,
        category: true,
        text: true,
        weight: true,
        evidenceCount: true,
        source: true,
        updatedAt: true,
      },
    });

    return {
      id: updatedCurrent.id,
      polarity: updatedCurrent.polarity as MemoryPolarity,
      category: updatedCurrent.category as MemoryCategory,
      text: updatedCurrent.text,
      weight: updatedCurrent.weight,
      evidenceCount: updatedCurrent.evidenceCount,
      source: updatedCurrent.source as MemorySource,
      updatedAt: updatedCurrent.updatedAt,
    };
  }

  const updated = await prisma.agentMemoryRule.update({
    where: { id: current.id },
    data: {
      text: nextText,
      source: "manual",
      lastEvidenceAt: new Date(),
    },
    select: {
      id: true,
      polarity: true,
      category: true,
      text: true,
      weight: true,
      evidenceCount: true,
      source: true,
      updatedAt: true,
    },
  });

  return {
    id: updated.id,
    polarity: updated.polarity as MemoryPolarity,
    category: updated.category as MemoryCategory,
    text: updated.text,
    weight: updated.weight,
    evidenceCount: updated.evidenceCount,
    source: updated.source as MemorySource,
    updatedAt: updated.updatedAt,
  };
}

export async function deleteMemoryRule(args: { agentId: string; ruleId: string }): Promise<boolean> {
  const result = await prisma.agentMemoryRule.deleteMany({
    where: { id: args.ruleId, agentId: args.agentId },
  });
  return result.count > 0;
}

export async function listSystemMemoryLogs(agentId: string, limit = 50): Promise<Array<{
  id: string;
  reviewAction: string;
  message: string | null;
  note: string | null;
  notificationId: string | null;
  createdAt: Date;
}>> {
  const rows = await prisma.agentSystemMemoryLog.findMany({
    where: { agentId },
    orderBy: { createdAt: "desc" },
    take: Math.max(1, Math.min(limit, 200)),
    select: {
      id: true,
      reviewAction: true,
      message: true,
      note: true,
      notificationId: true,
      createdAt: true,
    },
  });

  return rows.map((row) => ({
    id: row.id,
    reviewAction: row.reviewAction,
    message: row.message,
    note: row.note,
    notificationId: row.notificationId,
    createdAt: row.createdAt,
  }));
}

export async function appendSystemMemoryLog(args: {
  agentId: string;
  notificationId?: string | null;
  reviewAction: "approved" | "rejected" | "undo";
  message?: string | null;
  note?: string | null;
}): Promise<void> {
  await prisma.agentSystemMemoryLog.create({
    data: {
      agentId: args.agentId,
      notificationId: args.notificationId || null,
      reviewAction: args.reviewAction,
      message: args.message || null,
      note: args.note || null,
    },
  });
}
