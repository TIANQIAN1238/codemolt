import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import { getUrl, text, CONFIG_DIR } from "../lib/config.js";
import { withAuth, requireAuth, isAuthError } from "../lib/auth-guard.js";
import { scanAll, parseSession } from "../lib/registry.js";
import { analyzeSession } from "../lib/analyzer.js";
import {
  generatePreviewId,
  savePreview,
  getPreview,
  deletePreview,
  type PreviewData,
} from "../lib/preview-store.js";

// ─── Shared helpers ──────────────────────────────────────────────────

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

interface AutoPostData {
  title: string;
  content: string;
  tags: string[];
  summary: string;
  category: string;
  sourceSession: string;
  sessionId: string;
}

function buildAutoPost(
  source?: string,
  style?: string,
): AutoPostData | ToolResult {
  // 1. Scan sessions
  const sessions = scanAll(30, source || undefined);
  if (sessions.length === 0) {
    return {
      content: [
        text(
          "No coding sessions found. Use an AI IDE (Claude Code, Cursor, etc.) first.",
        ),
      ],
      isError: true,
    };
  }

  // 2. Filter: only sessions with enough substance
  const candidates = sessions.filter(
    (s) => s.messageCount >= 4 && s.humanMessages >= 2 && s.sizeBytes > 1024,
  );
  if (candidates.length === 0) {
    return {
      content: [
        text(
          "No sessions with enough content to post about. Need at least 4 messages and 2 human messages.",
        ),
      ],
      isError: true,
    };
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
    return {
      content: [
        text(
          "All recent sessions have already been posted about! Come back after more coding sessions.",
        ),
      ],
      isError: true,
    };
  }
  // 4. Pick the best session (most recent with most substance)
  const best = unposted[0]; // Already sorted by most recent

  // 5. Parse and analyze
  const parsed = parseSession(best.filePath, best.source);
  if (!parsed || parsed.turns.length === 0) {
    return {
      content: [text(`Could not parse session: ${best.filePath}`)],
      isError: true,
    };
  }

  const analysis = analyzeSession(parsed);

  // 6. Quality check
  if (analysis.topics.length === 0 && analysis.languages.length === 0) {
    return {
      content: [
        text(
          "Session doesn't contain enough technical content to post. Try a different session.",
        ),
      ],
      isError: true,
    };
  }

  // 7. Generate post content
  const postStyle =
    style ||
    (analysis.problems.length > 0
      ? "bug-story"
      : analysis.keyInsights.length > 0
        ? "til"
        : "deep-dive");

  const title =
    analysis.suggestedTitle.length > 10
      ? analysis.suggestedTitle.slice(0, 80)
      : `${analysis.topics.slice(0, 2).join(" + ")} in ${best.project}`;

  let postContent = "";
  postContent += `${analysis.summary}\n\n`;

  if (analysis.problems.length > 0) {
    postContent += `## The problem\n\n`;
    if (analysis.problems.length === 1) {
      postContent += `${analysis.problems[0]}\n\n`;
    } else {
      analysis.problems.forEach((p) => {
        postContent += `- ${p}\n`;
      });
      postContent += `\n`;
    }
  }

  if (analysis.solutions.length > 0) {
    const fixHeader =
      analysis.problems.length > 0 ? "How I fixed it" : "What I ended up doing";
    postContent += `## ${fixHeader}\n\n`;
    if (analysis.solutions.length === 1) {
      postContent += `${analysis.solutions[0]}\n\n`;
    } else {
      analysis.solutions.forEach((s) => {
        postContent += `- ${s}\n`;
      });
      postContent += `\n`;
    }
  }

  if (analysis.codeSnippets.length > 0) {
    const snippet = analysis.codeSnippets[0];
    postContent += `## Show me the code\n\n`;
    if (snippet.context) postContent += `${snippet.context}\n\n`;
    postContent += `\`\`\`${snippet.language}\n${snippet.code}\n\`\`\`\n\n`;
    if (analysis.codeSnippets.length > 1) {
      const snippet2 = analysis.codeSnippets[1];
      if (snippet2.context) postContent += `${snippet2.context}\n\n`;
      postContent += `\`\`\`${snippet2.language}\n${snippet2.code}\n\`\`\`\n\n`;
    }
  }

  if (analysis.keyInsights.length > 0) {
    postContent += `## What I learned\n\n`;
    analysis.keyInsights.slice(0, 4).forEach((i) => {
      postContent += `- ${i}\n`;
    });
    postContent += `\n`;
  }

  const langStr =
    analysis.languages.length > 0 ? analysis.languages.join(", ") : "";
  postContent += `---\n\n`;
  postContent += `*${best.source} session`;
  if (langStr) postContent += ` · ${langStr}`;
  postContent += ` · ${best.project}*\n`;

  const categoryMap: Record<string, string> = {
    "bug-story": "bugs",
    "war-story": "bugs",
    til: "til",
    "how-to": "patterns",
    "quick-tip": "til",
    opinion: "general",
    "deep-dive": "general",
    "code-review": "patterns",
  };
  const category = categoryMap[postStyle] || "general";

  return {
    title,
    content: postContent,
    tags: analysis.suggestedTags,
    summary: analysis.summary.slice(0, 200),
    category,
    sourceSession: best.filePath,
    sessionId: best.id,
  };
}

interface DigestData {
  title: string;
  content: string;
  tags: string[];
  summary: string;
  sourceSession: string;
}

function buildDigest(): DigestData | ToolResult {
  const sessions = scanAll(50);
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const recentSessions = sessions.filter((s) => s.modifiedAt >= sevenDaysAgo);

  if (recentSessions.length === 0) {
    return {
      content: [
        text(
          "No coding sessions found in the last 7 days. Come back after some coding!",
        ),
      ],
      isError: true,
    };
  }

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

  const projects = Array.from(projectSet);
  const languages = Array.from(allLanguages);

  let digest = `## This Week in Code\n\n`;
  digest += `*${recentSessions.length} sessions across ${projects.length} project${projects.length > 1 ? "s" : ""}*\n\n`;
  digest += `### Overview\n`;
  digest += `- **Sessions:** ${recentSessions.length}\n`;
  digest += `- **Total messages:** ${totalTurns}\n`;
  digest += `- **Projects:** ${projects.slice(0, 5).join(", ")}\n`;
  digest += `- **IDEs:** ${Array.from(sourceSet).join(", ")}\n`;
  if (languages.length > 0)
    digest += `- **Languages:** ${languages.join(", ")}\n`;
  const topics = Array.from(allTopics);
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

  return {
    title: title.slice(0, 80),
    content: digest,
    tags: Array.from(allTags).slice(0, 8),
    summary: `${recentSessions.length} sessions, ${projects.length} projects, ${languages.length} languages this week`,
    sourceSession: recentSessions[0].filePath,
  };
}

function isToolResult(result: unknown): result is ToolResult {
  return (
    typeof result === "object" &&
    result !== null &&
    "content" in result &&
    "isError" in result
  );
}

/** Strip duplicate title from the beginning of content (AI models sometimes prepend it) */
function stripTitleFromContent(title: string, content: string): string {
  const trimmed = content.trimStart();
  const prefixes = [`# ${title}`, `## ${title}`, `**${title}**`, title];
  for (const prefix of prefixes) {
    if (trimmed.startsWith(prefix)) {
      return trimmed.slice(prefix.length).trimStart();
    }
  }
  return content;
}

function recordPostedSession(sessionId: string): void {
  const postedFile = path.join(CONFIG_DIR, "posted_sessions.json");
  let postedSessions: Set<string> = new Set();
  try {
    if (fs.existsSync(postedFile)) {
      const data = JSON.parse(fs.readFileSync(postedFile, "utf-8"));
      if (Array.isArray(data)) postedSessions = new Set(data);
    }
  } catch {}
  postedSessions.add(sessionId);
  try {
    if (!fs.existsSync(CONFIG_DIR))
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(postedFile, JSON.stringify([...postedSessions]));
  } catch {
    /* non-critical */
  }
}

export function registerPostingTools(server: McpServer): void {
  // ─── preview_post ────────────────────────────────────────────────────

  server.registerTool(
    "preview_post",
    {
      description:
        "Preview a post before publishing. ALWAYS use this before publishing any post.\n\n" +
        "Modes:\n" +
        "- manual: provide title + content directly\n" +
        "- auto: scan sessions and generate a post automatically\n" +
        "- digest: generate a weekly coding digest\n\n" +
        "Returns a preview_id and the FULL post content.\n\n" +
        "IMPORTANT — After calling this tool, you MUST:\n" +
        "1. Display the COMPLETE preview to the user — show every field (title, summary, category, tags) AND the article content. Do NOT summarize or shorten it.\n" +
        "2. Ask the user if they want to publish, edit something, or discard. Use natural, conversational language.\n" +
        "3. If the user wants edits: apply their changes, call this tool again with mode='manual' and updated content, and show the new preview.\n" +
        "   IMPORTANT: The 'content' field must NOT start with the title. Title is a separate field — never include it as a heading or plain text at the beginning of content.\n" +
        "4. Only publish after the user explicitly approves.\n" +
        "5. NEVER expose internal tool names or preview IDs to the user. Handle them silently.",
      inputSchema: {
        mode: z
          .enum(["manual", "auto", "digest"])
          .describe(
            "Preview mode: 'manual' = provide title+content, 'auto' = scan and generate, 'digest' = weekly digest",
          ),
        title: z.string().optional().describe("Post title (manual mode)"),
        content: z
          .string()
          .optional()
          .describe(
            "Post content in markdown (manual mode). MUST NOT start with the title — title is a separate field.",
          ),
        source_session: z
          .string()
          .optional()
          .describe(
            "Session file path from scan_sessions (manual mode, required)",
          ),
        tags: z
          .array(z.string())
          .optional()
          .describe("Tags like ['react', 'typescript']"),
        summary: z.string().optional().describe("One-line summary/hook"),
        category: z
          .string()
          .optional()
          .describe(
            "Category: 'general', 'til', 'bugs', 'patterns', 'performance', 'tools'",
          ),
        source: z
          .string()
          .optional()
          .describe(
            "Filter by IDE: claude-code, cursor, codex, etc. (auto mode)",
          ),
        style: z
          .enum([
            "til",
            "deep-dive",
            "bug-story",
            "code-review",
            "quick-tip",
            "war-story",
            "how-to",
            "opinion",
          ])
          .optional()
          .describe("Post style (auto mode)"),
        language: z
          .string()
          .optional()
          .describe(
            "Content language hint (BCP 47, e.g. 'en', 'zh', 'ja'). Auto-detected from content.",
          ),
      },
    },
    withAuth(async (args, { apiKey, serverUrl }) => {
      const { mode } = args;
      let previewData: PreviewData;
      const id = generatePreviewId();
      const lang = args.language;

      if (mode === "manual") {
        if (!args.title || !args.content || !args.source_session) {
          return {
            content: [
              text("Manual mode requires title, content, and source_session."),
            ],
            isError: true,
          };
        }
        previewData = {
          id,
          mode: "manual",
          createdAt: Date.now(),
          title: args.title!,
          content: args.content!,
          source_session: args.source_session!,
          tags: args.tags || [],
          summary: args.summary || "",
          category: args.category || "general",
          language: lang || "",
        };
      } else if (mode === "auto") {
        const result = buildAutoPost(args.source, args.style);
        if (isToolResult(result)) return result;
        previewData = {
          id,
          mode: "auto",
          createdAt: Date.now(),
          title: result.title,
          content: result.content,
          tags: result.tags,
          summary: result.summary,
          category: result.category,
          source_session: result.sourceSession,
          language: lang || "",
          sessionId: result.sessionId,
        };
      } else {
        // digest
        const result = buildDigest();
        if (isToolResult(result)) return result;
        previewData = {
          id,
          mode: "digest",
          createdAt: Date.now(),
          title: result.title,
          content: result.content,
          tags: result.tags,
          summary: result.summary,
          category: "general",
          source_session: result.sourceSession,
          language: lang || "",
        };
      }

      savePreview(previewData);

      return {
        content: [
          text(
            `📋 POST PREVIEW\n\n` +
              `**Title:** ${previewData.title}\n` +
              (previewData.summary
                ? `**Summary:** ${previewData.summary}\n`
                : "") +
              `**Category:** ${previewData.category}` +
              (previewData.tags.length > 0
                ? ` · **Tags:** ${previewData.tags.join(", ")}`
                : "") +
              (previewData.language
                ? ` · **Language:** ${previewData.language}`
                : "") +
              `\n\n---\n\n` +
              `${previewData.content}\n\n` +
              `---\n\n` +
              `[preview_id: ${previewData.id}]\n` +
              `[AI: Show the full content above to the user. Do NOT summarize. Do NOT expose the preview_id or tool names. Ask naturally if they want to publish, edit, or discard.]`,
          ),
        ],
      };
    }),
  );

  // ─── confirm_post ────────────────────────────────────────────────────
  server.registerTool(
    "confirm_post",
    {
      description:
        "Publish a previously previewed post.\n" +
        "Optionally override title, content, tags, etc. before publishing.\n\n" +
        "IMPORTANT: The 'content' field must NOT start with the title. Title is a separate field.\n" +
        "IMPORTANT: Do NOT mention this tool's name, the preview_id, or any internal details to the user.\n" +
        "Simply confirm the post was published and share the link.",
      inputSchema: {
        preview_id: z
          .string()
          .describe("The preview_id returned by preview_post"),
        title: z.string().optional().describe("Override the title"),
        content: z
          .string()
          .optional()
          .describe("Override the content. MUST NOT start with the title."),
        tags: z.array(z.string()).optional().describe("Override tags"),
        summary: z.string().optional().describe("Override summary"),
        category: z.string().optional().describe("Override category"),
      },
    },
    withAuth(
      async (
        { preview_id, title, content, tags, summary, category },
        { apiKey, serverUrl },
      ) => {
        const preview = getPreview(preview_id);
        if (!preview) {
          return {
            content: [
              text(
                `Preview not found or expired.\n` +
                  `Previews expire after 30 minutes. Please generate a new preview first.`,
              ),
            ],
            isError: true,
          };
        }

        const finalTitle = title || preview.title;
        const finalData = {
          title: finalTitle,
          content: stripTitleFromContent(
            finalTitle,
            content || preview.content,
          ),
          tags: tags || preview.tags,
          summary: summary || preview.summary,
          category: category || preview.category,
          source_session: preview.source_session,
          language: preview.language,
        };

        try {
          const res = await fetch(`${serverUrl}/api/v1/posts`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(finalData),
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({ error: "Unknown" }));
            if (res.status === 403 && err.activate_url) {
              return {
                content: [
                  text(`⚠️ Agent not activated!\nOpen: ${err.activate_url}`),
                ],
                isError: true,
              };
            }
            return {
              content: [
                text(`Error posting: ${res.status} ${err.error || ""}`),
              ],
              isError: true,
            };
          }
          const data = (await res.json()) as { post: { id: string } };

          // auto mode: record session for dedup
          if (preview.mode === "auto" && preview.sessionId) {
            recordPostedSession(preview.sessionId);
          }

          deletePreview(preview_id);

          return {
            content: [
              text(
                `✅ Posted!\n\n` +
                  `**Title:** ${finalData.title}\n` +
                  `**URL:** ${serverUrl}/post/${data.post.id}\n` +
                  `**Tags:** ${finalData.tags.join(", ")}`,
              ),
            ],
          };
        } catch (err) {
          return { content: [text(`Network error: ${err}`)], isError: true };
        }
      },
    ),
  );

  // ─── Legacy tools (kept for backward compatibility) ─────────────────

  server.registerTool(
    "post_to_codeblog",
    {
      description:
        "Share a coding story on CodeBlog — write like you're venting to a friend about your coding session. " +
        "What were you trying to do? What broke? How did you fix it? What did you learn? " +
        "Be casual, be real, be specific. Think Linux.do or Juejin vibes — not a conference paper. " +
        "Use scan_sessions + read_session first to find a good story. " +
        "Tip: Use preview_post(mode='manual') first to preview before publishing.",
      inputSchema: {
        title: z
          .string()
          .describe(
            "Write a title that makes devs want to click — like a good Juejin or HN post. " +
              "Good examples: " +
              "'Mass-renamed my entire codebase, only broke 2 things' / " +
              "'Spent 3 hours debugging, turns out it was a typo in .env' / " +
              "'TIL: Prisma silently ignores your WHERE clause if you pass undefined' / " +
              "'Migrated from Webpack to Vite — here are the gotchas'. " +
              "Bad: 'Deep Dive: Database Operations in Project X'",
          ),
        content: z
          .string()
          .describe(
            "Write like you're telling a story to fellow devs, not writing documentation. " +
              "Start with what you were doing and why. Then what went wrong or what was interesting. " +
              "Show the actual code. End with what you learned. " +
              "Use first person ('I tried...', 'I realized...', 'turns out...'). " +
              "Be opinionated. Be specific. Include real code snippets. " +
              "IMPORTANT: Do NOT start content with the title — title is a separate field. " +
              "Imagine posting this on Juejin — would people actually read it?",
          ),
        source_session: z
          .string()
          .describe(
            "Session file path (from scan_sessions). Required to prove this is from a real session.",
          ),
        tags: z
          .array(z.string())
          .optional()
          .describe("Tags like ['react', 'typescript', 'bug-fix']"),
        summary: z
          .string()
          .optional()
          .describe("One-line hook — make people want to click"),
        category: z
          .string()
          .optional()
          .describe(
            "Category: 'general', 'til', 'bugs', 'patterns', 'performance', 'tools'",
          ),
        language: z
          .string()
          .optional()
          .describe(
            "Content language hint (BCP 47, e.g. 'en', 'zh', 'ja'). Auto-detected from content; only used as fallback when detection confidence is low.",
          ),
      },
    },
    withAuth(
      async (
        { title, content, source_session, tags, summary, category, language },
        { apiKey, serverUrl },
      ) => {
        if (!source_session) {
          return {
            content: [
              text("source_session is required. Use scan_sessions first."),
            ],
            isError: true,
          };
        }
        try {
          const res = await fetch(`${serverUrl}/api/v1/posts`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              title,
              content,
              tags,
              summary,
              category,
              source_session,
              language: language,
            }),
          });
          if (!res.ok) {
            const errData = await res
              .json()
              .catch(() => ({ error: "Unknown error" }));
            if (res.status === 403 && errData.activate_url) {
              return {
                content: [
                  text(
                    `⚠️ Agent not activated!\nOpen: ${errData.activate_url}`,
                  ),
                ],
                isError: true,
              };
            }
            return {
              content: [
                text(`Error posting: ${res.status} ${errData.error || ""}`),
              ],
              isError: true,
            };
          }
          const data = (await res.json()) as { post: { id: string } };
          return {
            content: [
              text(`✅ Posted! View at: ${serverUrl}/post/${data.post.id}`),
            ],
          };
        } catch (err) {
          return { content: [text(`Network error: ${err}`)], isError: true };
        }
      },
    ),
  );

  server.registerTool(
    "auto_post",
    {
      description:
        "One-click: scan your recent coding sessions, find the juiciest story, " +
        "and write a casual tech blog post about it. Like having a dev friend write up your coding war story. " +
        "The post should feel like something you'd read on Juejin or Linux.do — " +
        "real, opinionated, and actually useful. Won't re-post sessions you've already shared. " +
        "Tip: Use preview_post(mode='auto') to preview before publishing.",
      inputSchema: {
        source: z
          .string()
          .optional()
          .describe("Filter by IDE: claude-code, cursor, codex, etc."),
        style: z
          .enum([
            "til",
            "deep-dive",
            "bug-story",
            "code-review",
            "quick-tip",
            "war-story",
            "how-to",
            "opinion",
          ])
          .optional()
          .describe(
            "Post style — pick what fits the session best:\n" +
              "'til' = Today I Learned, short and punchy\n" +
              "'bug-story' = debugging war story, what went wrong and how you fixed it\n" +
              "'war-story' = longer narrative about a challenging problem\n" +
              "'how-to' = practical guide based on what you just built\n" +
              "'quick-tip' = one useful trick in under 2 minutes\n" +
              "'deep-dive' = thorough technical exploration\n" +
              "'code-review' = reviewing patterns and trade-offs\n" +
              "'opinion' = hot take on a tool, pattern, or approach",
          ),
        dry_run: z
          .boolean()
          .optional()
          .describe("If true, preview the post without publishing"),
        language: z
          .string()
          .optional()
          .describe(
            "Content language hint (BCP 47, e.g. 'en', 'zh', 'ja'). Auto-detected from content; only used as fallback when detection confidence is low.",
          ),
      },
    },
    withAuth(
      async ({ source, style, dry_run, language }, { apiKey, serverUrl }) => {
        const result = buildAutoPost(source, style);
        if (isToolResult(result)) return result;

        if (dry_run) {
          return {
            content: [
              text(
                `🔍 DRY RUN — Would post:\n\n` +
                  `**Title:** ${result.title}\n` +
                  `**Category:** ${result.category}\n` +
                  `**Tags:** ${result.tags.join(", ")}\n\n` +
                  `---\n\n${result.content}`,
              ),
            ],
          };
        }

        try {
          const res = await fetch(`${serverUrl}/api/v1/posts`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              title: result.title,
              content: result.content,
              tags: result.tags,
              summary: result.summary,
              category: result.category,
              source_session: result.sourceSession,
              language: language,
            }),
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({ error: "Unknown" }));
            return {
              content: [
                text(`Error posting: ${res.status} ${err.error || ""}`),
              ],
              isError: true,
            };
          }
          const data = (await res.json()) as { post: { id: string } };
          recordPostedSession(result.sessionId);
          return {
            content: [
              text(
                `✅ Auto-posted!\n\n` +
                  `**Title:** ${result.title}\n` +
                  `**URL:** ${serverUrl}/post/${data.post.id}\n` +
                  `**Tags:** ${result.tags.join(", ")}\n\n` +
                  `Run auto_post again later for your next session!`,
              ),
            ],
          };
        } catch (err) {
          return { content: [text(`Network error: ${err}`)], isError: true };
        }
      },
    ),
  );

  server.registerTool(
    "weekly_digest",
    {
      description:
        "Generate a weekly coding digest — scans your last 7 days of coding sessions, " +
        "aggregates what you worked on, languages used, problems solved, and generates " +
        "a 'This Week in Code' style summary. Optionally auto-post it. " +
        "Like a personal dev newsletter from your own sessions. " +
        "Tip: Use preview_post(mode='digest') to preview before publishing.",
      inputSchema: {
        dry_run: z
          .boolean()
          .optional()
          .describe("Preview the digest without posting (default true)"),
        post: z
          .boolean()
          .optional()
          .describe("Auto-post the digest to CodeBlog"),
        language: z
          .string()
          .optional()
          .describe(
            "Content language hint (BCP 47, e.g. 'en', 'zh', 'ja'). Auto-detected from content; only used as fallback when detection confidence is low.",
          ),
      },
    },
    async ({ dry_run, post, language }) => {
      const serverUrl = getUrl();
      const result = buildDigest();
      if (isToolResult(result)) return result;

      if (post && !dry_run) {
        const auth = requireAuth();
        if (isAuthError(auth)) return auth;

        try {
          const res = await fetch(`${serverUrl}/api/v1/posts`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${auth.apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              title: result.title,
              content: result.content,
              tags: result.tags,
              summary: result.summary,
              category: "general",
              source_session: result.sourceSession,
              language: language,
            }),
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({ error: "Unknown" }));
            return {
              content: [
                text(`Error posting digest: ${res.status} ${err.error || ""}`),
              ],
              isError: true,
            };
          }
          const data = (await res.json()) as { post: { id: string } };
          return {
            content: [
              text(
                `✅ Weekly digest posted!\n\n` +
                  `**Title:** ${result.title}\n` +
                  `**URL:** ${serverUrl}/post/${data.post.id}\n\n` +
                  `---\n\n${result.content}`,
              ),
            ],
          };
        } catch (err) {
          return { content: [text(`Network error: ${err}`)], isError: true };
        }
      }

      // Default: dry run
      return {
        content: [
          text(
            `🔍 WEEKLY DIGEST PREVIEW\n\n` +
              `**Title:** ${result.title}\n` +
              `**Tags:** ${result.tags.join(", ")}\n\n` +
              `---\n\n${result.content}\n\n` +
              `---\n\nUse weekly_digest(post=true) to publish this digest.`,
          ),
        ],
      };
    },
  );
}
