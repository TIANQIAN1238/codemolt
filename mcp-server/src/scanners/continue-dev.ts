import * as path from "path";
import * as fs from "fs";
import type { Scanner, Session, ParsedSession, ConversationTurn } from "../lib/types.js";
import { getHome, getPlatform } from "../lib/platform.js";
import { listFiles, safeReadJson, safeStats } from "../lib/fs-utils.js";

// Continue.dev stores sessions in:
// ~/.continue/sessions/*.json
// macOS:   ~/Library/Application Support/Continue/sessions/
// Windows: %APPDATA%/Continue/sessions/
// Linux:   ~/.config/continue/sessions/

export const continueDevScanner: Scanner = {
  name: "Continue.dev",
  sourceType: "continue",
  description: "Continue.dev AI coding assistant sessions",

  getSessionDirs(): string[] {
    const home = getHome();
    const platform = getPlatform();
    const candidates: string[] = [];

    candidates.push(path.join(home, ".continue", "sessions"));

    if (platform === "macos") {
      candidates.push(
        path.join(home, "Library", "Application Support", "Continue", "sessions")
      );
    } else if (platform === "windows") {
      const appData = process.env.APPDATA || path.join(home, "AppData", "Roaming");
      candidates.push(path.join(appData, "Continue", "sessions"));
    } else {
      candidates.push(path.join(home, ".config", "continue", "sessions"));
    }

    return candidates.filter((d) => {
      try { return fs.existsSync(d); } catch { return false; }
    });
  },

  scan(limit: number): Session[] {
    const sessions: Session[] = [];
    const dirs = this.getSessionDirs();

    for (const dir of dirs) {
      const jsonFiles = listFiles(dir, [".json"]);
      for (const filePath of jsonFiles) {
        const stats = safeStats(filePath);
        if (!stats || stats.size < 100) continue;

        const data = safeReadJson<Record<string, unknown>>(filePath);
        if (!data) continue;

        const turns = extractContinueTurns(data);
        if (turns.length < 2) continue;

        const humanMsgs = turns.filter((t) => t.role === "human");
        const preview = humanMsgs[0]?.content.slice(0, 200) || "(continue session)";

        sessions.push({
          id: path.basename(filePath, ".json"),
          source: "continue",
          project: (data.workspacePath as string) || path.basename(path.dirname(filePath)),
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

    const turns = extractContinueTurns(data, maxTurns);
    if (turns.length === 0) return null;

    const humanMsgs = turns.filter((t) => t.role === "human");
    const aiMsgs = turns.filter((t) => t.role === "assistant");

    return {
      id: path.basename(filePath, ".json"),
      source: "continue",
      project: (data.workspacePath as string) || path.basename(path.dirname(filePath)),
      title: (data.title as string) || humanMsgs[0]?.content.slice(0, 80) || "Continue session",
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

function extractContinueTurns(data: Record<string, unknown>, maxTurns?: number): ConversationTurn[] {
  const turns: ConversationTurn[] = [];

  // Continue format: { history: [{ role: "user"|"assistant", content: "..." }] }
  const msgArrays = [data.history, data.messages, data.steps];
  for (const arr of msgArrays) {
    if (!Array.isArray(arr)) continue;
    for (const msg of arr) {
      if (maxTurns && turns.length >= maxTurns) break;
      if (!msg || typeof msg !== "object") continue;
      const m = msg as Record<string, unknown>;

      // Steps format: { name: "UserInput", description: "..." }
      if (m.name === "UserInput" && typeof m.description === "string") {
        turns.push({ role: "human", content: m.description });
        continue;
      }
      if (m.name === "DefaultModelEditCodeStep" || m.name === "ChatModelResponse") {
        if (typeof m.description === "string") {
          turns.push({ role: "assistant", content: m.description });
        }
        continue;
      }

      // Standard message format
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
