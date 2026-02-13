import * as path from "path";
import * as fs from "fs";
import type { Scanner, Session, ParsedSession, ConversationTurn } from "../lib/types.js";
import { getHome, getPlatform } from "../lib/platform.js";
import { listFiles, safeReadJson, safeStats } from "../lib/fs-utils.js";

// Zed editor stores AI assistant conversations in:
// macOS:   ~/Library/Application Support/Zed/conversations/
//          ~/.config/zed/conversations/
// Linux:   ~/.config/zed/conversations/
// Windows: %APPDATA%/Zed/conversations/

export const zedScanner: Scanner = {
  name: "Zed",
  sourceType: "zed",
  description: "Zed editor AI assistant conversations",

  getSessionDirs(): string[] {
    const home = getHome();
    const platform = getPlatform();
    const candidates: string[] = [];

    if (platform === "macos") {
      candidates.push(
        path.join(home, "Library", "Application Support", "Zed", "conversations")
      );
    }
    if (platform === "windows") {
      const appData = process.env.APPDATA || path.join(home, "AppData", "Roaming");
      candidates.push(path.join(appData, "Zed", "conversations"));
    }
    candidates.push(path.join(home, ".config", "zed", "conversations"));

    return candidates.filter((d) => {
      try { return fs.existsSync(d); } catch { return false; }
    });
  },

  scan(limit: number): Session[] {
    const sessions: Session[] = [];
    const dirs = this.getSessionDirs();

    for (const dir of dirs) {
      const jsonFiles = listFiles(dir, [".json", ".zed"], true);
      for (const filePath of jsonFiles) {
        const stats = safeStats(filePath);
        if (!stats || stats.size < 100) continue;

        const data = safeReadJson<Record<string, unknown>>(filePath);
        if (!data) continue;

        const turns = extractZedTurns(data);
        if (turns.length < 2) continue;

        const humanMsgs = turns.filter((t) => t.role === "human");
        const preview = humanMsgs[0]?.content.slice(0, 200) || "(zed session)";

        sessions.push({
          id: path.basename(filePath).replace(/\.\w+$/, ""),
          source: "zed",
          project: (data.project as string) || path.basename(path.dirname(filePath)),
          title: (data.title as string) || preview.slice(0, 80),
          messageCount: turns.length,
          humanMessages: humanMsgs.length,
          aiMessages: turns.length - humanMsgs.length,
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
    const data = safeReadJson<Record<string, unknown>>(filePath);
    if (!data) return null;
    const stats = safeStats(filePath);

    const turns = extractZedTurns(data, maxTurns);
    if (turns.length === 0) return null;

    const humanMsgs = turns.filter((t) => t.role === "human");
    const aiMsgs = turns.filter((t) => t.role === "assistant");

    return {
      id: path.basename(filePath).replace(/\.\w+$/, ""),
      source: "zed",
      project: (data.project as string) || path.basename(path.dirname(filePath)),
      title: (data.title as string) || humanMsgs[0]?.content.slice(0, 80) || "Zed session",
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

function extractZedTurns(data: Record<string, unknown>, maxTurns?: number): ConversationTurn[] {
  const turns: ConversationTurn[] = [];

  // Zed format: { messages: [{ role: "user"|"assistant", content: "..." }] }
  const msgArrays = [data.messages, data.conversation, data.entries];
  for (const arr of msgArrays) {
    if (!Array.isArray(arr)) continue;
    for (const msg of arr) {
      if (maxTurns && turns.length >= maxTurns) break;
      if (!msg || typeof msg !== "object") continue;
      const m = msg as Record<string, unknown>;
      const content = (m.content || m.body || m.text) as string | undefined;
      if (typeof content !== "string") continue;
      turns.push({
        role: m.role === "user" || m.role === "human" ? "human" : "assistant",
        content,
      });
    }
    if (turns.length > 0) return turns;
  }

  return turns;
}
