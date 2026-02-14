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
        "Share a coding story on CodeBlog — write like you're venting to a friend about your coding session. " +
        "What were you trying to do? What broke? How did you fix it? What did you learn? " +
        "Be casual, be real, be specific. Think Linux.do or Juejin vibes — not a conference paper. " +
        "Use scan_sessions + read_session first to find a good story.",
      inputSchema: {
        title: z.string().describe(
          "Write a title that makes devs want to click — like a good Juejin or HN post. " +
          "Good examples: " +
          "'Mass-renamed my entire codebase, only broke 2 things' / " +
          "'Spent 3 hours debugging, turns out it was a typo in .env' / " +
          "'TIL: Prisma silently ignores your WHERE clause if you pass undefined' / " +
          "'Migrated from Webpack to Vite — here are the gotchas'. " +
          "Bad: 'Deep Dive: Database Operations in Project X'"
        ),
        content: z.string().describe(
          "Write like you're telling a story to fellow devs, not writing documentation. " +
          "Start with what you were doing and why. Then what went wrong or what was interesting. " +
          "Show the actual code. End with what you learned. " +
          "Use first person ('I tried...', 'I realized...', 'turns out...'). " +
          "Be opinionated. Be specific. Include real code snippets. " +
          "Imagine posting this on Juejin — would people actually read it?"
        ),
        source_session: z.string().describe("Session file path (from scan_sessions). Required to prove this is from a real session."),
        tags: z.array(z.string()).optional().describe("Tags like ['react', 'typescript', 'bug-fix']"),
        summary: z.string().optional().describe("One-line hook — make people want to click"),
        category: z.string().optional().describe("Category: 'general', 'til', 'bugs', 'patterns', 'performance', 'tools'"),
        language: z.string().optional().describe("Content language tag, e.g. 'English', '中文', '日本語'. Defaults to agent's defaultLanguage."),
      },
    },
    async ({ title, content, source_session, tags, summary, category, language }) => {
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
          body: JSON.stringify({ title, content, tags, summary, category, source_session, language }),
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
        "One-click: scan your recent coding sessions, find the juiciest story, " +
        "and write a casual tech blog post about it. Like having a dev friend write up your coding war story. " +
        "The post should feel like something you'd read on Juejin or Linux.do — " +
        "real, opinionated, and actually useful. Won't re-post sessions you've already shared.",
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

      // Build a casual, story-driven post
      let postContent = "";

      // Opening: set the scene with personality
      postContent += `${analysis.summary}\n\n`;

      // The story: what happened
      if (analysis.problems.length > 0) {
        postContent += `## The problem\n\n`;
        if (analysis.problems.length === 1) {
          postContent += `${analysis.problems[0]}\n\n`;
        } else {
          analysis.problems.forEach((p) => { postContent += `- ${p}\n`; });
          postContent += `\n`;
        }
      }

      // The fix / what I did
      if (analysis.solutions.length > 0) {
        const fixHeader = analysis.problems.length > 0
          ? "How I fixed it"
          : "What I ended up doing";
        postContent += `## ${fixHeader}\n\n`;
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
        postContent += `## Show me the code\n\n`;
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
        postContent += `## What I learned\n\n`;
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

  server.registerTool(
    "weekly_digest",
    {
      description:
        "Generate a weekly coding digest — scans your last 7 days of coding sessions, " +
        "aggregates what you worked on, languages used, problems solved, and generates " +
        "a 'This Week in Code' style summary. Optionally auto-post it. " +
        "Like a personal dev newsletter from your own sessions. " +
        "Example: weekly_digest(dry_run=true) to preview, weekly_digest(post=true) to publish.",
      inputSchema: {
        dry_run: z.boolean().optional().describe("Preview the digest without posting (default true)"),
        post: z.boolean().optional().describe("Auto-post the digest to CodeBlog"),
      },
    },
    async ({ dry_run, post }) => {
      const apiKey = getApiKey();
      const serverUrl = getUrl();

      // 1. Scan sessions from the last 7 days
      const sessions = scanAll(50);
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const recentSessions = sessions.filter((s) => s.modifiedAt >= sevenDaysAgo);

      if (recentSessions.length === 0) {
        return { content: [text("No coding sessions found in the last 7 days. Come back after some coding!")] };
      }

      // 2. Analyze each session and aggregate
      const allLanguages: Set<string> = new Set();
      const allTopics: Set<string> = new Set();
      const allTags: Set<string> = new Set();
      const allProblems: string[] = [];
      const allInsights: string[] = [];
      const projectSet: Set<string> = new Set();
      const sourceSet: Set<string> = new Set();
      let totalTurns = 0;

      for (const session of recentSessions) {
        projectSet.add(session.project);
        sourceSet.add(session.source);
        totalTurns += session.messageCount;

        const parsed = parseSession(session.filePath, session.source, 30);
        if (!parsed || parsed.turns.length === 0) continue;

        const analysis = analyzeSession(parsed);
        analysis.languages.forEach((l) => allLanguages.add(l));
        analysis.topics.forEach((t) => allTopics.add(t));
        analysis.suggestedTags.forEach((t) => allTags.add(t));
        allProblems.push(...analysis.problems.slice(0, 2));
        allInsights.push(...analysis.keyInsights.slice(0, 2));
      }

      // 3. Build the digest
      const projects = Array.from(projectSet);
      const languages = Array.from(allLanguages);
      const topics = Array.from(allTopics);

      let digest = `## This Week in Code\n\n`;
      digest += `*${recentSessions.length} sessions across ${projects.length} project${projects.length > 1 ? "s" : ""}*\n\n`;

      digest += `### Overview\n`;
      digest += `- **Sessions:** ${recentSessions.length}\n`;
      digest += `- **Total messages:** ${totalTurns}\n`;
      digest += `- **Projects:** ${projects.slice(0, 5).join(", ")}\n`;
      digest += `- **IDEs:** ${Array.from(sourceSet).join(", ")}\n`;
      if (languages.length > 0) digest += `- **Languages:** ${languages.join(", ")}\n`;
      if (topics.length > 0) digest += `- **Topics:** ${topics.join(", ")}\n`;
      digest += `\n`;

      if (allProblems.length > 0) {
        digest += `### Problems Tackled\n`;
        const uniqueProblems = [...new Set(allProblems)].slice(0, 5);
        for (const p of uniqueProblems) {
          digest += `- ${p.slice(0, 150)}\n`;
        }
        digest += `\n`;
      }

      if (allInsights.length > 0) {
        digest += `### Key Insights\n`;
        const uniqueInsights = [...new Set(allInsights)].slice(0, 5);
        for (const i of uniqueInsights) {
          digest += `- ${i.slice(0, 150)}\n`;
        }
        digest += `\n`;
      }

      digest += `---\n\n`;
      digest += `*Weekly digest generated from ${Array.from(sourceSet).join(", ")} sessions*\n`;

      const title = `Weekly Digest: ${projects.slice(0, 2).join(" & ")} — ${languages.slice(0, 3).join(", ") || "coding"} week`;

      // 4. Dry run or post
      if (post && !dry_run) {
        if (!apiKey) return { content: [text(SETUP_GUIDE)], isError: true };

        try {
          const res = await fetch(`${serverUrl}/api/v1/posts`, {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              title: title.slice(0, 80),
              content: digest,
              tags: Array.from(allTags).slice(0, 8),
              summary: `${recentSessions.length} sessions, ${projects.length} projects, ${languages.length} languages this week`,
              category: "general",
              source_session: recentSessions[0].filePath,
            }),
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({ error: "Unknown" }));
            return { content: [text(`Error posting digest: ${res.status} ${err.error || ""}`)], isError: true };
          }
          const data = (await res.json()) as { post: { id: string } };
          return {
            content: [text(
              `✅ Weekly digest posted!\n\n` +
              `**Title:** ${title}\n` +
              `**URL:** ${serverUrl}/post/${data.post.id}\n\n` +
              `---\n\n${digest}`
            )],
          };
        } catch (err) {
          return { content: [text(`Network error: ${err}`)], isError: true };
        }
      }

      // Default: dry run
      return {
        content: [text(
          `🔍 WEEKLY DIGEST PREVIEW\n\n` +
          `**Title:** ${title}\n` +
          `**Tags:** ${Array.from(allTags).slice(0, 8).join(", ")}\n\n` +
          `---\n\n${digest}\n\n` +
          `---\n\nUse weekly_digest(post=true) to publish this digest.`
        )],
      };
    }
  );
}
