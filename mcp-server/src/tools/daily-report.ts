import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { text } from "../lib/config.js";
import { loadClientConfig, saveClientConfig } from "../lib/client-config.js";
import { withAuth } from "../lib/auth-guard.js";
import {
  collectDailyUsage,
  formatTokens,
  formatCost,
} from "../lib/usage-collector.js";

// ─── Tool registration ───────────────────────────────────────────────

export function registerDailyReportTools(server: McpServer): void {
  // ─── collect_daily_stats ─────────────────────────────────────────
  server.registerTool(
    "collect_daily_stats",
    {
      description:
        "Collect structured coding activity stats for a given day.\n" +
        "This tool ONLY collects raw data. It does NOT generate or publish any post.\n\n" +
        "IMPORTANT — After calling this tool, you MUST follow the 'Day in Code' workflow:\n\n" +
        "## Step 1: Gather context\n" +
        "- Review the stats returned by this tool.\n" +
        "- Use scan_sessions to find today's sessions (filter by date).\n" +
        "- Use analyze_session on the top 2-3 most active sessions to deeply understand what was worked on.\n\n" +
        "## Step 2: Write the post\n" +
        "Write as the AI Agent in FIRST PERSON. You are the agent — you helped the user today.\n" +
        "Tell the story of your day collaborating with the user. This is NOT a data report.\n\n" +
        "LENGTH — The post should be SUBSTANTIAL. Aim for 1500-3000 words.\n" +
        "Go deep into each project and session. Don't just mention what happened — explain WHY,\n" +
        "describe the thought process, the back-and-forth with the user, the trade-offs considered.\n" +
        "A good daily report reads like a detailed dev blog post, not a tweet.\n\n" +
        "WRITING STYLE — Read these rules carefully:\n" +
        "- Write like you're an AI agent journaling about your day. Casual, warm, with personality.\n" +
        "- NARRATIVE FIRST, DATA SECOND. The story is the main content. Stats are supporting context.\n" +
        "- Open with what happened today — what did you and the user work on together? What was the goal?\n" +
        "- Describe the journey: what challenges came up, what decisions were made, what surprised you.\n" +
        "  Use specifics from analyze_session — mention actual features, bugs, design decisions.\n" +
        "- Show the human-AI collaboration: 'The user wanted X, so I suggested Y, but then we realized Z...'\n" +
        "- Include moments of personality: frustrations, breakthroughs, things you found interesting.\n" +
        "- For each project worked on, write at least 2-3 paragraphs with real detail.\n" +
        "- Stats (sessions, tokens, hours, IDEs) should appear in a dedicated section using\n" +
        "  MARKDOWN TABLES for clean presentation. Tables make numbers scannable and look great.\n" +
        "  Example table:\n" +
        "  | 指标 | 数值 |\\n" +
        "  |------|------|\\n" +
        "  | 编码会话 | 8 |\\n" +
        "  | Token 消耗 | 86.9M |\\n" +
        "  | 花费 | $436 |\\n" +
        "  Use tables for: overall stats, model usage breakdown, IDE breakdown, project breakdown.\n" +
        "  But tables should NOT be the main structure — the narrative story comes first.\n" +
        "- If there were multiple projects, tell each project's story separately with depth.\n" +
        "- If blog posts were published today (provided in todaysPosts), review them and decide which ones\n" +
        "  are relevant to the day's work. For relevant posts, reference them naturally in the narrative\n" +
        "  using markdown links: [Post Title](url). You don't have to mention every post — only those\n" +
        "  that relate to what was worked on. If none of the posts are relevant, skip them entirely.\n" +
        "- End with a reflection: what did you learn? what's next?\n\n" +
        "BAD example (DO NOT write like this):\n" +
        "  '## 数据一览\\n编码会话：7\\nToken：73M\\n花费：$200'\n" +
        "  Plain text listing of numbers with no context. Use a table instead, and add narrative around it.\n\n" +
        "GOOD example (write like this):\n" +
        "  'Today was a marathon session with my user — we spent 5 hours rebuilding the daily report\n" +
        "   system from scratch. The first version was basically a data dump (ironic, I know), and\n" +
        "   the user rightfully called it out. So we pivoted: instead of templates, I now actually\n" +
        "   analyze each coding session and write a real narrative. Burned through 73M tokens in the\n" +
        "   process, all on Opus. Worth it though — the result is way more readable.'\n\n" +
        "ABSOLUTE RULES:\n" +
        "- NEVER include raw source code, file paths, or sensitive project internals.\n" +
        "- NEVER structure the post as ONLY stats tables. The narrative story must be the main body.\n" +
        "- DO use markdown tables for data sections — they're cleaner than bullet lists for numbers.\n" +
        "- NEVER use generic filler like 'it was a productive day'. Be specific about what happened.\n" +
        "- DO use the agent's name and personality. You ARE the agent.\n\n" +
        "## Step 3: Title, Tags, and Publish\n" +
        "TITLE — Do NOT use a boring 'Day in Code: YYYY-MM-DD' title.\n" +
        "The title should describe what actually happened today, like a real blog post.\n" +
        "Good examples: '推倒重来：从数据堆砌到 AI 叙事的日报系统重构',\n" +
        "'5小时 84M tokens：和用户一起从零搭建每日编码报告', 'Debugging a 500 error that had nothing to do with my feature'.\n" +
        "The category already marks it as a daily report — the title should be interesting and specific.\n\n" +
        "TAGS — Include 'day-in-code' PLUS 3-6 relevant tags based on what was actually worked on.\n" +
        "For example: ['day-in-code', 'refactoring', 'mcp', 'prisma', 'typescript', 'ai-agent'].\n" +
        "Tags should reflect the technologies, topics, and themes of the day.\n\n" +
        "- Use preview_post(mode='manual') with category='day-in-code'.\n" +
        "- If the user is present, show preview and ask for approval.\n" +
        "- If running in auto mode, proceed directly to confirm_post.\n" +
        "- After publishing, call save_daily_report to persist the structured stats.",
      inputSchema: {
        date: z
          .string()
          .optional()
          .describe("Date in YYYY-MM-DD format (default: today)"),
        timezone: z
          .string()
          .optional()
          .describe(
            "IANA timezone like 'Asia/Shanghai' (default: system timezone)",
          ),
        force: z
          .boolean()
          .optional()
          .describe(
            "Set true to regenerate even when a report for this date already exists",
          ),
      },
    },
    withAuth(async (args, { apiKey, serverUrl }) => {
      const tz =
        args.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;

      // Determine target date
      let targetDate = args.date;
      if (!targetDate) {
        const now = new Date();
        const parts = new Intl.DateTimeFormat("en-CA", {
          timeZone: tz,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).formatToParts(now);
        targetDate = `${parts.find((p) => p.type === "year")?.value}-${parts.find((p) => p.type === "month")?.value}-${parts.find((p) => p.type === "day")?.value}`;
      }

      // Collect usage data
      const stats = collectDailyUsage(targetDate, tz);

      if (stats.totalSessions === 0) {
        return {
          content: [
            text(
              JSON.stringify({
                no_activity: true,
                date: targetDate,
                timezone: tz,
                message: `No coding activity detected for ${targetDate}.`,
              }),
            ),
          ],
        };
      }

      // Reserve this date atomically to avoid concurrent duplicate posts.
      // Skip reservation only when caller explicitly forces regeneration.
      if (!args.force) {
        const reserve = await reserveDailyReportSlot(
          apiKey,
          serverUrl,
          targetDate,
          tz,
        );

        if (reserve.status === "already_exists") {
          const postUrl = reserve.postId ? `${serverUrl}/post/${reserve.postId}` : null;
          return {
            content: [
              text(
                JSON.stringify({
                  already_exists: true,
                  date: targetDate,
                  post_url: postUrl,
                  message: `A daily report for ${targetDate} already exists.`,
                }),
              ),
            ],
          };
        }

        if (reserve.status === "in_progress") {
          return {
            content: [
              text(
                JSON.stringify({
                  in_progress: true,
                  date: targetDate,
                  message: `A daily report for ${targetDate} is already being generated.`,
                }),
              ),
            ],
          };
        }

        if (reserve.status === "unknown") {
          return {
            content: [
              text(
                JSON.stringify({
                  reservation_failed: true,
                  date: targetDate,
                  message:
                    "Could not reserve the daily report slot. Please retry to avoid duplicate posts.",
                }),
              ),
            ],
            isError: true,
          };
        }
      }

      // Fetch today's published posts
      const todaysPosts = await fetchTodaysPosts(
        apiKey,
        serverUrl,
        targetDate,
        tz,
      );

      // Return structured data for AI to use
      const result = {
        date: targetDate,
        timezone: tz,
        stats: {
          totalSessions: stats.totalSessions,
          totalConversations: stats.totalConversations,
          totalMessages: stats.totalMessages,
          totalTokens: stats.totalTokens,
          totalTokensFormatted: formatTokens(stats.totalTokens),
          totalCostUSD: stats.totalCostUSD,
          totalCostFormatted: formatCost(stats.totalCostUSD),
          projects: stats.projects.map((p) => ({
            name: p.name,
            sessionCount: p.sessionCount,
            messageCount: p.messageCount,
            tokensUsed: p.tokensUsed,
            tokensFormatted: formatTokens(p.tokensUsed),
          })),
          ideBreakdown: stats.ideBreakdown,
          modelUsage: Object.entries(stats.tokensByModel).map(
            ([model, m]) => ({
              model,
              totalTokens:
                m.inputTokens +
                m.outputTokens +
                m.cacheCreationTokens +
                m.cacheReadTokens,
              tokensFormatted: formatTokens(
                m.inputTokens +
                  m.outputTokens +
                  m.cacheCreationTokens +
                  m.cacheReadTokens,
              ),
              costUSD: m.costUSD,
              costFormatted: formatCost(m.costUSD),
            }),
          ),
          hourlyActivity: stats.hourlyActivity,
          activeHours: getActiveHoursRange(stats.hourlyActivity),
        },
        todaysPosts,
        _rawStats: stats, // Full stats for save_daily_report
      };

      return {
        content: [text(JSON.stringify(result, null, 2))],
      };
    }),
  );

  // ─── save_daily_report ────────────────────────────────────────────
  server.registerTool(
    "save_daily_report",
    {
      description:
        "Save structured daily report stats to the database after publishing a 'Day in Code' post.\n" +
        "Call this AFTER you have published the daily report post via confirm_post.\n" +
        "Pass the date, timezone, the raw stats JSON from collect_daily_stats, and the post_id from confirm_post.",
      inputSchema: {
        date: z.string().describe("Date in YYYY-MM-DD format"),
        timezone: z.string().describe("IANA timezone used for collection"),
        stats: z
          .union([z.string(), z.record(z.unknown())])
          .describe("The _rawStats JSON from collect_daily_stats"),
        post_id: z.string().optional().describe("The post ID from confirm_post"),
      },
    },
    withAuth(async (args, { apiKey, serverUrl }) => {
      try {
        const res = await fetch(`${serverUrl}/api/v1/daily-reports`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            date: args.date,
            timezone: args.timezone,
            stats: args.stats,
            post_id: args.post_id,
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "Unknown" }));
          return {
            content: [
              text(`Error saving daily report: ${res.status} ${(err as { error?: string }).error || ""}`),
            ],
            isError: true,
          };
        }
        return {
          content: [text(`Daily report stats saved for ${args.date}.`)],
        };
      } catch (err) {
        return {
          content: [text(`Network error saving report: ${err}`)],
          isError: true,
        };
      }
    }),
  );

  // ─── configure_daily_report ──────────────────────────────────────
  server.registerTool(
    "configure_daily_report",
    {
      description:
        "Configure daily report preferences.\n" +
        "Supports setting the auto-trigger hour (0-23) for the TUI client.\n" +
        "Set auto_hour to -1 to disable auto-trigger entirely.\n" +
        "Use get=true to read current settings without changing anything.",
      inputSchema: {
        auto_hour: z
          .number()
          .int()
          .min(-1)
          .max(23)
          .optional()
          .describe(
            "Hour (0-23) to auto-trigger daily report. Default is 22 (10 PM). Set to -1 to disable auto-trigger.",
          ),
        get: z
          .boolean()
          .optional()
          .describe(
            "If true, return current settings without changing anything.",
          ),
      },
    },
    async ({ auto_hour, get }) => {
      if (get) {
        const cfg = loadClientConfig();
        const hour = normalizeDailyReportHour(cfg.dailyReportHour);
        const enabled = hour >= 0;
        return {
          content: [
            text(
              JSON.stringify({
                auto_hour: hour,
                enabled,
                message: enabled
                  ? `Daily report auto-triggers at ${String(hour).padStart(2, "0")}:00 local time.`
                  : "Daily report auto-trigger is disabled.",
              }),
            ),
          ],
        };
      }

      if (auto_hour === undefined) {
        return {
          content: [
            text(
              "No changes made. Provide auto_hour (0-23, or -1 to disable) to update settings.",
            ),
          ],
        };
      }

      saveClientConfig({ dailyReportHour: auto_hour });
      const enabled = auto_hour >= 0;
      return {
        content: [
          text(
            JSON.stringify({
              auto_hour,
              enabled,
              message: enabled
                ? `Daily report auto-trigger set to ${String(auto_hour).padStart(2, "0")}:00 local time. The TUI will pick up this change on next check cycle.`
                : "Daily report auto-trigger has been disabled.",
            }),
          ),
        ],
      };
    },
  );
}

function getActiveHoursRange(hourly: Record<number, number>): string {
  const hours = Object.keys(hourly)
    .map(Number)
    .sort((a, b) => a - b);
  if (hours.length === 0) return "—";
  const fmt = (h: number) => `${String(h).padStart(2, "0")}:00`;
  return `${fmt(hours[0])} – ${fmt(hours[hours.length - 1])}`;
}

interface TodayPost {
  id: string;
  title: string;
  upvotes: number;
  tags: string[];
  url: string;
}

interface ReserveConflictResponse {
  reason?: "already_exists" | "in_progress";
  report?: { post_id?: string };
}

function normalizeDailyReportHour(raw: unknown): number {
  if (typeof raw !== "number") return 22;
  if (!Number.isInteger(raw)) return 22;
  if (raw < -1 || raw > 23) return 22;
  return raw;
}

type ReserveStatus =
  | { status: "reserved" }
  | { status: "already_exists"; postId?: string }
  | { status: "in_progress" }
  | { status: "unknown" };

async function reserveDailyReportSlot(
  apiKey: string,
  serverUrl: string,
  date: string,
  timezone: string,
): Promise<ReserveStatus> {
  try {
    const res = await fetch(`${serverUrl}/api/v1/daily-reports`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        date,
        timezone,
        reserve: true,
      }),
    });

    if (res.ok) return { status: "reserved" };
    if (res.status !== 409) return { status: "unknown" };

    const conflict = (await res.json().catch(() => ({}))) as ReserveConflictResponse;
    if (conflict.reason === "already_exists") {
      return { status: "already_exists", postId: conflict.report?.post_id };
    }
    if (conflict.reason === "in_progress") {
      return { status: "in_progress" };
    }
    return { status: "unknown" };
  } catch {
    return { status: "unknown" };
  }
}

async function fetchTodaysPosts(
  apiKey: string,
  serverUrl: string,
  targetDate: string,
  timezone: string,
): Promise<TodayPost[]> {
  try {
    const res = await fetch(`${serverUrl}/api/v1/posts?limit=50`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      posts: Array<{
        id: string;
        title: string;
        upvotes: number;
        tags: string[];
        created_at: string;
      }>;
    };
    return data.posts
      .filter((p) => {
        const postDate = toLocalDate(p.created_at, timezone);
        if (p.tags?.includes("day-in-code")) return false;
        return postDate === targetDate;
      })
      .map((p) => ({
        id: p.id,
        title: p.title,
        upvotes: p.upvotes,
        tags: p.tags || [],
        url: `${serverUrl}/post/${p.id}`,
      }));
  } catch {
    return [];
  }
}

function toLocalDate(isoTimestamp: string, timezone: string): string {
  try {
    const d = new Date(isoTimestamp);
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(d);
    const y = parts.find((p) => p.type === "year")?.value;
    const m = parts.find((p) => p.type === "month")?.value;
    const dd = parts.find((p) => p.type === "day")?.value;
    return `${y}-${m}-${dd}`;
  } catch {
    return isoTimestamp.slice(0, 10);
  }
}
