import * as path from "path";
import { getHome } from "./platform.js";
import { listFiles, listDirs, readJsonl, decodeDirNameToPath } from "./fs-utils.js";
import { scanAll } from "./registry.js";

// ─── Types ───────────────────────────────────────────────────────────

export interface ModelTokens {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  costUSD: number;
}

export interface ProjectStats {
  name: string;
  path: string;
  sessionCount: number;
  messageCount: number;
  tokensUsed: number;
}

export interface IdeStats {
  source: string;
  sessionCount: number;
  messageCount: number;
}

export interface DailyUsageStats {
  date: string;
  timezone: string;
  totalSessions: number;
  totalConversations: number;
  totalMessages: number;
  tokensByModel: Record<string, ModelTokens>;
  totalTokens: number;
  totalCostUSD: number;
  projects: ProjectStats[];
  ideBreakdown: IdeStats[];
  hourlyActivity: Record<number, number>;
}

// ─── Pricing (per 1M tokens, from ccclub) ────────────────────────────

interface ModelPricing {
  input: number;
  output: number;
  cacheCreation: number;
  cacheRead: number;
}

const FAMILY_PRICING: Record<string, ModelPricing> = {
  opus: { input: 5, output: 25, cacheCreation: 6.25, cacheRead: 0.50 },
  sonnet: { input: 3, output: 15, cacheCreation: 3.75, cacheRead: 0.30 },
  haiku: { input: 1, output: 5, cacheCreation: 1.25, cacheRead: 0.10 },
};

function getPricing(model: string): ModelPricing {
  const lower = model.toLowerCase();
  if (lower.includes("opus")) return FAMILY_PRICING.opus;
  if (lower.includes("haiku")) return FAMILY_PRICING.haiku;
  return FAMILY_PRICING.sonnet;
}

function calculateCost(
  model: string,
  input: number,
  output: number,
  cacheCreation: number,
  cacheRead: number,
): number {
  const p = getPricing(model);
  return (
    (input * p.input +
      output * p.output +
      cacheCreation * p.cacheCreation +
      cacheRead * p.cacheRead) /
    1_000_000
  );
}

// ─── JSONL entry shape ───────────────────────────────────────────────

interface ClaudeUsageEntry {
  type: string;
  timestamp?: string;
  sessionId?: string;
  cwd?: string;
  message?: {
    model?: string;
    role?: string;
    content?: unknown;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
  costUSD?: number;
}

// ─── Date helpers ────────────────────────────────────────────────────

function toLocalDate(isoTimestamp: string, timezone: string): string {
  try {
    const d = new Date(isoTimestamp);
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(d);
    const y = parts.find((p) => p.type === "year")?.value;
    const m = parts.find((p) => p.type === "month")?.value;
    const dd = parts.find((p) => p.type === "day")?.value;
    return `${y}-${m}-${dd}`;
  } catch {
    return isoTimestamp.slice(0, 10);
  }
}

function toLocalHour(isoTimestamp: string, timezone: string): number {
  try {
    const d = new Date(isoTimestamp);
    return parseInt(
      new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        hour: "numeric",
        hour12: false,
      }).format(d),
    );
  } catch {
    return new Date(isoTimestamp).getHours();
  }
}

// ─── Main collector ──────────────────────────────────────────────────

export function collectDailyUsage(
  targetDate: string,
  timezone?: string,
): DailyUsageStats {
  const tz = timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const projectsDir = path.join(getHome(), ".claude", "projects");

  const tokensByModel: Record<string, ModelTokens> = {};
  const projectMap = new Map<
    string,
    { path: string; sessions: Set<string>; messages: number; tokens: number }
  >();
  const sessionIds = new Set<string>();
  let totalConversations = 0;
  let totalMessages = 0;
  const hourlyActivity: Record<number, number> = {};

  const projectDirs = listDirs(projectsDir);

  for (const projectDir of projectDirs) {
    const dirName = path.basename(projectDir);
    const files = listFiles(projectDir, [".jsonl"]);

    for (const filePath of files) {
      const entries = readJsonl<ClaudeUsageEntry>(filePath);
      if (entries.length === 0) continue;

      // Check if any entry in this file matches the target date
      let hasMatchingDate = false;
      let projectPath = "";
      let projectName = dirName;
      const sessionId = path.basename(filePath, ".jsonl");

      for (const entry of entries) {
        if (!entry.timestamp) continue;
        const entryDate = toLocalDate(entry.timestamp, tz);
        if (entryDate !== targetDate) continue;

        hasMatchingDate = true;

        // Extract project info from cwd
        if (!projectPath && entry.cwd) {
          projectPath = entry.cwd;
          projectName = path.basename(projectPath);
        }

        // Count user messages as conversations
        if (entry.type === "user") {
          // Skip tool_result-only messages
          const content = entry.message?.content;
          const isToolResult =
            Array.isArray(content) &&
            content.length > 0 &&
            content.every(
              (c: { type?: string }) => c.type === "tool_result",
            );
          if (!isToolResult) {
            totalConversations++;
            totalMessages++;
            const hour = toLocalHour(entry.timestamp, tz);
            hourlyActivity[hour] = (hourlyActivity[hour] || 0) + 1;
          }
        }

        // Extract usage from assistant messages
        if (entry.type === "assistant" && entry.message?.usage) {
          totalMessages++;
          sessionIds.add(sessionId);

          const usage = entry.message.usage;
          const model = entry.message.model || "unknown";
          // Skip synthetic/internal entries with no real tokens
          if (model === "<synthetic>") continue;
          const input = usage.input_tokens || 0;
          const output = usage.output_tokens || 0;
          const cacheCreation = usage.cache_creation_input_tokens || 0;
          const cacheRead = usage.cache_read_input_tokens || 0;
          const tokens = input + output + cacheCreation + cacheRead;

          // Use pre-calculated cost if available, otherwise calculate
          const cost =
            entry.costUSD && entry.costUSD > 0
              ? entry.costUSD
              : calculateCost(model, input, output, cacheCreation, cacheRead);

          // Accumulate by model
          if (!tokensByModel[model]) {
            tokensByModel[model] = {
              inputTokens: 0,
              outputTokens: 0,
              cacheCreationTokens: 0,
              cacheReadTokens: 0,
              costUSD: 0,
            };
          }
          tokensByModel[model].inputTokens += input;
          tokensByModel[model].outputTokens += output;
          tokensByModel[model].cacheCreationTokens += cacheCreation;
          tokensByModel[model].cacheReadTokens += cacheRead;
          tokensByModel[model].costUSD += cost;

          // Accumulate by project
          const pKey = projectPath || dirName;
          if (!projectMap.has(pKey)) {
            projectMap.set(pKey, {
              path: projectPath || dirName,
              sessions: new Set(),
              messages: 0,
              tokens: 0,
            });
          }
          const proj = projectMap.get(pKey)!;
          proj.sessions.add(sessionId);
          proj.messages++;
          proj.tokens += tokens;
        }
      }

      // If no matching date entries, also try to decode project path for later
      if (!hasMatchingDate) continue;

      // Ensure project path is decoded if we only have dir name
      if (!projectPath && dirName.startsWith("-")) {
        projectPath = decodeDirNameToPath(dirName) || "";
        if (projectPath) projectName = path.basename(projectPath);
      }
    }
  }

  // Build project stats
  const projects: ProjectStats[] = Array.from(projectMap.entries())
    .map(([, v]) => ({
      name: path.basename(v.path),
      path: v.path,
      sessionCount: v.sessions.size,
      messageCount: v.messages,
      tokensUsed: v.tokens,
    }))
    .sort((a, b) => b.tokensUsed - a.tokensUsed);

  // Calculate totals
  let totalTokens = 0;
  let totalCostUSD = 0;
  for (const m of Object.values(tokensByModel)) {
    totalTokens +=
      m.inputTokens +
      m.outputTokens +
      m.cacheCreationTokens +
      m.cacheReadTokens;
    totalCostUSD += m.costUSD;
  }
  totalCostUSD = Math.round(totalCostUSD * 10000) / 10000;

  // Get IDE breakdown from existing scanners (also merges other IDE sessions/projects)
  const { ideBreakdown, otherIdeSessions, otherIdeConversations, otherIdeProjects } =
    collectIdeBreakdown(targetDate, tz, sessionIds.size, totalConversations);

  // Merge other IDE projects into project list
  for (const op of otherIdeProjects) {
    const existing = projects.find((p) =>
      op.path && p.path ? p.path === op.path : p.name === op.name,
    );
    if (existing) {
      existing.sessionCount += op.sessionCount;
      existing.messageCount += op.messageCount;
    } else {
      projects.push(op);
    }
  }
  projects.sort((a, b) => b.sessionCount - a.sessionCount);

  return {
    date: targetDate,
    timezone: tz,
    totalSessions: sessionIds.size + otherIdeSessions,
    totalConversations: totalConversations + otherIdeConversations,
    totalMessages,
    tokensByModel,
    totalTokens,
    totalCostUSD,
    projects,
    ideBreakdown,
    hourlyActivity,
  };
}

// ─── IDE breakdown from scanners ─────────────────────────────────────

interface IdeBreakdownResult {
  ideBreakdown: IdeStats[];
  otherIdeSessions: number;
  otherIdeConversations: number;
  otherIdeProjects: ProjectStats[];
}

function collectIdeBreakdown(
  targetDate: string,
  timezone: string,
  claudeCodeSessions: number,
  claudeCodeConversations: number,
): IdeBreakdownResult {
  const breakdown: IdeStats[] = [];
  let otherIdeSessions = 0;
  let otherIdeConversations = 0;
  const otherIdeProjects: ProjectStats[] = [];

  // Claude Code stats come from our own JSONL parsing above
  if (claudeCodeSessions > 0) {
    breakdown.push({
      source: "claude-code",
      sessionCount: claudeCodeSessions,
      messageCount: claudeCodeConversations,
    });
  }

  // Scan other IDEs via the scanner registry
  try {
    const allSessions = scanAll(200);
    const otherSources = new Map<
      string,
      { sessions: number; messages: number }
    >();
    const otherProjectMap = new Map<
      string,
      { name: string; path: string; sessions: Set<string>; messages: number }
    >();

    for (const session of allSessions) {
      if (session.source === "claude-code") continue;

      // Check if session was modified on the target date
      const sessionDate = toLocalDate(session.modifiedAt.toISOString(), timezone);
      if (sessionDate !== targetDate) continue;

      // IDE stats
      if (!otherSources.has(session.source)) {
        otherSources.set(session.source, { sessions: 0, messages: 0 });
      }
      const s = otherSources.get(session.source)!;
      s.sessions++;
      s.messages += session.humanMessages;

      // Project stats
      const projPath = (session.project || "").trim() || "unknown-project";
      const projName = path.basename(projPath) || projPath;
      if (!otherProjectMap.has(projPath)) {
        otherProjectMap.set(projPath, {
          name: projName,
          path: projPath,
          sessions: new Set(),
          messages: 0,
        });
      }
      const p = otherProjectMap.get(projPath)!;
      p.sessions.add(session.id);
      p.messages += session.messageCount;
    }

    for (const [source, stats] of otherSources) {
      breakdown.push({
        source,
        sessionCount: stats.sessions,
        messageCount: stats.messages,
      });
      otherIdeSessions += stats.sessions;
      otherIdeConversations += stats.messages;
    }

    for (const [, p] of otherProjectMap) {
      otherIdeProjects.push({
        name: p.name,
        path: p.path,
        sessionCount: p.sessions.size,
        messageCount: p.messages,
        tokensUsed: 0, // Other IDEs don't provide token data
      });
    }
  } catch {
    // Scanner errors are non-critical
  }

  breakdown.sort((a, b) => b.sessionCount - a.sessionCount);
  return { ideBreakdown: breakdown, otherIdeSessions, otherIdeConversations, otherIdeProjects };
}

// ─── Formatting helpers ──────────────────────────────────────────────

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function formatCost(usd: number): string {
  return `$${usd.toFixed(2)}`;
}
