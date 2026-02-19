import * as path from "path";
import * as fs from "fs";
import type { Scanner, Session, ParsedSession, ConversationTurn } from "../lib/types.js";
import { getHome, getPlatform } from "../lib/platform.js";
import { listDirs, safeReadJson, safeStats, extractProjectDescription } from "../lib/fs-utils.js";

// Lazy-loaded SQLite module (better-sqlite3 or bun:sqlite)
let BetterSqlite3: any = null;
let sqliteLoadAttempted = false;

function getSqlite(): any {
  if (sqliteLoadAttempted) return BetterSqlite3;
  sqliteLoadAttempted = true;
  try {
    BetterSqlite3 = require("better-sqlite3");
  } catch {
    BetterSqlite3 = null;
  }
  return BetterSqlite3;
}

// Windsurf (Codeium) Cascade chat history:
// - Conversations are stored in state.vscdb (SQLite, key-value ItemTable)
//   under ~/Library/Application Support/Windsurf/User/workspaceStorage/<hash>/state.vscdb
// - Key: "chat.ChatSessionStore.index" → JSON with chat session data
// - Each workspace has a workspace.json with the project folder URI
// - Verified on macOS: _chat.json files are i18n translations, NOT conversations

interface VscdbChatIndex {
  version: number;
  entries: Record<string, VscdbChatEntry>;
}

interface VscdbChatEntry {
  messages?: Array<{
    role?: string;
    content?: string;
    text?: string;
  }>;
  [key: string]: unknown;
}

export const windsurfScanner: Scanner = {
  name: "Windsurf",
  sourceType: "windsurf",
  description: "Windsurf (Codeium) Cascade chat sessions (SQLite)",

  getSessionDirs(): string[] {
    const home = getHome();
    const platform = getPlatform();
    const candidates: string[] = [];

    if (platform === "macos") {
      candidates.push(
        path.join(home, "Library", "Application Support", "Windsurf", "User", "workspaceStorage")
      );
    } else if (platform === "windows") {
      const appData = process.env.APPDATA || path.join(home, "AppData", "Roaming");
      candidates.push(path.join(appData, "Windsurf", "User", "workspaceStorage"));
    } else {
      candidates.push(path.join(home, ".config", "Windsurf", "User", "workspaceStorage"));
    }

    return candidates.filter((d) => {
      try { return fs.existsSync(d); } catch { return false; }
    });
  },

  scan(limit: number): Session[] {
    const sessions: Session[] = [];
    const dirs = this.getSessionDirs();

    for (const baseDir of dirs) {
      const workspaceDirs = listDirs(baseDir);

      for (const wsDir of workspaceDirs) {
        const dbPath = path.join(wsDir, "state.vscdb");
        if (!fs.existsSync(dbPath)) continue;

        // Read workspace.json to get project path
        const wsJson = safeReadJson<{ folder?: string; workspace?: string }>(
          path.join(wsDir, "workspace.json")
        );
        let projectPath: string | undefined;
        if (wsJson?.folder) {
          try {
            projectPath = decodeURIComponent(new URL(wsJson.folder).pathname);
          } catch { /* ignore */ }
        }
        const project = projectPath ? path.basename(projectPath) : path.basename(wsDir);
        const projectDescription = projectPath
          ? extractProjectDescription(projectPath) || undefined
          : undefined;

        // Read chat sessions from SQLite
        const chatData = readVscdbChatSessions(dbPath);
        if (!chatData || Object.keys(chatData.entries).length === 0) continue;

        for (const [sessionId, entry] of Object.entries(chatData.entries)) {
          const messages = extractVscdbMessages(entry);
          if (messages.length < 2) continue;

          const humanMsgs = messages.filter((m) => m.role === "human");
          const preview = humanMsgs[0]?.content.slice(0, 200) || "(windsurf session)";
          const dbStats = safeStats(dbPath);

          sessions.push({
            id: sessionId,
            source: "windsurf",
            project,
            projectPath,
            projectDescription,
            title: preview.slice(0, 80),
            messageCount: messages.length,
            humanMessages: humanMsgs.length,
            aiMessages: messages.length - humanMsgs.length,
            preview,
            filePath: `${dbPath}|${sessionId}`, // encode session ID for parse()
            modifiedAt: dbStats?.mtime || new Date(),
            sizeBytes: dbStats?.size || 0,
          });
        }
      }
    }

    sessions.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());
    return sessions.slice(0, limit);
  },

  parse(filePath: string, maxTurns?: number): ParsedSession | null {
    // filePath may contain an encoded session ID: "<dbPath>|<sessionId>"
    const sepIdx = filePath.lastIndexOf("|");
    const dbPath = sepIdx > 0 ? filePath.slice(0, sepIdx) : filePath;
    const targetSessionId = sepIdx > 0 ? filePath.slice(sepIdx + 1) : null;

    const chatData = readVscdbChatSessions(dbPath);
    if (!chatData) return null;
    const stats = safeStats(dbPath);

    const entries = Object.entries(chatData.entries);
    if (entries.length === 0) return null;

    // Look up the specific session entry by ID, or fall back to first with messages
    let targetEntry: VscdbChatEntry | null = null;
    let targetId = path.basename(path.dirname(dbPath));
    if (targetSessionId && chatData.entries[targetSessionId]) {
      targetEntry = chatData.entries[targetSessionId];
      targetId = targetSessionId;
    } else {
      for (const [id, entry] of entries) {
        const msgs = extractVscdbMessages(entry);
        if (msgs.length >= 2) {
          targetEntry = entry;
          targetId = id;
          break;
        }
      }
    }

    if (!targetEntry) return null;
    const allTurns = extractVscdbMessages(targetEntry);
    const turns = maxTurns ? allTurns.slice(0, maxTurns) : allTurns;
    if (turns.length === 0) return null;

    const humanMsgs = turns.filter((t) => t.role === "human");
    const aiMsgs = turns.filter((t) => t.role === "assistant");

    return {
      id: targetId,
      source: "windsurf",
      project: path.basename(path.dirname(filePath)),
      title: humanMsgs[0]?.content.slice(0, 80) || "Windsurf session",
      messageCount: turns.length,
      humanMessages: humanMsgs.length,
      aiMessages: aiMsgs.length,
      preview: humanMsgs[0]?.content.slice(0, 200) || "",
      filePath: dbPath,
      modifiedAt: stats?.mtime || new Date(),
      sizeBytes: stats?.size || 0,
      turns,
    };
  },
};

function readVscdbChatSessions(dbPath: string): VscdbChatIndex | null {
  const Sqlite = getSqlite();
  if (!Sqlite) return null;
  try {
    const db = new Sqlite(dbPath, { readonly: true, fileMustExist: true });
    let row: { value: string | Buffer } | undefined;
    try {
      row = db.prepare(
        "SELECT value FROM ItemTable WHERE key = 'chat.ChatSessionStore.index'"
      ).get() as { value: string | Buffer } | undefined;
    } finally {
      db.close();
    }

    if (!row?.value) return null;
    const valueStr = typeof row.value === "string"
      ? row.value
      : row.value.toString("utf-8");
    return JSON.parse(valueStr) as VscdbChatIndex;
  } catch {
    return null;
  }
}

function extractVscdbMessages(entry: VscdbChatEntry): ConversationTurn[] {
  const turns: ConversationTurn[] = [];

  if (Array.isArray(entry.messages)) {
    for (const msg of entry.messages) {
      if (!msg || typeof msg !== "object") continue;
      const content = msg.content || msg.text;
      if (typeof content !== "string" || !content.trim()) continue;
      turns.push({
        role: msg.role === "user" || msg.role === "human" ? "human" : "assistant",
        content,
      });
    }
    return turns;
  }

  // Try other common keys
  for (const [key, value] of Object.entries(entry)) {
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      if (!item || typeof item !== "object") continue;
      const m = item as Record<string, unknown>;
      const content = (m.content || m.text) as string | undefined;
      if (typeof content !== "string" || !content.trim()) continue;
      turns.push({
        role: m.role === "user" || m.role === "human" ? "human" : "assistant",
        content,
      });
    }
    if (turns.length > 0) return turns;
  }

  return turns;
}
