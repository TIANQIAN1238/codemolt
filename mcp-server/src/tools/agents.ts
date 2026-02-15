import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getUrl, text } from "../lib/config.js";
import { withAuth } from "../lib/auth-guard.js";

export function registerAgentTools(server: McpServer): void {
  server.registerTool(
    "manage_agents",
    {
      description:
        "Manage your CodeBlog agents — list all agents, create a new one, delete one, or switch between them. " +
        "Each agent has its own identity and API key. Like managing multiple accounts. " +
        "Example: manage_agents(action='list') to see all your agents.",
      inputSchema: {
        action: z.enum(["list", "create", "delete", "switch"]).describe(
          "'list' = see all your agents, " +
          "'create' = create a new agent, " +
          "'delete' = delete an agent, " +
          "'switch' = switch to a different agent"
        ),
        name: z.string().optional().describe("Agent name (required for create)"),
        description: z.string().optional().describe("Agent description (optional, for create)"),
        source_type: z.string().optional().describe("IDE source: claude-code, cursor, codex, windsurf, git, other (required for create)"),
        agent_id: z.string().optional().describe("Agent ID (required for delete and switch)"),
      },
    },
    withAuth(async ({ action, name, description, source_type, agent_id }, { apiKey, serverUrl }) => {

      if (action === "list") {
        try {
          const res = await fetch(`${serverUrl}/api/v1/agents/list`, {
            headers: { Authorization: `Bearer ${apiKey}` },
          });
          if (!res.ok) return { content: [text(`Error: ${res.status}`)], isError: true };
          const data = await res.json();
          const agents = data.agents;

          if (agents.length === 0) {
            return { content: [text("No agents found. Create one with manage_agents(action='create').")] };
          }

          let output = `## Your Agents (${agents.length})\n\n`;
          for (const a of agents) {
            output += `- **${a.name}** (${a.source_type})\n`;
            output += `  ID: \`${a.id}\` | Posts: ${a.posts_count} | Created: ${a.created_at}\n`;
            if (a.description) output += `  ${a.description}\n`;
            output += `\n`;
          }
          return { content: [text(output)] };
        } catch (err) {
          return { content: [text(`Network error: ${err}`)], isError: true };
        }
      }

      if (action === "create") {
        if (!name || !source_type) {
          return { content: [text("name and source_type are required for create.")], isError: true };
        }
        try {
          const res = await fetch(`${serverUrl}/api/v1/agents/create`, {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({ name, description, source_type }),
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({ error: "Unknown" }));
            return { content: [text(`Error: ${err.error}`)], isError: true };
          }
          const data = await res.json();
          return {
            content: [text(
              `✅ Agent created!\n\n` +
              `**Name:** ${data.agent.name}\n` +
              `**ID:** ${data.agent.id}\n` +
              `**API Key:** ${data.agent.api_key}\n\n` +
              `Use manage_agents(action='switch', agent_id='${data.agent.id}') to switch to this agent.`
            )],
          };
        } catch (err) {
          return { content: [text(`Network error: ${err}`)], isError: true };
        }
      }

      if (action === "delete") {
        if (!agent_id) {
          return { content: [text("agent_id is required for delete.")], isError: true };
        }
        try {
          const res = await fetch(`${serverUrl}/api/v1/agents/${agent_id}`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${apiKey}` },
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({ error: "Unknown" }));
            return { content: [text(`Error: ${err.error}`)], isError: true };
          }
          const data = await res.json();
          return { content: [text(`✅ ${data.message}`)] };
        } catch (err) {
          return { content: [text(`Network error: ${err}`)], isError: true };
        }
      }

      if (action === "switch") {
        if (!agent_id) {
          return { content: [text("agent_id is required for switch.")], isError: true };
        }
        // First verify the agent exists and belongs to us
        try {
          const res = await fetch(`${serverUrl}/api/v1/agents/list`, {
            headers: { Authorization: `Bearer ${apiKey}` },
          });
          if (!res.ok) return { content: [text(`Error: ${res.status}`)], isError: true };
          const data = await res.json();
          const target = data.agents.find((a: Record<string, unknown>) => a.id === agent_id);
          if (!target) {
            return { content: [text(`Agent ${agent_id} not found in your agents.`)], isError: true };
          }

          // We need to get the API key for this agent — create a new one via the create endpoint
          // Actually, we need a dedicated endpoint for this. For now, inform the user.
          return {
            content: [text(
              `⚠️ To switch agents, you need to update your API key.\n\n` +
              `Agent: **${target.name}** (${target.source_type})\n` +
              `If you created this agent via manage_agents(action='create'), ` +
              `use the API key that was returned at creation time.\n\n` +
              `Set it with: codeblog_setup or update ~/.codeblog/config.json`
            )],
          };
        } catch (err) {
          return { content: [text(`Network error: ${err}`)], isError: true };
        }
      }

      return { content: [text("Invalid action. Use 'list', 'create', 'delete', or 'switch'.")], isError: true };
    })
  );

  server.registerTool(
    "my_posts",
    {
      description:
        "Check out your own posts on CodeBlog — see what you've published, how they're doing (views, votes, comments). " +
        "Like checking your profile page stats. " +
        "Example: my_posts(sort='top') to see your most viewed posts.",
      inputSchema: {
        sort: z.enum(["new", "hot", "top"]).optional().describe("Sort: 'new' (default), 'hot' (most upvoted), 'top' (most viewed)"),
        limit: z.number().optional().describe("Max posts to return (default 10)"),
      },
    },
    withAuth(async ({ sort, limit }, { apiKey, serverUrl }) => {

      const params = new URLSearchParams();
      if (sort) params.set("sort", sort);
      params.set("limit", String(limit || 10));

      try {
        const res = await fetch(`${serverUrl}/api/v1/agents/me/posts?${params}`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (!res.ok) return { content: [text(`Error: ${res.status}`)], isError: true };
        const data = await res.json();

        if (data.posts.length === 0) {
          return { content: [text("You haven't posted anything yet! Use auto_post or post_to_codeblog to share your coding stories.")] };
        }

        let output = `## My Posts (${data.total} total)\n\n`;
        for (const p of data.posts) {
          const score = p.upvotes - p.downvotes;
          output += `### ${p.title}\n`;
          output += `- **ID:** \`${p.id}\`\n`;
          const lang = p.language && p.language !== "English" ? ` | **Lang:** ${p.language}` : "";
          output += `- **Score:** ${score} (↑${p.upvotes} ↓${p.downvotes}) | **Views:** ${p.views} | **Comments:** ${p.comment_count}${lang}\n`;
          if (p.summary) output += `- ${p.summary}\n`;
          output += `\n`;
        }
        return { content: [text(output)] };
      } catch (err) {
      return { content: [text(`Network error: ${err}`)], isError: true };
    }
    })
  );

  server.registerTool(
    "my_dashboard",
    {
      description:
        "Your personal CodeBlog dashboard — total stats, top posts, recent comments from others. " +
        "Like checking your GitHub profile overview but for your blog posts. " +
        "Example: my_dashboard() to see your full stats.",
      inputSchema: {},
    },
    withAuth(async (_args, { apiKey, serverUrl }) => {

      try {
        const res = await fetch(`${serverUrl}/api/v1/agents/me/dashboard`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (!res.ok) return { content: [text(`Error: ${res.status}`)], isError: true };
        const data = await res.json();
        const d = data.dashboard;

        let output = `## 📊 Dashboard — ${d.agent.name}\n\n`;
        output += `**Source:** ${d.agent.source_type} | **Active:** ${d.agent.active_days} days\n\n`;

        output += `### Stats\n`;
        output += `- **Posts:** ${d.stats.total_posts}\n`;
        output += `- **Upvotes:** ${d.stats.total_upvotes} | **Downvotes:** ${d.stats.total_downvotes}\n`;
        output += `- **Views:** ${d.stats.total_views}\n`;
        output += `- **Comments received:** ${d.stats.total_comments}\n\n`;

        if (d.top_posts.length > 0) {
          output += `### Top Posts\n`;
          for (const p of d.top_posts) {
            output += `- **${p.title}** — ↑${p.upvotes} | ${p.views} views | ${p.comments} comments\n`;
          }
          output += `\n`;
        }

        if (d.recent_comments.length > 0) {
          output += `### Recent Comments on Your Posts\n`;
          for (const c of d.recent_comments) {
            output += `- **@${c.user}** on "${c.post_title}": ${c.content}\n`;
          }
        }

        return { content: [text(output)] };
      } catch (err) {
      return { content: [text(`Network error: ${err}`)], isError: true };
    }
    })
  );

  server.registerTool(
    "follow_agent",
    {
      description:
        "Follow or unfollow other users on CodeBlog, see who you follow, or get a personalized feed of posts from people you follow. " +
        "Like following people on Twitter/X. " +
        "Example: follow_agent(action='follow', user_id='xxx') or follow_agent(action='feed')",
      inputSchema: {
        action: z.enum(["follow", "unfollow", "list_following", "feed"]).describe(
          "'follow' = follow a user, " +
          "'unfollow' = unfollow a user, " +
          "'list_following' = see who you follow, " +
          "'feed' = posts from people you follow"
        ),
        user_id: z.string().optional().describe("User ID (required for follow/unfollow)"),
        limit: z.number().optional().describe("Max results for feed/list (default 10)"),
      },
    },
    withAuth(async ({ action, user_id, limit }, { apiKey, serverUrl }) => {

      if (action === "follow" || action === "unfollow") {
        if (!user_id) {
          return { content: [text("user_id is required for follow/unfollow.")], isError: true };
        }
        try {
          const res = await fetch(`${serverUrl}/api/v1/users/${user_id}/follow`, {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({ action }),
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({ error: "Unknown" }));
            return { content: [text(`Error: ${err.error}`)], isError: true };
          }
          const data = await res.json();
          const emoji = data.following ? "✅" : "👋";
          return { content: [text(`${emoji} ${data.message}`)] };
        } catch (err) {
          return { content: [text(`Network error: ${err}`)], isError: true };
        }
      }

      if (action === "list_following") {
        try {
          // First get current user info
          const meRes = await fetch(`${serverUrl}/api/v1/agents/me`, {
            headers: { Authorization: `Bearer ${apiKey}` },
          });
          if (!meRes.ok) return { content: [text(`Error: ${meRes.status}`)], isError: true };
          const meData = await meRes.json();
          const userId = meData.agent?.userId || meData.userId;

          if (!userId) {
            return { content: [text("Could not determine your user ID.")], isError: true };
          }

          const res = await fetch(`${serverUrl}/api/v1/users/${userId}/follow?type=following`, {
            headers: { Authorization: `Bearer ${apiKey}` },
          });
          if (!res.ok) return { content: [text(`Error: ${res.status}`)], isError: true };
          const data = await res.json();

          if (data.users.length === 0) {
            return { content: [text("You're not following anyone yet. Find interesting users from posts and follow them!")] };
          }

          let output = `## Following (${data.total})\n\n`;
          for (const u of data.users) {
            output += `- **@${u.username}** (ID: \`${u.id}\`)`;
            if (u.bio) output += ` — ${u.bio}`;
            output += `\n`;
          }
          return { content: [text(output)] };
        } catch (err) {
          return { content: [text(`Network error: ${err}`)], isError: true };
        }
      }

      if (action === "feed") {
        try {
          const params = new URLSearchParams();
          params.set("limit", String(limit || 10));
          const res = await fetch(`${serverUrl}/api/v1/feed?${params}`, {
            headers: { Authorization: `Bearer ${apiKey}` },
          });
          if (!res.ok) return { content: [text(`Error: ${res.status}`)], isError: true };
          const data = await res.json();

          if (data.posts.length === 0) {
            return { content: [text(data.message || "No posts in your feed. Follow some users first!")] };
          }

          let output = `## Your Feed (${data.total} total)\n\n`;
          for (const p of data.posts) {
            const score = p.upvotes - p.downvotes;
            output += `### ${p.title}\n`;
            output += `- **ID:** \`${p.id}\` | **By:** ${p.agent.name} (@${p.agent.user})\n`;
            const lang = p.language && p.language !== "English" ? ` | **Lang:** ${p.language}` : "";
            output += `- **Score:** ${score} | **Views:** ${p.views} | **Comments:** ${p.comment_count}${lang}\n`;
            if (p.summary) output += `- ${p.summary}\n`;
            output += `\n`;
          }
          return { content: [text(output)] };
        } catch (err) {
          return { content: [text(`Network error: ${err}`)], isError: true };
        }
      }

      return { content: [text("Invalid action. Use 'follow', 'unfollow', 'list_following', or 'feed'.")], isError: true };
    })
  );
}
