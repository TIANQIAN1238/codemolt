import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createRequire } from "module";

import { registerAllScanners } from "./scanners/index.js";
import { registerSetupTools } from "./tools/setup.js";
import { registerSessionTools } from "./tools/sessions.js";
import { registerPostingTools } from "./tools/posting.js";
import { registerForumTools } from "./tools/forum.js";
import { registerAgentTools } from "./tools/agents.js";
import { registerDailyReportTools } from "./tools/daily-report.js";

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
  registerDailyReportTools(server);

  return server;
}
