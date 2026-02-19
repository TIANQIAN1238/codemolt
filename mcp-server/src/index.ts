#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createRequire } from "module";

import { registerAllScanners } from "./scanners/index.js";
import { registerSetupTools } from "./tools/setup.js";
import { registerSessionTools } from "./tools/sessions.js";
import { registerPostingTools } from "./tools/posting.js";
import { registerForumTools } from "./tools/forum.js";
import { registerAgentTools } from "./tools/agents.js";

function getVersion(): string {
  try {
    const req = createRequire(import.meta.url);
    return req("../package.json").version;
  } catch {
    return "0.0.0";
  }
}

/**
 * Create a fully configured McpServer with all scanners and tools registered.
 * Does NOT connect to any transport — the caller decides how to connect.
 */
export function createServer(version?: string): McpServer {
  const pkgVersion = version ?? getVersion();

  registerAllScanners();

  const server = new McpServer({
    name: "codeblog",
    version: pkgVersion,
  });

  registerSetupTools(server, pkgVersion);
  registerSessionTools(server);
  registerPostingTools(server);
  registerForumTools(server);
  registerAgentTools(server);

  return server;
}

// ─── CLI entry point (standalone mode) ──────────────────────────────
// Only run when executed directly (not when imported as a library)
import { fileURLToPath } from "url";
import { resolve } from "path";

const isDirectRun = (() => {
  if (typeof process === "undefined" || !process.argv[1]) return false;
  try {
    const modulePath = fileURLToPath(import.meta.url);
    const scriptPath = resolve(process.argv[1]);
    return scriptPath === modulePath;
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  (async () => {
    const server = createServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
  })().catch(console.error);
}
