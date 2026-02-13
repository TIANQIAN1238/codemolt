import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as fs from "fs";
import { text } from "../lib/config.js";
import { getPlatform } from "../lib/platform.js";
import { scanAll, parseSession, listScannerStatus } from "../lib/registry.js";
import { analyzeSession } from "../lib/analyzer.js";

export function registerSessionTools(server: McpServer): void {
  server.registerTool(
    "scan_sessions",
    {
      description:
        "Scan ALL local IDE/CLI coding sessions. Supported tools: " +
        "Claude Code, Cursor (transcripts + chat sessions), Codex (OpenAI CLI), " +
        "VS Code Copilot Chat, Aider, Continue.dev, Zed. " +
        "Windsurf (SQLite-based, limited), Warp (cloud-only, no local history). " +
        "Works on macOS, Windows, and Linux. Returns sessions sorted by most recent.",
      inputSchema: {
        limit: z.number().optional().describe("Max sessions to return (default 20)"),
        source: z.string().optional().describe("Filter by source: claude-code, cursor, windsurf, codex, warp, vscode-copilot, aider, continue, zed"),
      },
    },
    async ({ limit, source }) => {
      let sessions = scanAll(limit || 20, source || undefined);

      if (sessions.length === 0) {
        const scannerStatus = listScannerStatus();
        const available = scannerStatus.filter((s) => s.available);
        return {
          content: [text(
            `No sessions found.\n\n` +
            `Available scanners: ${available.map((s) => s.name).join(", ") || "none"}\n` +
            `Checked ${scannerStatus.length} IDE/tool locations on ${getPlatform()}.`
          )],
        };
      }

      const result = sessions.map((s) => ({
        id: s.id,
        source: s.source,
        project: s.project,
        title: s.title,
        messages: s.messageCount,
        human: s.humanMessages,
        ai: s.aiMessages,
        preview: s.preview,
        modified: s.modifiedAt.toISOString(),
        size: `${Math.round(s.sizeBytes / 1024)}KB`,
        path: s.filePath,
      }));

      return { content: [text(JSON.stringify(result, null, 2))] };
    }
  );

  server.registerTool(
    "read_session",
    {
      description:
        "Read the full conversation from a specific IDE session. " +
        "Returns structured conversation turns (human/assistant) instead of raw file content. " +
        "Use the path and source from scan_sessions.",
      inputSchema: {
        path: z.string().describe("Absolute path to the session file"),
        source: z.string().describe("Source type from scan_sessions (e.g. 'claude-code', 'cursor')"),
        max_turns: z.number().optional().describe("Max conversation turns to read (default: all)"),
      },
    },
    async ({ path: filePath, source, max_turns }) => {
      const parsed = parseSession(filePath, source, max_turns);

      if (!parsed) {
        // Fallback: raw file read
        try {
          const content = fs.readFileSync(filePath, "utf-8");
          const lines = content.split("\n").slice(0, max_turns || 200);
          return { content: [text(lines.join("\n"))] };
        } catch (err) {
          return { content: [text(`Error reading file: ${err}`)], isError: true };
        }
      }

      const output = {
        source: parsed.source,
        project: parsed.project,
        title: parsed.title,
        messages: parsed.messageCount,
        turns: parsed.turns.map((t) => ({
          role: t.role,
          content: t.content.slice(0, 3000), // cap per-turn to avoid huge output
          ...(t.timestamp ? { time: t.timestamp.toISOString() } : {}),
        })),
      };

      return { content: [text(JSON.stringify(output, null, 2))] };
    }
  );

  server.registerTool(
    "analyze_session",
    {
      description:
        "Analyze a coding session and extract structured insights: topics, languages, " +
        "code snippets, problems found, solutions applied, and suggested tags. " +
        "Use this after scan_sessions to understand a session before posting.",
      inputSchema: {
        path: z.string().describe("Absolute path to the session file"),
        source: z.string().describe("Source type (e.g. 'claude-code', 'cursor')"),
      },
    },
    async ({ path: filePath, source }) => {
      const parsed = parseSession(filePath, source);
      if (!parsed || parsed.turns.length === 0) {
        return { content: [text("Could not parse this session. Try read_session for raw content.")], isError: true };
      }

      const analysis = analyzeSession(parsed);
      return { content: [text(JSON.stringify(analysis, null, 2))] };
    }
  );
}
