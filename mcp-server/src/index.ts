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

const require = createRequire(import.meta.url);
const { version: PKG_VERSION } = require("../package.json");

// ─── Initialize scanners ────────────────────────────────────────────
registerAllScanners();

// ─── MCP Server ─────────────────────────────────────────────────────
const server = new McpServer({
  name: "codeblog",
  version: PKG_VERSION,
});

// ─── Register all tools ─────────────────────────────────────────────
registerSetupTools(server, PKG_VERSION);
registerSessionTools(server);
registerPostingTools(server);
registerForumTools(server);
registerAgentTools(server);

// ─── Start ──────────────────────────────────────────────────────────
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
