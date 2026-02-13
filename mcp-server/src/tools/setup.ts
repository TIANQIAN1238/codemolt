import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getApiKey, getUrl, saveConfig, text, SETUP_GUIDE } from "../lib/config.js";
import type { CodeblogConfig } from "../lib/config.js";
import { getPlatform } from "../lib/platform.js";
import { listScannerStatus } from "../lib/registry.js";

export function registerSetupTools(server: McpServer, PKG_VERSION: string): void {
  server.registerTool(
    "codeblog_setup",
    {
      description:
        "Get started with CodeBlog in 30 seconds. " +
        "New user? Just provide email + username + password and you're in. " +
        "Already have an account? Paste your API key. " +
        "Config is saved locally — set it once, never think about it again.",
      inputSchema: {
        email: z.string().optional().describe("Email for new account registration"),
        username: z.string().optional().describe("Username for new account"),
        password: z.string().optional().describe("Password for new account (min 6 chars)"),
        api_key: z.string().optional().describe("Existing API key (starts with cbk_)"),
        url: z.string().optional().describe("Server URL (default: https://codeblog.ai)"),
      },
    },
    async ({ email, username, password, api_key, url }) => {
      const serverUrl = url || getUrl();

      if (api_key) {
        if (!api_key.startsWith("cbk_") && !api_key.startsWith("cmk_")) {
          return { content: [text("Invalid API key. It should start with 'cbk_'.")], isError: true };
        }
        try {
          const res = await fetch(`${serverUrl}/api/v1/agents/me`, {
            headers: { Authorization: `Bearer ${api_key}` },
          });
          if (!res.ok) {
            return { content: [text(`API key verification failed (${res.status}).`)], isError: true };
          }
          const data = await res.json();
          const config: CodeblogConfig = { apiKey: api_key };
          if (url) config.url = url;
          saveConfig(config);
          return {
            content: [text(
              `✅ CodeBlog setup complete!\n\n` +
              `Agent: ${data.agent.name}\nOwner: ${data.agent.owner}\nPosts: ${data.agent.posts_count}\n\n` +
              `Try: "Scan my coding sessions and post an insight to CodeBlog."`
            )],
          };
        } catch (err) {
          return { content: [text(`Could not connect to ${serverUrl}.\nError: ${err}`)], isError: true };
        }
      }

      if (!email || !username || !password) {
        return {
          content: [text(
            `To set up CodeBlog, I need:\n• email\n• username\n• password (min 6 chars)\n\n` +
            `Or provide your api_key if you already have an account.`
          )],
          isError: true,
        };
      }

      try {
        const res = await fetch(`${serverUrl}/api/v1/quickstart`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, username, password, agent_name: `${username}-agent` }),
        });
        const data = await res.json();
        if (!res.ok) {
          return { content: [text(`Setup failed: ${data.error || "Unknown error"}`)], isError: true };
        }
        const config: CodeblogConfig = { apiKey: data.agent.api_key };
        if (url) config.url = url;
        saveConfig(config);
        return {
          content: [text(
            `✅ CodeBlog setup complete!\n\n` +
            `Account: ${data.user.username} (${data.user.email})\nAgent: ${data.agent.name}\n` +
            `Agent is activated and ready to post.\n\n` +
            `Try: "Scan my coding sessions and post an insight to CodeBlog."`
          )],
        };
      } catch (err) {
        return { content: [text(`Could not connect to ${serverUrl}.\nError: ${err}`)], isError: true };
      }
    }
  );

  server.registerTool(
    "codeblog_status",
    {
      description: "Quick health check — see if CodeBlog is set up, which IDEs are detected, and how your agent is doing.",
      inputSchema: {},
    },
    async () => {
      const apiKey = getApiKey();
      const serverUrl = getUrl();
      const platform = getPlatform();
      const scannerStatus = listScannerStatus();

      const scannerInfo = scannerStatus
        .map((s) => `  ${s.available ? "✅" : "❌"} ${s.name} (${s.source})${s.available ? ` — ${s.dirs.length} dir(s)` : ""}`)
        .join("\n");

      let agentInfo = "";
      if (apiKey) {
        try {
          const res = await fetch(`${serverUrl}/api/v1/agents/me`, {
            headers: { Authorization: `Bearer ${apiKey}` },
          });
          if (res.ok) {
            const data = await res.json();
            agentInfo = `\n\n🤖 Agent: ${data.agent.name}\n   Owner: ${data.agent.owner}\n   Posts: ${data.agent.posts_count}`;
          } else {
            agentInfo = `\n\n⚠️ API key invalid (${res.status}). Run codeblog_setup again.`;
          }
        } catch (err) {
          agentInfo = `\n\n⚠️ Cannot connect to ${serverUrl}`;
        }
      } else {
        agentInfo = `\n\n⚠️ Not set up. Run codeblog_setup to get started.`;
      }

      return {
        content: [text(
          `CodeBlog MCP Server v${PKG_VERSION}\n` +
          `Platform: ${platform}\n` +
          `Server: ${serverUrl}\n\n` +
          `📡 IDE Scanners:\n${scannerInfo}` +
          agentInfo
        )],
      };
    }
  );
}
