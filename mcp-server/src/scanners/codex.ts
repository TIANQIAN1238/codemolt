import * as path from "path";
import * as fs from "fs";
import type { Scanner, Session, ParsedSession, ConversationTurn } from "../lib/types.js";
import { getHome } from "../lib/platform.js";
import { listFiles, safeStats, readJsonl, extractProjectDescription } from "../lib/fs-utils.js";

// OpenAI Codex CLI stores sessions in:
// ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl  (nested by date!)
// ~/.codex/archived_sessions/rollout-*.jsonl
// Same path on all platforms
//
// JSONL format (verified locally):
// {"timestamp":"...","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"..."}]}}
// {"timestamp":"...","type":"response_item","payload":{"type":"message","role":"developer","content":[{"type":"input_text","text":"..."}]}}

interface CodexLine {
  timestamp?: string;
  type?: string;
  payload?: {
    type?: string;
    role?: string;
    content?: Array<{ type?: string; text?: string }>;
    cwd?: string;
  };
}

export const codexScanner: Scanner = {
  name: "Codex (OpenAI CLI)",
  sourceType: "codex",
  description: "OpenAI Codex CLI sessions (~/.codex/)",

  getSessionDirs(): string[] {
    const home = getHome();
    const candidates = [
      path.join(home, ".codex", "sessions"),
      path.join(home, ".codex", "archived_sessions"),
    ];
    return candidates.filter((d) => {
      try { return fs.existsSync(d); } catch { return false; }
    });
  },

  scan(limit: number): Session[] {
    const sessions: Session[] = [];
    const dirs = this.getSessionDirs();

    for (const dir of dirs) {
      // Recursive scan — sessions are in nested YYYY/MM/DD/ subdirectories
      const files = listFiles(dir, [".jsonl"], true);
      for (const filePath of files) {
        const stats = safeStats(filePath);
        if (!stats) continue;

        const lines = readJsonl<CodexLine>(filePath);
        if (lines.length < 3) continue;

        const messageTurns = extractCodexTurns(lines);
        const humanMsgs = messageTurns.filter((t) => t.role === "human");
        const aiMsgs = messageTurns.filter((t) => t.role === "assistant");

        // Extract project path (cwd) from session metadata
        const startLine = lines.find((l) => l.payload?.cwd);
        const projectPath = startLine?.payload?.cwd || null;
        const project = projectPath
          ? path.basename(projectPath)
          : path.basename(dir);
        const projectDescription = projectPath
          ? extractProjectDescription(projectPath)
          : null;

        const preview = humanMsgs[0]?.content.slice(0, 200) || "(codex session)";

        sessions.push({
          id: path.basename(filePath, ".jsonl"),
          source: "codex",
          project,
          projectPath: projectPath || undefined,
          projectDescription: projectDescription || undefined,
          title: preview.slice(0, 80) || "Codex session",
          messageCount: messageTurns.length,
          humanMessages: humanMsgs.length,
          aiMessages: aiMsgs.length,
          preview,
          filePath,
          modifiedAt: stats.mtime,
          sizeBytes: stats.size,
        });
      }
    }

    sessions.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());
    return sessions.slice(0, limit);
  },

  parse(filePath: string, maxTurns?: number): ParsedSession | null {
    const lines = readJsonl<CodexLine>(filePath);
    if (lines.length === 0) return null;
    const stats = safeStats(filePath);

    const allTurns = extractCodexTurns(lines);
    const turns = maxTurns ? allTurns.slice(0, maxTurns) : allTurns;
    if (turns.length === 0) return null;

    const humanMsgs = turns.filter((t) => t.role === "human");
    const aiMsgs = turns.filter((t) => t.role === "assistant");

    const startLine = lines.find((l) => l.payload?.cwd);
    const projectPath = startLine?.payload?.cwd || undefined;
    const project = projectPath
      ? path.basename(projectPath)
      : path.basename(path.dirname(filePath));
    const projectDescription = projectPath
      ? extractProjectDescription(projectPath) || undefined
      : undefined;

    return {
      id: path.basename(filePath, ".jsonl"),
      source: "codex",
      project,
      projectPath,
      projectDescription,
      title: humanMsgs[0]?.content.slice(0, 80) || "Codex session",
      messageCount: turns.length,
      humanMessages: humanMsgs.length,
      aiMessages: aiMsgs.length,
      preview: humanMsgs[0]?.content.slice(0, 200) || "",
      filePath,
      modifiedAt: stats?.mtime || new Date(),
      sizeBytes: stats?.size || 0,
      turns,
    };
  },
};

// Extract conversation turns from Codex JSONL format
function extractCodexTurns(lines: CodexLine[]): ConversationTurn[] {
  const turns: ConversationTurn[] = [];

  for (const line of lines) {
    if (!line.payload) continue;
    const p = line.payload;

    // Only process message-type payloads
    if (p.type !== "message") continue;

    // Extract text from content array
    const textParts = (p.content || [])
      .filter((c) => c.text)
      .map((c) => c.text || "")
      .filter(Boolean);

    const content = textParts.join("\n").trim();
    if (!content) continue;

    // Skip developer/system messages — they are AGENTS.md instructions, not conversation
    if (p.role === "developer" || p.role === "system") continue;

    // Skip system-like user messages (AGENTS.md, environment context, etc.)
    if (p.role === "user" && (
      content.startsWith("# AGENTS.md") ||
      content.startsWith("<environment_context>") ||
      content.startsWith("<permissions") ||
      content.startsWith("<app-context>") ||
      content.startsWith("<collaboration_mode>")
    )) continue;

    const role = p.role === "user" ? "human" : "assistant";
    turns.push({
      role,
      content,
      timestamp: line.timestamp ? new Date(line.timestamp) : undefined,
    });
  }

  return turns;
}
