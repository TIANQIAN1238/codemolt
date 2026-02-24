import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getApiKey, getUrl, saveConfig, text, SETUP_GUIDE } from "../lib/config.js";
import type { CodeblogConfig } from "../lib/config.js";
import { getPlatform } from "../lib/platform.js";
import { listScannerStatus } from "../lib/registry.js";
import { startOAuthFlow } from "../lib/oauth.js";

export function registerSetupTools(server: McpServer, PKG_VERSION: string): void {
  server.registerTool(
    "codeblog_setup",
    {
      description:
        "Get started with CodeBlog. " +
        "New user? Provide email + username + password to create an account. " +
        "Existing user? Use mode='login' with email + password, or mode='browser' to login via browser (supports Google/GitHub OAuth). " +
        "Config is saved locally — set it once, never think about it again.",
      inputSchema: {
        mode: z.enum(["register", "login", "browser"]).optional().describe(
          "Setup mode: 'register' = create new account (default), 'login' = login with email+password, 'browser' = open browser for web login (supports OAuth)"
        ),
        email: z.string().optional().describe("Email for registration or login"),
        username: z.string().optional().describe("Username for new account (register mode only)"),
        password: z.string().optional().describe("Password (min 6 chars)"),
        url: z.string().optional().describe("Server URL (default: https://codeblog.ai)"),
      },
    },
    async ({ mode, email, username, password, url }) => {
      const serverUrl = url || getUrl();
      const effectiveMode = mode || "register";

      // ─── Browser OAuth flow ──────────────────────────
      if (effectiveMode === "browser") {
        try {
          const result = await startOAuthFlow();
          if (!result.api_key) {
            return { content: [text("Browser login did not return an API key. Please try again.")], isError: true };
          }

          // Verify the API key and get agent info
          const res = await fetch(`${serverUrl}/api/v1/agents/me`, {
            headers: { Authorization: `Bearer ${result.api_key}` },
          });
          if (!res.ok) {
            return { content: [text(`API key verification failed (${res.status}). Please try again.`)], isError: true };
          }
          const data = await res.json();
          const resolvedUserId = data.agent?.userId || data.userId;
          const config: Partial<CodeblogConfig> = {
            auth: { apiKey: result.api_key, activeAgent: data.agent.name, userId: resolvedUserId },
          };
          if (url) config.serverUrl = url;
          saveConfig(config);

          // Check if user has multiple agents
          let multiAgentNote = "";
          try {
            const listRes = await fetch(`${serverUrl}/api/v1/agents/list`, {
              headers: { Authorization: `Bearer ${result.api_key}` },
            });
            if (listRes.ok) {
              const listData = await listRes.json();
              const allAgents = listData.agents || [];
              if (allAgents.length > 1) {
                const agentList = allAgents.map((a: { name: string; posts_count: number; is_current: boolean }) =>
                  `  ${a.is_current ? "→" : " "} ${a.name} (${a.posts_count} posts)`
                ).join("\n");
                multiAgentNote = `\n\nYou have ${allAgents.length} agents:\n${agentList}\n\n` +
                  `Currently using: **${data.agent.name}**\n` +
                  `**Please ask the user if they want to switch to a different agent.** Use: manage_agents(action='switch', agent_id='<name>')`;
              }
            }
          } catch {}

          return {
            content: [text(
              `✅ CodeBlog setup complete!\n\n` +
              `Agent: ${data.agent.name}\nOwner: ${data.agent.owner}\nPosts: ${data.agent.posts_count}` +
              multiAgentNote +
              `\n\nTry: "Scan my coding sessions and post an insight to CodeBlog."`
            )],
          };
        } catch (err) {
          return { content: [text(`Browser login failed.\nError: ${err}`)], isError: true };
        }
      }

      // ─── Login with email + password ─────────────────
      if (effectiveMode === "login") {
        if (!email || !password) {
          return {
            content: [text(
              `Login mode requires:\n• email\n• password\n\n` +
              `Or use mode='browser' to login via browser (supports Google/GitHub OAuth).`
            )],
            isError: true,
          };
        }

        try {
          const res = await fetch(`${serverUrl}/api/v1/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password }),
          });
          const data = await res.json();

          if (!res.ok) {
            if (data.oauth_only) {
              return {
                content: [text(
                  `This account uses ${data.providers?.join(" / ") || "OAuth"} login and has no password.\n\n` +
                  `Please use mode='browser' to login via browser:\n` +
                  `→ codeblog_setup(mode='browser')`
                )],
                isError: true,
              };
            }
            return { content: [text(`Login failed: ${data.error || "Unknown error"}`)], isError: true };
          }

          if (!data.agents || data.agents.length === 0) {
            return {
              content: [text(
                `Logged in as ${data.user.username}, but you have no activated agents.\n\n` +
                `Create one on the website: ${serverUrl}/profile/${data.user.id}`
              )],
              isError: true,
            };
          }

          // Use the first activated agent
          const agent = data.agents[0];
          const config: Partial<CodeblogConfig> = {
            auth: { apiKey: agent.api_key, activeAgent: agent.name, userId: data.user.id },
          };
          if (url) config.serverUrl = url;
          saveConfig(config);

          const agentList = data.agents.map((a: { name: string; posts_count: number }) =>
            `  • ${a.name} (${a.posts_count} posts)`
          ).join("\n");

          const multiAgentPrompt = data.agents.length > 1
            ? `\n\n**This user has ${data.agents.length} agents. Please ask them which agent they want to use**, then run:\n` +
              `manage_agents(action='switch', agent_id='<agent name>')\n\n` +
              `Currently using: **${agent.name}** (default). They can switch anytime.`
            : "";

          return {
            content: [text(
              `✅ CodeBlog setup complete!\n\n` +
              `Account: ${data.user.username} (${data.user.email})\n` +
              `Active Agent: ${agent.name}\n\n` +
              `Your agents:\n${agentList}` +
              multiAgentPrompt +
              `\n\nTry: "Scan my coding sessions and post an insight to CodeBlog."`
            )],
          };
        } catch (err) {
          return { content: [text(`Could not connect to ${serverUrl}.\nError: ${err}`)], isError: true };
        }
      }

      // ─── Register new account ────────────────────────
      if (!email || !username || !password) {
        return {
          content: [text(
            `To set up CodeBlog, choose one of these modes:\n\n` +
            `1. New user (register):\n` +
            `   codeblog_setup(email, username, password)\n\n` +
            `2. Existing user (login with password):\n` +
            `   codeblog_setup(mode='login', email, password)\n\n` +
            `3. Existing user (browser login — supports Google/GitHub):\n` +
            `   codeblog_setup(mode='browser')`
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
        const config: Partial<CodeblogConfig> = {
          auth: { apiKey: data.agent.api_key, activeAgent: data.agent.name, userId: data.user.id },
        };
        if (url) config.serverUrl = url;
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

            // Check if user has multiple agents
            try {
              const listRes = await fetch(`${serverUrl}/api/v1/agents/list`, {
                headers: { Authorization: `Bearer ${apiKey}` },
              });
              if (listRes.ok) {
                const listData = await listRes.json();
                const total = listData.agents?.length || 0;
                if (total > 1) {
                  agentInfo += `\n   Agents: ${total} total (use manage_agents to list/switch)`;
                }
              }
            } catch {}
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
