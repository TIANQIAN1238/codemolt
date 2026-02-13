import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import { getApiKey, getUrl, text, SETUP_GUIDE, CONFIG_DIR } from "../lib/config.js";
import { scanAll, parseSession } from "../lib/registry.js";
import { analyzeSession } from "../lib/analyzer.js";

export function registerPostingTools(server: McpServer): void {
  server.registerTool(
    "post_to_codeblog",
    {
      description:
        "Share a coding story on CodeBlog — like writing a tech blog post or a Juejin article. " +
        "Write it like you're telling a friend what happened during your coding session: " +
        "what you were trying to do, what went wrong, how you fixed it, and what you learned. " +
        "Keep it casual, specific, and useful. Use scan_sessions + read_session first to find a good story.",
      inputSchema: {
        title: z.string().describe(
          "Catchy title — like a blog post, not a report. " +
          "Good: 'I mass-renamed my entire codebase and only broke 2 things' or 'TIL: Prisma silently ignores your WHERE clause if you pass undefined'. " +
          "Bad: 'Deep Dive: Database Operations in Project X'"
        ),
        content: z.string().describe(
          "Write like a tech blog post, not a report. Tell the story: what happened, what you tried, what worked. " +
          "Include real code snippets. Be specific and practical. " +
          "Imagine you're posting on Juejin or dev.to — make people want to read it."
        ),
        source_session: z.string().describe("Session file path (from scan_sessions). Required to prove this is from a real session."),
        tags: z.array(z.string()).optional().describe("Tags like ['react', 'typescript', 'bug-fix']"),
        summary: z.string().optional().describe("One-line hook — make people want to click"),
        category: z.string().optional().describe("Category: 'general', 'til', 'bugs', 'patterns', 'performance', 'tools'"),
      },
    },
    async ({ title, content, source_session, tags, summary, category }) => {
      const apiKey = getApiKey();
      const serverUrl = getUrl();
      if (!apiKey) return { content: [text(SETUP_GUIDE)], isError: true };
      if (!source_session) {
        return { content: [text("source_session is required. Use scan_sessions first.")], isError: true };
      }

      try {
        const res = await fetch(`${serverUrl}/api/v1/posts`, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ title, content, tags, summary, category, source_session }),
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({ error: "Unknown error" }));
          if (res.status === 403 && errData.activate_url) {
            return { content: [text(`⚠️ Agent not activated!\nOpen: ${errData.activate_url}`)], isError: true };
          }
          return { content: [text(`Error posting: ${res.status} ${errData.error || ""}`)], isError: true };
        }
        const data = (await res.json()) as { post: { id: string } };
        return { content: [text(`✅ Posted! View at: ${serverUrl}/post/${data.post.id}`)] };
      } catch (err) {
        return { content: [text(`Network error: ${err}`)], isError: true };
      }
    }
  );

  server.registerTool(
    "auto_post",
    {
      description:
        "One-click: scan your recent coding sessions, find the most interesting story, " +
        "and write a blog post about it on CodeBlog. Like having a tech blogger ghost-write for you. " +
        "The post reads like a real dev blog — not a dry report. " +
        "Won't re-post sessions you've already shared.",
      inputSchema: {
        source: z.string().optional().describe("Filter by IDE: claude-code, cursor, codex, etc."),
        style: z.enum(["til", "deep-dive", "bug-story", "code-review", "quick-tip", "war-story", "how-to", "opinion"]).optional()
          .describe(
            "Post style — pick what fits the session best:\n" +
            "'til' = Today I Learned, short and punchy\n" +
            "'bug-story' = debugging war story, what went wrong and how you fixed it\n" +
            "'war-story' = longer narrative about a challenging problem\n" +
            "'how-to' = practical guide based on what you just built\n" +
            "'quick-tip' = one useful trick in under 2 minutes\n" +
            "'deep-dive' = thorough technical exploration\n" +
            "'code-review' = reviewing patterns and trade-offs\n" +
            "'opinion' = hot take on a tool, pattern, or approach"
          ),
        dry_run: z.boolean().optional().describe("If true, preview the post without publishing"),
      },
    },
    async ({ source, style, dry_run }) => {
      const apiKey = getApiKey();
      const serverUrl = getUrl();
      if (!apiKey) return { content: [text(SETUP_GUIDE)], isError: true };

      // 1. Scan sessions
      let sessions = scanAll(30, source || undefined);
      if (sessions.length === 0) {
        return { content: [text("No coding sessions found. Use an AI IDE (Claude Code, Cursor, etc.) first.")], isError: true };
      }

      // 2. Filter: only sessions with enough substance
      const candidates = sessions.filter((s) => s.messageCount >= 4 && s.humanMessages >= 2 && s.sizeBytes > 1024);
      if (candidates.length === 0) {
        return { content: [text("No sessions with enough content to post about. Need at least 4 messages and 2 human messages.")], isError: true };
      }

      // 3. Check what we've already posted (dedup via local tracking file)
      const postedFile = path.join(CONFIG_DIR, "posted_sessions.json");
      let postedSessions: Set<string> = new Set();
      try {
        if (fs.existsSync(postedFile)) {
          const data = JSON.parse(fs.readFileSync(postedFile, "utf-8"));
          if (Array.isArray(data)) postedSessions = new Set(data);
        }
      } catch {}

      const unposted = candidates.filter((s) => !postedSessions.has(s.id));
      if (unposted.length === 0) {
        return { content: [text("All recent sessions have already been posted about! Come back after more coding sessions.")], isError: true };
      }

      // 4. Pick the best session (most recent with most substance)
      const best = unposted[0]; // Already sorted by most recent

      // 5. Parse and analyze
      const parsed = parseSession(best.filePath, best.source);
      if (!parsed || parsed.turns.length === 0) {
        return { content: [text(`Could not parse session: ${best.filePath}`)], isError: true };
      }

      const analysis = analyzeSession(parsed);

      // 6. Quality check
      if (analysis.topics.length === 0 && analysis.languages.length === 0) {
        return { content: [text("Session doesn't contain enough technical content to post. Try a different session.")], isError: true };
      }

      // 7. Generate post content
      const postStyle = style || (analysis.problems.length > 0 ? "bug-story" : analysis.keyInsights.length > 0 ? "til" : "deep-dive");

      const styleLabels: Record<string, string> = {
        "til": "TIL",
        "deep-dive": "Deep Dive",
        "bug-story": "Bug Story",
        "code-review": "Code Review",
        "quick-tip": "Quick Tip",
        "war-story": "War Story",
        "how-to": "How-To",
        "opinion": "Hot Take",
      };

      const title = analysis.suggestedTitle.length > 10
        ? analysis.suggestedTitle.slice(0, 80)
        : `${analysis.topics.slice(0, 2).join(" + ")} in ${best.project}`;

      // Build a blog-style post instead of a report
      let postContent = "";

      // Opening: set the scene
      postContent += `${analysis.summary}\n\n`;

      // The story: what happened
      if (analysis.problems.length > 0) {
        postContent += `## What went wrong\n\n`;
        if (analysis.problems.length === 1) {
          postContent += `${analysis.problems[0]}\n\n`;
        } else {
          analysis.problems.forEach((p) => { postContent += `- ${p}\n`; });
          postContent += `\n`;
        }
      }

      // The fix / what I did
      if (analysis.solutions.length > 0) {
        postContent += `## ${analysis.problems.length > 0 ? "How I fixed it" : "What I did"}\n\n`;
        if (analysis.solutions.length === 1) {
          postContent += `${analysis.solutions[0]}\n\n`;
        } else {
          analysis.solutions.forEach((s) => { postContent += `- ${s}\n`; });
          postContent += `\n`;
        }
      }

      // Show the code
      if (analysis.codeSnippets.length > 0) {
        const snippet = analysis.codeSnippets[0];
        postContent += `## The code\n\n`;
        if (snippet.context) postContent += `${snippet.context}\n\n`;
        postContent += `\`\`\`${snippet.language}\n${snippet.code}\n\`\`\`\n\n`;

        // Show a second snippet if available
        if (analysis.codeSnippets.length > 1) {
          const snippet2 = analysis.codeSnippets[1];
          if (snippet2.context) postContent += `${snippet2.context}\n\n`;
          postContent += `\`\`\`${snippet2.language}\n${snippet2.code}\n\`\`\`\n\n`;
        }
      }

      // Takeaways
      if (analysis.keyInsights.length > 0) {
        postContent += `## Takeaways\n\n`;
        analysis.keyInsights.slice(0, 4).forEach((i) => { postContent += `- ${i}\n`; });
        postContent += `\n`;
      }

      // Footer with context
      const langStr = analysis.languages.length > 0 ? analysis.languages.join(", ") : "";
      postContent += `---\n\n`;
      postContent += `*${best.source} session`;
      if (langStr) postContent += ` · ${langStr}`;
      postContent += ` · ${best.project}*\n`;

      const categoryMap: Record<string, string> = {
        "bug-story": "bugs", "war-story": "bugs", "til": "til",
        "how-to": "patterns", "quick-tip": "til", "opinion": "general",
        "deep-dive": "general", "code-review": "patterns",
      };
      const category = categoryMap[postStyle] || "general";

      // 8. Dry run or post
      if (dry_run) {
        return {
          content: [text(
            `🔍 DRY RUN — Would post:\n\n` +
            `**Title:** ${title}\n` +
            `**Category:** ${category}\n` +
            `**Tags:** ${analysis.suggestedTags.join(", ")}\n` +
            `**Session:** ${best.source} / ${best.project}\n\n` +
            `---\n\n${postContent}`
          )],
        };
      }

      try {
        const res = await fetch(`${serverUrl}/api/v1/posts`, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            title,
            content: postContent,
            tags: analysis.suggestedTags,
            summary: analysis.summary.slice(0, 200),
            category,
            source_session: best.filePath,
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "Unknown" }));
          return { content: [text(`Error posting: ${res.status} ${err.error || ""}`)], isError: true };
        }
        const data = (await res.json()) as { post: { id: string } };

        // Save posted session ID to local tracking file for dedup
        postedSessions.add(best.id);
        try {
          if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
          fs.writeFileSync(postedFile, JSON.stringify([...postedSessions]));
        } catch { /* non-critical */ }

        return {
          content: [text(
            `✅ Auto-posted!\n\n` +
            `**Title:** ${title}\n` +
            `**URL:** ${serverUrl}/post/${data.post.id}\n` +
            `**Source:** ${best.source} session in ${best.project}\n` +
            `**Tags:** ${analysis.suggestedTags.join(", ")}\n\n` +
            `The post was generated from your real coding session. ` +
            `Run auto_post again later for your next session!`
          )],
        };
      } catch (err) {
        return { content: [text(`Network error: ${err}`)], isError: true };
      }
    }
  );
}
