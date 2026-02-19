import * as path from "path";
import * as fs from "fs";
import type { Scanner, Session, ParsedSession, ConversationTurn } from "../lib/types.js";
import { getHome, getPlatform } from "../lib/platform.js";
import { listFiles, listDirs, safeReadFile, safeReadJson, safeStats, extractProjectDescription, decodeDirNameToPath } from "../lib/fs-utils.js";

// Lazy-loaded SQLite module (better-sqlite3 or bun:sqlite)
let BetterSqlite3: any = null;
let sqliteLoadAttempted = false;

function getSqlite(): any {
  if (sqliteLoadAttempted) return BetterSqlite3;
  sqliteLoadAttempted = true;
  try {
    BetterSqlite3 = require("better-sqlite3");
  } catch {
    try {
      // Fallback for Bun runtime
      BetterSqlite3 = null;
    } catch { /* */ }
  }
  return BetterSqlite3;
}

// Cursor stores conversations in THREE places (all supported for version compatibility):
//
// FORMAT 1 — Agent transcripts (plain text, XML-like tags):
//   ~/.cursor/projects/<project>/agent-transcripts/*.txt
//   Format: user: <user_query>...</user_query> \n A: <response>
//
// FORMAT 2 — Chat sessions (JSON, older Cursor versions):
//   ~/Library/Application Support/Cursor/User/workspaceStorage/<hash>/chatSessions/*.json
//   Format: { requests: [{ message: "...", response: [...] }], sessionId, creationDate }
//
// FORMAT 3 — Global SQLite (newer Cursor versions, 2025+):
//   ~/Library/Application Support/Cursor/User/globalStorage/state.vscdb
//   Table: cursorDiskKV
//   Keys:  composerData:<composerId> — session metadata (name, timestamps, bubble headers)
//          bubbleId:<composerId>:<bubbleId> — individual message content (type 1=user, 2=ai)

// Run a callback with a shared DB connection, safely closing on completion
function withDb<T>(dbPath: string, fn: (db: any) => T, fallback: T): T {
  const Sqlite = getSqlite();
  if (!Sqlite) return fallback;
  try {
    const db = new Sqlite(dbPath, { readonly: true, fileMustExist: true });
    try {
      return fn(db);
    } finally {
      db.close();
    }
  } catch (err) {
    console.error(`[codeblog] Cursor DB error:`, err instanceof Error ? err.message : err);
    return fallback;
  }
}

// Safe parameterized query helper
function safeQueryDb<T>(db: any, sql: string, params: unknown[] = []): T[] {
  try {
    return db.prepare(sql).all(...params) as T[];
  } catch (err) {
    console.error(`[codeblog] Cursor query error:`, err instanceof Error ? err.message : err);
    return [];
  }
}

// Parse vscdb virtual path: "vscdb:<dbPath>|<composerId>"
// Uses '|' as separator to avoid conflicts with ':' in Windows paths (C:\...)
const VSCDB_SEP = "|";
function makeVscdbPath(dbPath: string, composerId: string): string {
  return `vscdb:${dbPath}${VSCDB_SEP}${composerId}`;
}
function parseVscdbVirtualPath(virtualPath: string): { dbPath: string; composerId: string } | null {
  const prefix = "vscdb:";
  if (!virtualPath.startsWith(prefix)) return null;
  const rest = virtualPath.slice(prefix.length);
  const sepIdx = rest.lastIndexOf(VSCDB_SEP);
  if (sepIdx <= 0) return null;
  return { dbPath: rest.slice(0, sepIdx), composerId: rest.slice(sepIdx + 1) };
}

function getGlobalStoragePath(): string | null {
  const home = getHome();
  const platform = getPlatform();
  let p: string;
  if (platform === "macos") {
    p = path.join(home, "Library", "Application Support", "Cursor", "User", "globalStorage", "state.vscdb");
  } else if (platform === "windows") {
    const appData = process.env.APPDATA || path.join(home, "AppData", "Roaming");
    p = path.join(appData, "Cursor", "User", "globalStorage", "state.vscdb");
  } else {
    p = path.join(home, ".config", "Cursor", "User", "globalStorage", "state.vscdb");
  }
  try { return fs.existsSync(p) ? p : null; } catch { return null; }
}

export const cursorScanner: Scanner = {
  name: "Cursor",
  sourceType: "cursor",
  description: "Cursor AI IDE sessions (agent transcripts + chat sessions + composer)",

  getSessionDirs(): string[] {
    const home = getHome();
    const platform = getPlatform();
    const candidates: string[] = [];

    // Format 1: Agent transcripts
    candidates.push(path.join(home, ".cursor", "projects"));

    // Format 2 & workspace-level Format 3: workspaceStorage
    if (platform === "macos") {
      candidates.push(
        path.join(home, "Library", "Application Support", "Cursor", "User", "workspaceStorage")
      );
    } else if (platform === "windows") {
      const appData = process.env.APPDATA || path.join(home, "AppData", "Roaming");
      candidates.push(path.join(appData, "Cursor", "User", "workspaceStorage"));
    } else {
      candidates.push(path.join(home, ".config", "Cursor", "User", "workspaceStorage"));
    }

    // Format 3: globalStorage (just check existence for status reporting)
    const globalDb = getGlobalStoragePath();
    if (globalDb) {
      candidates.push(path.dirname(globalDb));
    }

    return candidates.filter((d) => {
      try { return fs.existsSync(d); } catch { return false; }
    });
  },

  scan(limit: number): Session[] {
    const sessions: Session[] = [];
    const dirs = this.getSessionDirs();
    const seenIds = new Set<string>();

    // --- Collect project metadata from Format 1/2 directories ---
    // We need project info (name, path, description) from workspace dirs,
    // because Format 3 (globalStorage) doesn't store project context.
    const projectInfoById = new Map<string, { project: string; projectPath?: string; projectDescription?: string }>();

    for (const baseDir of dirs) {
      if (baseDir.endsWith("globalStorage")) continue;

      const projectDirs = listDirs(baseDir);
      for (const projectDir of projectDirs) {
        const dirName = path.basename(projectDir);

        let projectPath: string | undefined;
        const workspaceJson = safeReadJson<{ folder?: string }>(path.join(projectDir, "workspace.json"));
        if (workspaceJson?.folder) {
          try { projectPath = decodeURIComponent(new URL(workspaceJson.folder).pathname); } catch { /* */ }
        }
        if (!projectPath && dirName.startsWith("Users-")) {
          projectPath = decodeDirNameToPath(dirName) || undefined;
        }

        const project = projectPath ? path.basename(projectPath) : dirName;
        const projectDescription = projectPath ? extractProjectDescription(projectPath) || undefined : undefined;

        // Map transcript IDs to project info
        const transcriptsDir = path.join(projectDir, "agent-transcripts");
        for (const filePath of listFiles(transcriptsDir, [".txt"])) {
          const id = path.basename(filePath, ".txt");
          projectInfoById.set(id, { project, projectPath, projectDescription });
        }
      }
    }

    // --- FORMAT 3: globalStorage state.vscdb (primary, most complete) ---
    // Format 3 has the richest data: full bubble contents including tool calls,
    // thinking blocks, and code suggestions. Always prefer this over Format 1/2.
    const globalDb = getGlobalStoragePath();
    if (globalDb) {
      withDb(globalDb, (db) => {
        const rows = safeQueryDb<{ key: string; value: string }>(
          db, "SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%'"
        );

        for (const row of rows) {
          try {
            const data = JSON.parse(row.value) as CursorComposerData;
            const composerId = data.composerId || row.key.replace("composerData:", "");

            const bubbleHeaders = data.fullConversationHeadersOnly || [];
            if (bubbleHeaders.length === 0) continue;

            const humanCount = bubbleHeaders.filter((b: { type: number }) => b.type === 1).length;
            const aiCount = bubbleHeaders.filter((b: { type: number }) => b.type === 2).length;
            const name = data.name || "";

            // Get first user message as preview
            let preview = name;
            if (!preview) {
              const firstUserBubble = bubbleHeaders.find((b: { type: number }) => b.type === 1);
              if (firstUserBubble) {
                const bubbleRow = safeQueryDb<{ value: string }>(
                  db, "SELECT value FROM cursorDiskKV WHERE key = ?",
                  [`bubbleId:${composerId}:${firstUserBubble.bubbleId}`]
                );
                if (bubbleRow.length > 0) {
                  try {
                    const bubble = JSON.parse(bubbleRow[0].value) as Record<string, unknown>;
                    preview = extractBubbleContent(bubble).slice(0, 200);
                  } catch { /* */ }
                }
              }
            }

            // Enrich with project info from Format 1 directories
            const projInfo = projectInfoById.get(composerId);
            const project = projInfo?.project || "Cursor Composer";
            const projectPath = projInfo?.projectPath;
            const projectDescription = projInfo?.projectDescription;

            const createdAt = data.createdAt ? new Date(data.createdAt) : new Date();
            const updatedAt = data.lastUpdatedAt ? new Date(data.lastUpdatedAt) : createdAt;

            seenIds.add(composerId);
            sessions.push({
              id: composerId,
              source: "cursor",
              project,
              projectPath,
              projectDescription,
              title: (name || preview || "Cursor composer session").slice(0, 80),
              messageCount: humanCount + aiCount,
              humanMessages: humanCount,
              aiMessages: aiCount,
              preview: preview || "(composer session)",
              filePath: makeVscdbPath(globalDb, composerId),
              modifiedAt: updatedAt,
              sizeBytes: row.value.length,
            });
          } catch { /* skip malformed entries */ }
        }
      }, undefined);
    }

    // --- FORMAT 1 & 2: supplement with sessions not found in Format 3 ---
    for (const baseDir of dirs) {
      if (baseDir.endsWith("globalStorage")) continue;

      const projectDirs = listDirs(baseDir);
      for (const projectDir of projectDirs) {
        const dirName = path.basename(projectDir);

        let projectPath: string | undefined;
        const workspaceJson = safeReadJson<{ folder?: string }>(path.join(projectDir, "workspace.json"));
        if (workspaceJson?.folder) {
          try { projectPath = decodeURIComponent(new URL(workspaceJson.folder).pathname); } catch { /* */ }
        }
        if (!projectPath && dirName.startsWith("Users-")) {
          projectPath = decodeDirNameToPath(dirName) || undefined;
        }

        const project = projectPath ? path.basename(projectPath) : dirName;
        const projectDescription = projectPath ? extractProjectDescription(projectPath) || undefined : undefined;

        // --- FORMAT 1: agent-transcripts/*.txt (only if not in Format 3) ---
        const transcriptsDir = path.join(projectDir, "agent-transcripts");
        for (const filePath of listFiles(transcriptsDir, [".txt"])) {
          const id = path.basename(filePath, ".txt");
          if (seenIds.has(id)) continue; // Already have richer Format 3 data

          const stats = safeStats(filePath);
          if (!stats) continue;

          const content = safeReadFile(filePath);
          if (!content || content.length < 100) continue;

          const userQueries = content.match(/<user_query>\n?([\s\S]*?)\n?<\/user_query>/g) || [];
          if (userQueries.length === 0) continue;

          const firstQuery = content.match(/<user_query>\n?([\s\S]*?)\n?<\/user_query>/);
          const preview = firstQuery ? firstQuery[1].trim().slice(0, 200) : content.slice(0, 200);
          seenIds.add(id);

          sessions.push({
            id,
            source: "cursor",
            project,
            projectPath,
            projectDescription,
            title: preview.slice(0, 80) || `Cursor session in ${project}`,
            messageCount: userQueries.length * 2,
            humanMessages: userQueries.length,
            aiMessages: userQueries.length,
            preview,
            filePath,
            modifiedAt: stats.mtime,
            sizeBytes: stats.size,
          });
        }

        // --- FORMAT 2: chatSessions/*.json (only if not in Format 3) ---
        for (const filePath of listFiles(path.join(projectDir, "chatSessions"), [".json"])) {
          const stats = safeStats(filePath);
          if (!stats || stats.size < 100) continue;

          const data = safeReadJson<CursorChatSession>(filePath);
          if (!data || !Array.isArray(data.requests) || data.requests.length === 0) continue;

          const humanCount = data.requests.length;
          const firstMsg = data.requests[0]?.message || "";
          const preview = (typeof firstMsg === "string" ? firstMsg : "").slice(0, 200);
          const id = data.sessionId || path.basename(filePath, ".json");
          if (seenIds.has(id)) continue;
          seenIds.add(id);

          sessions.push({
            id,
            source: "cursor",
            project,
            projectPath,
            projectDescription,
            title: preview.slice(0, 80) || `Cursor chat in ${project}`,
            messageCount: humanCount * 2,
            humanMessages: humanCount,
            aiMessages: humanCount,
            preview: preview || "(cursor chat session)",
            filePath,
            modifiedAt: stats.mtime,
            sizeBytes: stats.size,
          });
        }
      }
    }

    sessions.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());
    return sessions.slice(0, limit);
  },

  parse(filePath: string, maxTurns?: number): ParsedSession | null {
    // FORMAT 3: vscdb virtual path
    if (filePath.startsWith("vscdb:")) {
      return parseVscdbSession(filePath, maxTurns);
    }

    const stats = safeStats(filePath);
    const turns: ConversationTurn[] = [];

    if (filePath.endsWith(".txt")) {
      // FORMAT 1: agent transcript
      const content = safeReadFile(filePath);
      if (!content) return null;

      const blocks = content.split(/^user:\s*$/m);
      for (const block of blocks) {
        if (!block.trim()) continue;
        if (maxTurns && turns.length >= maxTurns) break;

        const queryMatch = block.match(/<user_query>\n?([\s\S]*?)\n?<\/user_query>/);
        if (queryMatch) {
          turns.push({ role: "human", content: queryMatch[1].trim() });
        }

        const afterQuery = block.split(/<\/user_query>/)[1];
        if (afterQuery) {
          const aiContent = afterQuery.replace(/^\s*\n\s*A:\s*\n?/, "").trim();
          if (aiContent && (!maxTurns || turns.length < maxTurns)) {
            turns.push({ role: "assistant", content: aiContent });
          }
        }
      }
    } else {
      // FORMAT 2: chatSessions JSON
      const data = safeReadJson<CursorChatSession>(filePath);
      if (!data || !Array.isArray(data.requests)) return null;

      for (const req of data.requests) {
        if (maxTurns && turns.length >= maxTurns) break;

        if (req.message) {
          turns.push({
            role: "human",
            content: typeof req.message === "string" ? req.message : JSON.stringify(req.message),
          });
        }

        if (maxTurns && turns.length >= maxTurns) break;

        if (req.response) {
          let respText = "";
          if (typeof req.response === "string") {
            respText = req.response;
          } else if (Array.isArray(req.response)) {
            respText = req.response
              .map((r: unknown) => (typeof r === "string" ? r : (r as Record<string, unknown>)?.text || ""))
              .join("");
          }
          if (respText.trim()) {
            turns.push({ role: "assistant", content: respText.trim() });
          }
        }
      }
    }

    if (turns.length === 0) return null;

    const humanMsgs = turns.filter((t) => t.role === "human");
    const aiMsgs = turns.filter((t) => t.role === "assistant");

    return {
      id: path.basename(filePath).replace(/\.\w+$/, ""),
      source: "cursor",
      project: path.basename(path.dirname(filePath)),
      title: humanMsgs[0]?.content.slice(0, 80) || "Cursor session",
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

// Parse a session stored in globalStorage state.vscdb (Format 3)
function parseVscdbSession(virtualPath: string, maxTurns?: number): ParsedSession | null {
  const parsed = parseVscdbVirtualPath(virtualPath);
  if (!parsed) return null;
  const { dbPath, composerId } = parsed;

  return withDb(dbPath, (db) => {
    // Get composer metadata
    const metaRows = safeQueryDb<{ value: string }>(
      db, "SELECT value FROM cursorDiskKV WHERE key = ?",
      [`composerData:${composerId}`]
    );
    if (metaRows.length === 0) return null;

    let composerData: CursorComposerData;
    try { composerData = JSON.parse(metaRows[0].value); } catch { return null; }

    const bubbleHeaders = composerData.fullConversationHeadersOnly || [];
    if (bubbleHeaders.length === 0) return null;

    // Fetch bubble contents — single DB connection reused for all queries
    const turns: ConversationTurn[] = [];
    for (const header of bubbleHeaders) {
      if (maxTurns && turns.length >= maxTurns) break;

      const bubbleRows = safeQueryDb<{ value: string }>(
        db, "SELECT value FROM cursorDiskKV WHERE key = ?",
        [`bubbleId:${composerId}:${header.bubbleId}`]
      );
      if (bubbleRows.length === 0) continue;

      try {
        const bubble = JSON.parse(bubbleRows[0].value) as Record<string, unknown>;
        const content = extractBubbleContent(bubble);
        if (!content) continue; // skip truly empty bubbles

        turns.push({
          role: header.type === 1 ? "human" : "assistant",
          content,
        });
      } catch { /* skip */ }
    }

    if (turns.length === 0) return null;

    const humanMsgs = turns.filter((t) => t.role === "human");
    const aiMsgs = turns.filter((t) => t.role === "assistant");

    return {
      id: composerId,
      source: "cursor",
      project: "Cursor Composer",
      title: composerData.name || humanMsgs[0]?.content.slice(0, 80) || "Cursor session",
      messageCount: turns.length,
      humanMessages: humanMsgs.length,
      aiMessages: aiMsgs.length,
      preview: humanMsgs[0]?.content.slice(0, 200) || "",
      filePath: virtualPath,
      modifiedAt: composerData.lastUpdatedAt ? new Date(composerData.lastUpdatedAt) : new Date(),
      sizeBytes: 0,
      turns,
    } as ParsedSession;
  }, null);
}

// --- Helper: extract text content from a bubble ---
// Cursor stores different bubble types:
//   - Regular text messages: content in `text`, `message`, or `rawText`
//   - Tool calls (capabilityType 15): content in `toolFormerData` (name, params, result)
//   - Thinking blocks: content in `allThinkingBlocks`
function extractBubbleContent(bubble: Record<string, unknown>): string {
  // 1. Direct text content
  const text = (bubble.text as string) || (bubble.message as string) || (bubble.rawText as string) || "";
  if (text) return text;

  // 2. Tool call content (capabilityType 15) — extract tool name, args, and result
  const toolData = bubble.toolFormerData as Record<string, unknown> | undefined;
  if (toolData && typeof toolData === "object") {
    const parts: string[] = [];
    const toolName = (toolData.name as string) || (toolData.tool as string) || "unknown_tool";
    parts.push(`[Tool: ${toolName}]`);

    // Tool arguments/params
    const params = toolData.params || toolData.rawArgs;
    if (params) {
      const paramStr = typeof params === "string" ? params : JSON.stringify(params);
      if (paramStr.length > 0 && paramStr !== "{}") {
        parts.push(`Args: ${paramStr.slice(0, 2000)}`);
      }
    }

    // Tool result
    const result = toolData.result;
    if (result) {
      const resultStr = typeof result === "string" ? result : JSON.stringify(result);
      if (resultStr.length > 0) {
        parts.push(`Result: ${resultStr.slice(0, 3000)}`);
      }
    }

    if (parts.length > 1) return parts.join("\n");
  }

  // 3. Thinking blocks
  const thinkingBlocks = bubble.allThinkingBlocks as Array<{ text?: string; content?: string }> | undefined;
  if (thinkingBlocks && Array.isArray(thinkingBlocks) && thinkingBlocks.length > 0) {
    const thinking = thinkingBlocks
      .map((b) => b.text || b.content || "")
      .filter(Boolean)
      .join("\n");
    if (thinking) return `[Thinking]\n${thinking}`;
  }

  // 4. Code blocks from suggestedCodeBlocks
  const codeBlocks = bubble.suggestedCodeBlocks as Array<{ code?: string; language?: string }> | undefined;
  if (codeBlocks && Array.isArray(codeBlocks) && codeBlocks.length > 0) {
    return codeBlocks
      .map((b) => `\`\`\`${b.language || ""}\n${b.code || ""}\n\`\`\``)
      .join("\n");
  }

  return "";
}

// --- Type definitions ---

// Old chatSessions JSON format
interface CursorChatSession {
  version?: number;
  requests: Array<{
    message: string;
    response?: string | unknown[];
  }>;
  sessionId?: string;
  creationDate?: string;
  lastMessageDate?: string;
}

// New composerData format (globalStorage state.vscdb)
interface CursorComposerData {
  composerId?: string;
  name?: string;
  createdAt?: number;
  lastUpdatedAt?: number;
  fullConversationHeadersOnly?: Array<{
    bubbleId: string;
    type: number; // 1 = user, 2 = AI
  }>;
  text?: string;
  conversationState?: string;
}
