import * as path from "path";
import * as fs from "fs";
import type { Scanner, Session, ParsedSession, ConversationTurn } from "../lib/types.js";
import { getHome, getPlatform } from "../lib/platform.js";
import { listFiles, listDirs, safeReadJson, safeStats } from "../lib/fs-utils.js";

// VS Code Copilot Chat stores conversations in:
// macOS:   ~/Library/Application Support/Code/User/workspaceStorage/<hash>/github.copilot-chat/
// Windows: %APPDATA%/Code/User/workspaceStorage/<hash>/github.copilot-chat/
// Linux:   ~/.config/Code/User/workspaceStorage/<hash>/github.copilot-chat/
//
// Also checks VS Code Insiders and VSCodium paths

export const vscodeCopilotScanner: Scanner = {
  name: "VS Code Copilot Chat",
  sourceType: "vscode-copilot",
  description: "GitHub Copilot Chat sessions in VS Code",

  getSessionDirs(): string[] {
    const home = getHome();
    const platform = getPlatform();
    const candidates: string[] = [];

    const codeVariants = ["Code", "Code - Insiders", "VSCodium"];

    for (const variant of codeVariants) {
      if (platform === "macos") {
        candidates.push(
          path.join(home, "Library", "Application Support", variant, "User", "workspaceStorage")
        );
        candidates.push(
          path.join(home, "Library", "Application Support", variant, "User", "globalStorage", "github.copilot-chat")
        );
      } else if (platform === "windows") {
        const appData = process.env.APPDATA || path.join(home, "AppData", "Roaming");
        candidates.push(path.join(appData, variant, "User", "workspaceStorage"));
        candidates.push(path.join(appData, variant, "User", "globalStorage", "github.copilot-chat"));
      } else {
        candidates.push(path.join(home, ".config", variant, "User", "workspaceStorage"));
        candidates.push(path.join(home, ".config", variant, "User", "globalStorage", "github.copilot-chat"));
      }
    }

    return candidates.filter((d) => {
      try { return fs.existsSync(d); } catch { return false; }
    });
  },

  scan(limit: number): Session[] {
    const sessions: Session[] = [];
    const dirs = this.getSessionDirs();

    for (const baseDir of dirs) {
      // Check globalStorage copilot-chat directory
      if (baseDir.includes("globalStorage")) {
        const jsonFiles = listFiles(baseDir, [".json"]);
        for (const filePath of jsonFiles) {
          const session = tryParseConversationFile(filePath);
          if (session) sessions.push(session);
        }
        continue;
      }

      // Check workspaceStorage — each hash dir may have a copilot-chat subfolder
      const hashDirs = listDirs(baseDir);
      for (const hashDir of hashDirs) {
        const copilotDir = path.join(hashDir, "github.copilot-chat");
        const jsonFiles = listFiles(copilotDir, [".json"]);
        for (const filePath of jsonFiles) {
          const session = tryParseConversationFile(filePath);
          if (session) sessions.push(session);
        }
      }
    }

    sessions.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());
    return sessions.slice(0, limit);
  },

  parse(filePath: string, maxTurns?: number): ParsedSession | null {
    const data = safeReadJson<Record<string, unknown>>(filePath);
    if (!data) return null;
    const stats = safeStats(filePath);

    const turns = extractCopilotTurns(data, maxTurns);
    if (turns.length === 0) return null;

    const humanMsgs = turns.filter((t) => t.role === "human");
    const aiMsgs = turns.filter((t) => t.role === "assistant");

    return {
      id: path.basename(filePath, ".json"),
      source: "vscode-copilot",
      project: path.basename(path.dirname(filePath)),
      title: humanMsgs[0]?.content.slice(0, 80) || "Copilot Chat session",
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

function tryParseConversationFile(filePath: string): Session | null {
  const stats = safeStats(filePath);
  if (!stats || stats.size < 100) return null;

  const data = safeReadJson<Record<string, unknown>>(filePath);
  if (!data) return null;

  const turns = extractCopilotTurns(data);
  if (turns.length < 2) return null;

  const humanMsgs = turns.filter((t) => t.role === "human");
  const preview = humanMsgs[0]?.content.slice(0, 200) || "(copilot session)";

  return {
    id: path.basename(filePath, ".json"),
    source: "vscode-copilot",
    project: path.basename(path.dirname(filePath)),
    title: preview.slice(0, 80),
    messageCount: turns.length,
    humanMessages: humanMsgs.length,
    aiMessages: turns.length - humanMsgs.length,
    preview,
    filePath,
    modifiedAt: stats.mtime,
    sizeBytes: stats.size,
  };
}

function extractCopilotTurns(data: Record<string, unknown>, maxTurns?: number): ConversationTurn[] {
  const turns: ConversationTurn[] = [];

  // Copilot Chat format: { conversations: [{ turns: [{ request: ..., response: ... }] }] }
  if (Array.isArray(data.conversations)) {
    for (const conv of data.conversations) {
      if (!conv || typeof conv !== "object") continue;
      const c = conv as Record<string, unknown>;
      if (!Array.isArray(c.turns)) continue;
      for (const turn of c.turns) {
        if (maxTurns && turns.length >= maxTurns) break;
        const t = turn as Record<string, unknown>;
        if (t.request && typeof t.request === "string") {
          turns.push({ role: "human", content: t.request });
        }
        if (t.response && typeof t.response === "string") {
          turns.push({ role: "assistant", content: t.response });
        }
        // Alternative format
        if (t.message && typeof t.message === "string") {
          turns.push({
            role: t.role === "user" ? "human" : "assistant",
            content: t.message,
          });
        }
      }
    }
    return turns;
  }

  // Flat messages format
  const msgArrays = [data.messages, data.history, data.entries];
  for (const arr of msgArrays) {
    if (!Array.isArray(arr)) continue;
    for (const msg of arr) {
      if (maxTurns && turns.length >= maxTurns) break;
      if (!msg || typeof msg !== "object") continue;
      const m = msg as Record<string, unknown>;
      const content = (m.content || m.text || m.message) as string | undefined;
      if (typeof content !== "string") continue;
      turns.push({
        role: m.role === "user" ? "human" : "assistant",
        content,
      });
    }
    if (turns.length > 0) return turns;
  }

  return turns;
}
