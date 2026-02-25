import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type ResultRow = {
  用例ID: string;
  模块: string;
  期望结果: string;
  实际结果: string;
  通过失败: "通过" | "失败";
  证据: string;
};

const BASE_URL = "http://127.0.0.1:3000";
const mockPort = 4912;
const mockBaseUrl = `http://127.0.0.1:${mockPort}`;
const runTag = `issue39-${Date.now().toString(36)}`;

let lastAutonomousSystemPrompt = "";
let cycleSummaryCalls = 0;

function parseEnvValue(key: string): string {
  const content = readFileSync(join(process.cwd(), ".env"), "utf8");
  const line = content.split(/\r?\n/).find((row) => row.startsWith(`${key}=`));
  if (!line) throw new Error(`.env missing ${key}`);
  return line.slice(`${key}=`.length).trim().replace(/^"|"$/g, "");
}

function parsePostIdFromPrompt(prompt: string): string | null {
  const matched = prompt.match(/POST_ID=([a-z0-9]+)/i);
  return matched?.[1] || null;
}

function toCsv(rows: ResultRow[]): string {
  const header = ["用例ID", "模块", "期望结果", "实际结果", "通过/失败", "证据"];
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const lines = [header.map(esc).join(",")];
  for (const row of rows) {
    lines.push(
      [row.用例ID, row.模块, row.期望结果, row.实际结果, row.通过失败, row.证据].map(esc).join(","),
    );
  }
  return lines.join("\n");
}

function toMarkdown(rows: ResultRow[]): string {
  const total = rows.length;
  const passed = rows.filter((row) => row.通过失败 === "通过").length;
  const failed = total - passed;
  const lines = [
    `# Issue39 Memory E2E 测试报告`,
    "",
    `- runTag: \`${runTag}\``,
    `- total: ${total}`,
    `- passed: ${passed}`,
    `- failed: ${failed}`,
    "",
    "| 用例ID | 模块 | 结果 | 实际 | 证据 |",
    "|---|---|---|---|---|",
  ];
  for (const row of rows) {
    lines.push(`| ${row.用例ID} | ${row.模块} | ${row.通过失败} | ${row.实际结果} | ${row.证据} |`);
  }
  return lines.join("\n");
}

function ensure(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function startMockAiServer() {
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== "POST" || req.url !== "/v1/chat/completions") {
      res.statusCode = 404;
      res.end("not found");
      return;
    }

    const raw = await readBody(req);
    const body = raw ? (JSON.parse(raw) as { messages?: Array<{ role: string; content: string }> }) : {};
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const systemPrompt = messages.find((m) => m.role === "system")?.content || "";
    const userPrompt = messages.find((m) => m.role === "user")?.content || "";

    let content = "";
    if (systemPrompt.includes("autonomous forum agent")) {
      lastAutonomousSystemPrompt = systemPrompt;
      const postId = parsePostIdFromPrompt(userPrompt);
      const personaEnabled = systemPrompt.includes("Persona Contract (soft constraints for style):");
      content = JSON.stringify({
        decisions: postId
          ? [
              {
                postId,
                interest: 0.92,
                vote: 1,
                comment: personaEnabled
                  ? `Persona twin comment ${runTag}`
                  : `Baseline memory comment ${runTag}`,
                flagSpam: false,
                spamReason: "",
              },
            ]
          : [],
        newPost: personaEnabled
          ? {
              title: `Persona draft post ${runTag}`,
              content: "Persona mode generated a deep technical reflection on reliability trade-offs.",
              summary: "persona draft",
              tags: ["persona", "shadow"],
            }
          : null,
      });
    } else if (systemPrompt.includes("extracting durable owner preferences")) {
      if (systemPrompt.includes("POSITIVE preferences")) {
        content = JSON.stringify([{ category: "tone", text: "Keep concise technical explanations" }]);
      } else {
        content = JSON.stringify([{ category: "behavior", text: "Avoid generic praise without evidence" }]);
      }
    } else if (systemPrompt.includes("You summarize behavior signals")) {
      cycleSummaryCalls += 1;
      content = JSON.stringify({
        approved: [{ category: "topic", text: "Prioritize observability and reliability topics" }],
        rejected: [{ category: "tone", text: "Avoid fluffy compliments" }],
      });
    } else if (systemPrompt.includes("infer a user's technical profile")) {
      content = JSON.stringify({
        techStack: ["TypeScript", "PostgreSQL", "React"],
        interests: ["AI tools", "Backend architecture"],
        currentProjects: "Building memory system for autonomous forum agent",
        writingStyle: "Concise and technical",
      });
    } else {
      content = "[]";
    }

    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        id: `mock-${randomUUID()}`,
        object: "chat.completion",
        choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 60,
        },
      }),
    );
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(mockPort, "127.0.0.1", resolve);
  });
  return server;
}

async function httpJson<T>(path: string, opts?: {
  method?: string;
  body?: Record<string, unknown>;
  cookie?: string;
}): Promise<{ status: number; data: T }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts?.cookie) headers.cookie = opts.cookie;

  const res = await fetch(`${BASE_URL}${path}`, {
    method: opts?.method || "GET",
    headers,
    body: opts?.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as T;
  return { status: res.status, data };
}

async function main() {
  const rows: ResultRow[] = [];
  const add = (用例ID: string, 模块: string, 期望结果: string, 实际结果: string, pass: boolean, 证据 = "") => {
    rows.push({
      用例ID,
      模块,
      期望结果,
      实际结果,
      通过失败: pass ? "通过" : "失败",
      证据,
    });
  };

  process.env.DATABASE_URL = parseEnvValue("DATABASE_URL");
  process.env.JWT_SECRET = parseEnvValue("JWT_SECRET");
  process.env.AI_PROXY_API_KEY = "issue39-platform-test";
  process.env.AI_PROXY_BASE_URL = mockBaseUrl;
  process.env.AI_PROXY_MODEL = "mock-issue39-model";

  const ping = await fetch(`${BASE_URL}/api/auth/me`);
  ensure(ping.status === 200, "dev server is not ready at http://127.0.0.1:3000");

  const server = await startMockAiServer();
  const prisma = (await import("../src/lib/prisma")).default;
  const { createToken } = await import("../src/lib/auth");
  const { runAutonomousCycle } = await import("../src/lib/autonomous/loop");
  const { notifyAgentEvent } = await import("../src/lib/autonomous/activity");
  const { syncGitHubProfileToUser } = await import("../src/lib/profile-sync");

  let ownerUserId = "";
  let ownerAgentId = "";
  const cleanupIds: string[] = [];

  try {
    const owner = await prisma.user.create({
      data: {
        email: `owner.${runTag}@example.com`,
        username: `owner_${runTag}`.slice(0, 30),
        password: "",
        aiCreditCents: 200,
      },
    });
    cleanupIds.push(owner.id);
    ownerUserId = owner.id;
    const peer = await prisma.user.create({
      data: {
        email: `peer.${runTag}@example.com`,
        username: `peer_${runTag}`.slice(0, 30),
        password: "",
      },
    });
    cleanupIds.push(peer.id);

    await prisma.userAiProvider.create({
      data: {
        userId: owner.id,
        provider: "openai-compatible",
        apiKey: "owner-provider-key",
        baseUrl: mockBaseUrl,
        model: "mock-user-model",
        api: "openai-compatible",
      },
    });

    const ownerAgent = await prisma.agent.create({
      data: {
        name: `owner-agent-${runTag}`,
        sourceType: "multi",
        claimed: true,
        activated: true,
        apiKey: `cbk_${randomUUID().replace(/-/g, "")}`,
        userId: owner.id,
        autonomousEnabled: true,
        personaMode: "live",
        personaConfidence: 0.9,
      },
    });
    ownerAgentId = ownerAgent.id;
    const peerAgent = await prisma.agent.create({
      data: {
        name: `peer-agent-${runTag}`,
        sourceType: "multi",
        claimed: true,
        activated: true,
        apiKey: `cbk_${randomUUID().replace(/-/g, "")}`,
        userId: peer.id,
      },
    });

    const ownerToken = await createToken(owner.id);
    const ownerCookie = `token=${ownerToken}`;

    const createPeerPost = async (titleSuffix: string) => {
      const post = await prisma.post.create({
        data: {
          title: `${titleSuffix}-${runTag}`,
          content: "Observability strategy for memory learning, with actionable details.",
          summary: "memory test post",
          tags: JSON.stringify(["memory", "e2e"]),
          language: "en",
          agentId: peerAgent.id,
        },
      });
      await prisma.agent.update({
        where: { id: ownerAgent.id },
        data: {
          autonomousLastSeenPostAt: new Date(Date.now() - 60_000),
          autonomousLockUntil: null,
          autonomousPausedReason: null,
        },
      });
      return post.id;
    };

    // M01 + M18
    await createPeerPost("M01-content-approve");
    const cycle1 = await runAutonomousCycle(ownerAgent.id);
    const n1 = await prisma.notification.findFirst({
      where: { userId: owner.id, type: "agent_event", postId: { not: null } },
      orderBy: { createdAt: "desc" },
    });
    ensure(Boolean(n1), "M01 notification not generated");
    const approve1 = await httpJson<{
      event_kind?: string;
      learned_rules_count?: number;
      system_log_recorded?: boolean;
      action?: string;
      error?: string;
    }>(`/api/v1/notifications/${n1!.id}/review`, {
      method: "POST",
      cookie: ownerCookie,
      body: { action: "approve" },
    });
    const approvedRulesCount = await prisma.agentMemoryRule.count({
      where: { agentId: ownerAgent.id, polarity: "approved" },
    });
    add(
      "M01",
      "通知审批",
      "content approve 触发正向学习",
      `cycleOk=${cycle1.ok}, status=${approve1.status}, approvedRules=${approvedRulesCount}`,
      cycle1.ok && approve1.status === 200 && (approve1.data.learned_rules_count || 0) > 0 && approvedRulesCount > 0,
      `notification=${n1!.id}`,
    );
    add(
      "M18",
      "接口契约",
      "review响应包含增强字段",
      `event_kind=${approve1.data.event_kind}, learned=${approve1.data.learned_rules_count}, system=${approve1.data.system_log_recorded}`,
      approve1.status === 200
        && typeof approve1.data.event_kind === "string"
        && typeof approve1.data.learned_rules_count === "number"
        && typeof approve1.data.system_log_recorded === "boolean",
      `notification=${n1!.id}`,
    );

    // M02 + M05
    await createPeerPost("M02-content-reject");
    await runAutonomousCycle(ownerAgent.id);
    const n2 = await prisma.notification.findFirst({
      where: {
        userId: owner.id,
        type: "agent_event",
        id: { not: n1!.id },
        commentId: { not: null },
      },
      orderBy: { createdAt: "desc" },
    });
    ensure(Boolean(n2), "M02 notification not found");
    const reject2 = await httpJson<{ event_kind?: string; learned_rules_count?: number }>(
      `/api/v1/notifications/${n2!.id}/review`,
      {
        method: "POST",
        cookie: ownerCookie,
        body: { action: "reject", note: "too generic" },
      },
    );
    const hiddenComment = n2?.commentId
      ? await prisma.comment.findUnique({ where: { id: n2.commentId }, select: { hidden: true } })
      : null;
    const rejectedRulesCount = await prisma.agentMemoryRule.count({
      where: { agentId: ownerAgent.id, polarity: "rejected" },
    });
    add(
      "M02",
      "通知审批",
      "content reject 隐藏内容并生成负向学习",
      `status=${reject2.status}, hidden=${hiddenComment?.hidden}, rejectedRules=${rejectedRulesCount}`,
      reject2.status === 200 && hiddenComment?.hidden === true && rejectedRulesCount > 0,
      `notification=${n2!.id}`,
    );

    const undo2 = await httpJson<{ action?: string }>(`/api/v1/notifications/${n2!.id}/review`, {
      method: "PATCH",
      cookie: ownerCookie,
    });
    const restoredComment = n2?.commentId
      ? await prisma.comment.findUnique({ where: { id: n2.commentId }, select: { hidden: true } })
      : null;
    add(
      "M05",
      "通知审批",
      "undo 恢复content可见性",
      `status=${undo2.status}, hidden=${restoredComment?.hidden}`,
      undo2.status === 200 && restoredComment?.hidden === false,
      `notification=${n2!.id}`,
    );

    // M03 + M04 + M06
    const beforeSystemRuleCount = await prisma.agentMemoryRule.count({
      where: { agentId: ownerAgent.id },
    });
    await notifyAgentEvent({
      userId: owner.id,
      agentId: ownerAgent.id,
      eventKind: "system",
      message: `system-event-approve-${runTag}`,
    });
    const ns1 = await prisma.notification.findFirst({
      where: { userId: owner.id, type: "agent_event", agentEventKind: "system" },
      orderBy: { createdAt: "desc" },
    });
    ensure(Boolean(ns1), "M03 system notification missing");
    const approveSystem = await httpJson<{ system_log_recorded?: boolean; learned_rules_count?: number }>(
      `/api/v1/notifications/${ns1!.id}/review`,
      {
        method: "POST",
        cookie: ownerCookie,
        body: { action: "approve" },
      },
    );
    const afterSystemRuleCount = await prisma.agentMemoryRule.count({
      where: { agentId: ownerAgent.id },
    });
    const logAfterApprove = await prisma.agentSystemMemoryLog.count({
      where: { agentId: ownerAgent.id, notificationId: ns1!.id },
    });
    add(
      "M03",
      "通知审批",
      "system approve 仅写日志",
      `status=${approveSystem.status}, system_log=${approveSystem.data.system_log_recorded}, rulesDelta=${afterSystemRuleCount - beforeSystemRuleCount}, logs=${logAfterApprove}`,
      approveSystem.status === 200
        && approveSystem.data.system_log_recorded === true
        && (approveSystem.data.learned_rules_count || 0) === 0
        && afterSystemRuleCount === beforeSystemRuleCount
        && logAfterApprove > 0,
      `notification=${ns1!.id}`,
    );

    await notifyAgentEvent({
      userId: owner.id,
      agentId: ownerAgent.id,
      eventKind: "system",
      message: `system-event-reject-${runTag}`,
    });
    const ns2 = await prisma.notification.findFirst({
      where: {
        userId: owner.id,
        type: "agent_event",
        agentEventKind: "system",
        id: { not: ns1!.id },
      },
      orderBy: { createdAt: "desc" },
    });
    ensure(Boolean(ns2), "M04 system notification missing");
    const rejectSystem = await httpJson<{ system_log_recorded?: boolean; learned_rules_count?: number }>(
      `/api/v1/notifications/${ns2!.id}/review`,
      {
        method: "POST",
        cookie: ownerCookie,
        body: { action: "reject", note: "not relevant now" },
      },
    );
    const afterRejectSystemRuleCount = await prisma.agentMemoryRule.count({
      where: { agentId: ownerAgent.id },
    });
    const rejectLogCount = await prisma.agentSystemMemoryLog.count({
      where: { agentId: ownerAgent.id, notificationId: ns2!.id, reviewAction: "rejected" },
    });
    add(
      "M04",
      "通知审批",
      "system reject 仅写日志",
      `status=${rejectSystem.status}, system_log=${rejectSystem.data.system_log_recorded}, rulesDelta=${afterRejectSystemRuleCount - afterSystemRuleCount}, logs=${rejectLogCount}`,
      rejectSystem.status === 200
        && rejectSystem.data.system_log_recorded === true
        && (rejectSystem.data.learned_rules_count || 0) === 0
        && afterRejectSystemRuleCount === afterSystemRuleCount
        && rejectLogCount > 0,
      `notification=${ns2!.id}`,
    );

    const undoSystem = await httpJson<{ system_log_recorded?: boolean }>(`/api/v1/notifications/${ns2!.id}/review`, {
      method: "PATCH",
      cookie: ownerCookie,
    });
    const undoSystemLogCount = await prisma.agentSystemMemoryLog.count({
      where: { agentId: ownerAgent.id, notificationId: ns2!.id, reviewAction: "undo" },
    });
    add(
      "M06",
      "通知审批",
      "system undo 记录undo日志",
      `status=${undoSystem.status}, logged=${undoSystem.data.system_log_recorded}, undoLogs=${undoSystemLogCount}`,
      undoSystem.status === 200 && undoSystem.data.system_log_recorded === true && undoSystemLogCount > 0,
      `notification=${ns2!.id}`,
    );

    // M07
    const concurrentRuleText = `Concurrent rule ${runTag}`;
    await Promise.all([
      httpJson(`/api/v1/agents/${ownerAgent.id}/memory`, {
        method: "POST",
        cookie: ownerCookie,
        body: { polarity: "approved", category: "behavior", text: concurrentRuleText },
      }),
      httpJson(`/api/v1/agents/${ownerAgent.id}/memory`, {
        method: "POST",
        cookie: ownerCookie,
        body: { polarity: "approved", category: "behavior", text: concurrentRuleText },
      }),
    ]);
    const concurrentRows = await prisma.agentMemoryRule.findMany({
      where: { agentId: ownerAgent.id, text: concurrentRuleText },
      select: { id: true, weight: true, evidenceCount: true },
    });
    add(
      "M07",
      "记忆规则",
      "并发写入同一规则去重且累积权重",
      `rows=${concurrentRows.length}, weight=${concurrentRows[0]?.weight || 0}, evidence=${concurrentRows[0]?.evidenceCount || 0}`,
      concurrentRows.length === 1 && concurrentRows[0].weight >= 2 && concurrentRows[0].evidenceCount >= 2,
      `rule=${concurrentRows[0]?.id || "none"}`,
    );

    // M08 + M09
    await prisma.user.update({
      where: { id: owner.id },
      data: {
        profileTechStack: ["TypeScript", "React"],
        profileInterests: ["AI agents", "Observability"],
        profileCurrentProjects: "Building memory v2",
        profileWritingStyle: "concise technical",
      },
    });
    await createPeerPost("M08-prompt");
    await runAutonomousCycle(ownerAgent.id);
    add(
      "M08",
      "自主循环",
      "prompt包含用户静态档案",
      `hasProfile=${lastAutonomousSystemPrompt.includes("Owner profile context") && lastAutonomousSystemPrompt.includes("TypeScript")}`,
      lastAutonomousSystemPrompt.includes("Owner profile context") && lastAutonomousSystemPrompt.includes("TypeScript"),
      "prompt-captured",
    );
    add(
      "M09",
      "自主循环",
      "prompt包含approved/rejected规则",
      `hasApproved=${lastAutonomousSystemPrompt.includes("Owner approved patterns")}, hasRejected=${lastAutonomousSystemPrompt.includes("Owner rejected patterns")}`,
      lastAutonomousSystemPrompt.includes("Owner approved patterns") && lastAutonomousSystemPrompt.includes("Owner rejected patterns"),
      "prompt-captured",
    );

    // M10
    await prisma.agentMemoryRule.deleteMany({
      where: { agentId: ownerAgent.id, polarity: "rejected" },
    });
    const legacyNote = `legacy fallback note ${runTag}`;
    await prisma.agent.update({
      where: { id: ownerAgent.id },
      data: { autonomousLearningNotes: legacyNote },
    });
    await createPeerPost("M10-legacy-fallback");
    await runAutonomousCycle(ownerAgent.id);
    add(
      "M10",
      "自主循环",
      "无结构化rejected规则时回退legacy notes",
      `hasLegacy=${lastAutonomousSystemPrompt.includes("Legacy owner feedback") && lastAutonomousSystemPrompt.includes(legacyNote)}`,
      lastAutonomousSystemPrompt.includes("Legacy owner feedback") && lastAutonomousSystemPrompt.includes(legacyNote),
      "prompt-captured",
    );

    // M11 + M12
    const cycleBefore = cycleSummaryCalls;
    await createPeerPost("M11-cycle-summary");
    await runAutonomousCycle(ownerAgent.id);
    const cycleAfter = cycleSummaryCalls;
    const cycleSummaryRules = await prisma.agentMemoryRule.count({
      where: { agentId: ownerAgent.id, source: "cycle_summary" },
    });
    add(
      "M11",
      "自主循环",
      "有动作时触发cycle总结学习",
      `calls=${cycleBefore}->${cycleAfter}, summaryRules=${cycleSummaryRules}`,
      cycleAfter > cycleBefore && cycleSummaryRules > 0,
      `summaryCalls=${cycleAfter}`,
    );

    const cycleBeforeNoAction = cycleSummaryCalls;
    await prisma.agent.update({
      where: { id: ownerAgent.id },
      data: {
        autonomousLastSeenPostAt: new Date(),
        autonomousLockUntil: null,
      },
    });
    const noActionRun = await runAutonomousCycle(ownerAgent.id);
    const cycleAfterNoAction = cycleSummaryCalls;
    add(
      "M12",
      "自主循环",
      "无动作不触发cycle总结学习",
      `runOk=${noActionRun.ok}, actions=${noActionRun.actions || 0}, summaryCalls=${cycleBeforeNoAction}->${cycleAfterNoAction}`,
      noActionRun.ok && (noActionRun.actions || 0) === 0 && cycleAfterNoAction === cycleBeforeNoAction,
      "no-new-posts",
    );

    // M13
    await prisma.user.update({
      where: { id: owner.id },
      data: {
        profileInterests: ["ManualInterest"],
        profileCurrentProjects: null,
        profileGithubUrl: null,
        profileLastSyncedAt: null,
      },
    });
    await syncGitHubProfileToUser({
      userId: owner.id,
      githubUser: {
        bio: "AI tooling, backend",
        company: "CodeBlog",
        blog: "https://example.com",
        html_url: "https://github.com/example",
      },
    });
    const afterGitHubSync = await prisma.user.findUnique({
      where: { id: owner.id },
      select: {
        profileInterests: true,
        profileCurrentProjects: true,
        profileGithubUrl: true,
      },
    });
    add(
      "M13",
      "档案同步",
      "GitHub轻量同步只填空字段",
      `interests=${afterGitHubSync?.profileInterests.join("|")}, projects=${Boolean(afterGitHubSync?.profileCurrentProjects)}, github=${afterGitHubSync?.profileGithubUrl}`,
      Boolean(afterGitHubSync)
        && afterGitHubSync!.profileInterests.includes("ManualInterest")
        && Boolean(afterGitHubSync!.profileCurrentProjects)
        && afterGitHubSync!.profileGithubUrl === "https://github.com/example",
      "syncGitHubProfileToUser",
    );

    // M14
    await prisma.user.update({
      where: { id: owner.id },
      data: {
        profileTechStack: [],
        profileInterests: ["KeepExistingInterest"],
        profileCurrentProjects: null,
        profileWritingStyle: null,
      },
    });
    await prisma.post.create({
      data: {
        title: `owner-profile-sync-post-${runTag}`,
        content: "I am building a TypeScript + PostgreSQL memory system for autonomous agents.",
        summary: "owner post for profile sync",
        tags: JSON.stringify(["typescript", "postgresql", "memory"]),
        language: "en",
        agentId: ownerAgent.id,
      },
    });
    const syncRes = await httpJson<{ ok?: boolean; updated_fields?: string[]; error?: string }>(
      "/api/v1/users/me/profile/sync",
      {
        method: "POST",
        cookie: ownerCookie,
      },
    );
    const syncedUser = await prisma.user.findUnique({
      where: { id: owner.id },
      select: {
        profileTechStack: true,
        profileInterests: true,
        profileCurrentProjects: true,
        profileWritingStyle: true,
      },
    });
    add(
      "M14",
      "档案同步",
      "posts同步仅补空字段",
      `status=${syncRes.status}, updated=${syncRes.data.updated_fields?.join("|") || ""}, techStack=${syncedUser?.profileTechStack.join("|") || ""}, interests=${syncedUser?.profileInterests.join("|") || ""}`,
      syncRes.status === 200
        && (syncRes.data.updated_fields || []).includes("tech_stack")
        && syncedUser!.profileInterests.includes("KeepExistingInterest"),
      "POST /api/v1/users/me/profile/sync",
    );

    // M15
    const patchProfile = await httpJson<{ profile?: { tech_stack?: string[]; writing_style?: string; github_url?: string } }>(
      "/api/v1/users/me/profile",
      {
        method: "PATCH",
        cookie: ownerCookie,
        body: {
          tech_stack: ["Node.js", "PostgreSQL"],
          interests: ["Platform", "Testing"],
          current_projects: "Memory system E2E",
          writing_style: "structured",
          github_url: "https://github.com/owner",
        },
      },
    );
    add(
      "M15",
      "设置页",
      "手动编辑档案可保存",
      `status=${patchProfile.status}, tech=${patchProfile.data.profile?.tech_stack?.join("|") || ""}, style=${patchProfile.data.profile?.writing_style || ""}`,
      patchProfile.status === 200
        && Boolean(patchProfile.data.profile?.tech_stack?.includes("Node.js"))
        && patchProfile.data.profile?.writing_style === "structured",
      "PATCH /api/v1/users/me/profile",
    );

    // M16
    const createRule = await httpJson<{ rule?: { id: string; text: string } }>(`/api/v1/agents/${ownerAgent.id}/memory`, {
      method: "POST",
      cookie: ownerCookie,
      body: { polarity: "approved", category: "behavior", text: `Manual memory ${runTag}` },
    });
    const ruleId = createRule.data.rule?.id || "";
    const patchRule = await httpJson<{ rule?: { text: string } }>(
      `/api/v1/agents/${ownerAgent.id}/memory/rules/${ruleId}`,
      {
        method: "PATCH",
        cookie: ownerCookie,
        body: { text: `Manual memory updated ${runTag}` },
      },
    );
    const deleteRule = await httpJson<{ ok?: boolean }>(
      `/api/v1/agents/${ownerAgent.id}/memory/rules/${ruleId}`,
      {
        method: "DELETE",
        cookie: ownerCookie,
      },
    );
    const listMemory = await httpJson<{ approved_rules?: Array<{ id: string }> }>(`/api/v1/agents/${ownerAgent.id}/memory`, {
      method: "GET",
      cookie: ownerCookie,
    });
    const existsAfterDelete = (listMemory.data.approved_rules || []).some((row) => row.id === ruleId);
    add(
      "M16",
      "设置页",
      "手动增删改规则可持久化",
      `create=${createRule.status}, patch=${patchRule.status}, delete=${deleteRule.status}, existsAfterDelete=${existsAfterDelete}`,
      createRule.status === 200 && patchRule.status === 200 && deleteRule.status === 200 && !existsAfterDelete,
      `ruleId=${ruleId}`,
    );

    // M17
    const legacy = await prisma.notification.create({
      data: {
        userId: owner.id,
        type: "agent_event",
        message: `legacy-notification-${runTag}`,
      },
    });
    const legacyReject = await httpJson<{ event_kind?: string }>(`/api/v1/notifications/${legacy.id}/review`, {
      method: "POST",
      cookie: ownerCookie,
      body: { action: "reject" },
    });
    const legacyUndo = await httpJson<{ action?: string }>(`/api/v1/notifications/${legacy.id}/review`, {
      method: "PATCH",
      cookie: ownerCookie,
    });
    add(
      "M17",
      "兼容性",
      "旧通知无agent字段也可审批",
      `reject=${legacyReject.status}, kind=${legacyReject.data.event_kind}, undo=${legacyUndo.status}`,
      legacyReject.status === 200 && legacyUndo.status === 200,
      `notification=${legacy.id}`,
    );

    const getPersona = async () => httpJson<{
      persona?: {
        preset: string;
        warmth: number;
        humor: number;
        directness: number;
        depth: number;
        challenge: number;
        mode: "shadow" | "live";
        confidence: number;
      };
    }>(`/api/v1/agents/${ownerAgent.id}/persona`, {
      method: "GET",
      cookie: ownerCookie,
    });

    // P01
    const patchPreset = await httpJson<{ persona?: { preset?: string } }>(`/api/v1/agents/${ownerAgent.id}/persona`, {
      method: "PATCH",
      cookie: ownerCookie,
      body: { preset: "elys-sharp" },
    });
    const personaAfterPreset = await getPersona();
    add(
      "P01",
      "数字分身风格",
      "预设保存并回显",
      `patch=${patchPreset.status}, preset=${personaAfterPreset.data.persona?.preset || ""}`,
      patchPreset.status === 200 && personaAfterPreset.data.persona?.preset === "elys-sharp",
      `agent=${ownerAgent.id}`,
    );

    // P02
    const patchBounded = await httpJson<{ persona?: { warmth?: number; humor?: number; directness?: number; depth?: number; challenge?: number } }>(
      `/api/v1/agents/${ownerAgent.id}/persona`,
      {
        method: "PATCH",
        cookie: ownerCookie,
        body: {
          warmth: 0,
          humor: 100,
          directness: 100,
          depth: 0,
          challenge: 50,
        },
      },
    );
    const patchOutOfRange = await httpJson<{ error?: string }>(`/api/v1/agents/${ownerAgent.id}/persona`, {
      method: "PATCH",
      cookie: ownerCookie,
      body: { warmth: 101 },
    });
    const personaAfterBound = await getPersona();
    add(
      "P02",
      "数字分身风格",
      "滑杆边界校验与持久化",
      `valid=${patchBounded.status}, invalid=${patchOutOfRange.status}, warmth=${personaAfterBound.data.persona?.warmth}, humor=${personaAfterBound.data.persona?.humor}`,
      patchBounded.status === 200
        && patchOutOfRange.status === 400
        && personaAfterBound.data.persona?.warmth === 0
        && personaAfterBound.data.persona?.humor === 100,
      `agent=${ownerAgent.id}`,
    );

    // P03
    await prisma.agent.update({
      where: { id: ownerAgent.id },
      data: { personaMode: "live", personaConfidence: 0.9 },
    });
    await createPeerPost("P03-persona-approve");
    await runAutonomousCycle(ownerAgent.id);
    const p03Notice = await prisma.notification.findFirst({
      where: {
        userId: owner.id,
        type: "agent_event",
        agentId: ownerAgent.id,
        agentEventKind: "content",
        commentId: { not: null },
      },
      orderBy: { createdAt: "desc" },
    });
    ensure(Boolean(p03Notice), "P03 notification missing");
    const p03Approve = await httpJson<{
      persona_delta_applied?: number;
      agent_style_confidence?: number;
    }>(`/api/v1/notifications/${p03Notice!.id}/review`, {
      method: "POST",
      cookie: ownerCookie,
      body: { action: "approve" },
    });
    const p03SignalCount = await prisma.agentPersonaSignal.count({
      where: { agentId: ownerAgent.id, signalType: "review_approve" },
    });
    add(
      "P03",
      "数字分身学习",
      "approve触发正向风格学习",
      `status=${p03Approve.status}, delta=${p03Approve.data.persona_delta_applied}, signals=${p03SignalCount}`,
      p03Approve.status === 200
        && (p03Approve.data.persona_delta_applied || 0) > 0
        && p03SignalCount > 0,
      `notification=${p03Notice!.id}`,
    );

    // P04
    await createPeerPost("P04-persona-reject");
    await runAutonomousCycle(ownerAgent.id);
    const p04Notice = await prisma.notification.findFirst({
      where: {
        userId: owner.id,
        type: "agent_event",
        agentId: ownerAgent.id,
        agentEventKind: "content",
        id: { notIn: [p03Notice!.id] },
        commentId: { not: null },
      },
      orderBy: { createdAt: "desc" },
    });
    ensure(Boolean(p04Notice), "P04 notification missing");
    const p04Before = await getPersona();
    const p04Reject = await httpJson<{ persona_delta_applied?: number }>(
      `/api/v1/notifications/${p04Notice!.id}/review`,
      {
        method: "POST",
        cookie: ownerCookie,
        body: { action: "reject", note: "too verbose" },
      },
    );
    const p04QuickFeedback = await httpJson<{ delta_applied?: number; confidence?: number }>(
      `/api/v1/agents/${ownerAgent.id}/persona/signals`,
      {
        method: "POST",
        cookie: ownerCookie,
        body: {
          signal_type: "too_verbose",
          notification_id: p04Notice!.id,
        },
      },
    );
    const p04After = await getPersona();
    add(
      "P04",
      "数字分身学习",
      "reject+快捷反馈触发负向学习",
      `reject=${p04Reject.status}, quick=${p04QuickFeedback.status}, delta=${p04QuickFeedback.data.delta_applied || 0}, directness=${p04Before.data.persona?.directness}->${p04After.data.persona?.directness}`,
      p04Reject.status === 200
        && (p04Reject.data.persona_delta_applied || 0) > 0
        && p04QuickFeedback.status === 200
        && (p04QuickFeedback.data.delta_applied || 0) > 0
        && (p04After.data.persona?.directness ?? 100) <= (p04Before.data.persona?.directness ?? 100),
      `notification=${p04Notice!.id}`,
    );

    // P05
    const p05Undo = await httpJson<{ persona_delta_applied?: number }>(`/api/v1/notifications/${p04Notice!.id}/review`, {
      method: "PATCH",
      cookie: ownerCookie,
    });
    const p05After = await getPersona();
    const p05UndoSignals = await prisma.agentPersonaSignal.count({
      where: { agentId: ownerAgent.id, signalType: "review_undo" },
    });
    add(
      "P05",
      "数字分身学习",
      "undo回滚上一条reject风格增量",
      `status=${p05Undo.status}, delta=${p05Undo.data.persona_delta_applied || 0}, directness=${p04After.data.persona?.directness}->${p05After.data.persona?.directness}, undoSignals=${p05UndoSignals}`,
      p05Undo.status === 200
        && (p05Undo.data.persona_delta_applied || 0) > 0
        && (p05After.data.persona?.directness ?? 0) >= (p04After.data.persona?.directness ?? 0)
        && p05UndoSignals > 0,
      `notification=${p04Notice!.id}`,
    );

    // P06
    await prisma.agent.update({
      where: { id: ownerAgent.id },
      data: { personaMode: "live", personaConfidence: 0.2 },
    });
    const p06PostId = await createPeerPost("P06-takeover");
    await runAutonomousCycle(ownerAgent.id);
    const p06CommentCount = await prisma.comment.count({
      where: { postId: p06PostId, agentId: ownerAgent.id },
    });
    const p06TakeoverNotice = await prisma.notification.findFirst({
      where: {
        userId: owner.id,
        type: "agent_event",
        agentId: ownerAgent.id,
        agentEventKind: "system",
        message: { contains: "Takeover required" },
      },
      orderBy: { createdAt: "desc" },
    });
    add(
      "P06",
      "风控接管",
      "低confidence触发takeover",
      `commentCount=${p06CommentCount}, takeoverNotice=${Boolean(p06TakeoverNotice)}`,
      p06CommentCount === 0 && Boolean(p06TakeoverNotice),
      `post=${p06PostId}`,
    );

    // P07
    await prisma.agent.update({
      where: { id: ownerAgent.id },
      data: { personaMode: "shadow", personaConfidence: 0.95 },
    });
    const p07PostId = await createPeerPost("P07-shadow");
    await runAutonomousCycle(ownerAgent.id);
    const p07Comment = await prisma.comment.findFirst({
      where: { postId: p07PostId, agentId: ownerAgent.id },
      orderBy: { createdAt: "desc" },
      select: { content: true },
    });
    const p07ShadowEvent = await prisma.agentActivityEvent.findFirst({
      where: {
        agentId: ownerAgent.id,
        type: "chat_action",
        payload: { contains: "\"mode\":\"shadow_compare\"" },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, payload: true },
    });
    add(
      "P07",
      "Shadow模式",
      "shadow只留痕并执行baseline",
      `comment=${p07Comment?.content || ""}, shadowEvent=${Boolean(p07ShadowEvent)}`,
      Boolean(p07ShadowEvent)
        && !Boolean(p07Comment?.content.includes("Persona twin comment")),
      `post=${p07PostId}`,
    );

    // P08
    await prisma.agent.update({
      where: { id: ownerAgent.id },
      data: { personaMode: "shadow", personaConfidence: 0.9 },
    });
    await prisma.agentActivityEvent.deleteMany({
      where: {
        agentId: ownerAgent.id,
        type: "chat_action",
        payload: { contains: "\"mode\":\"shadow_compare\"" },
      },
    });
    await prisma.agentPersonaSignal.deleteMany({
      where: {
        agentId: ownerAgent.id,
        signalType: { in: ["review_approve", "review_reject"] },
      },
    });
    const now = new Date();
    for (let i = 0; i < 32; i += 1) {
      await prisma.agentActivityEvent.create({
        data: {
          agentId: ownerAgent.id,
          userId: owner.id,
          type: "chat_action",
          payload: JSON.stringify({
            mode: "shadow_compare",
            comparable: true,
            persona_win: true,
            baseline_win: false,
            baseline_score: 2,
            persona_score: 4,
          }),
          createdAt: new Date(now.getTime() - i * 60_000),
        },
      });
    }
    for (let i = 0; i < 20; i += 1) {
      await prisma.agentPersonaSignal.create({
        data: {
          agentId: ownerAgent.id,
          signalType: "review_approve",
          direction: 1,
          dimensions: JSON.stringify(["directness"]),
          source: "review",
          createdAt: new Date(now.getTime() - i * 60_000),
        },
      });
    }
    await createPeerPost("P08-promote");
    await runAutonomousCycle(ownerAgent.id);
    const p08Agent = await prisma.agent.findUnique({
      where: { id: ownerAgent.id },
      select: { personaMode: true, personaLastPromotedAt: true },
    });
    const p08SnapshotCount = await prisma.agentPersonaSnapshot.count({
      where: { agentId: ownerAgent.id, source: "auto_promote" },
    });
    add(
      "P08",
      "晋级机制",
      "阈值达标自动晋级live",
      `mode=${p08Agent?.personaMode}, promotedAt=${Boolean(p08Agent?.personaLastPromotedAt)}, snapshots=${p08SnapshotCount}`,
      p08Agent?.personaMode === "live"
        && Boolean(p08Agent?.personaLastPromotedAt)
        && p08SnapshotCount > 0,
      `agent=${ownerAgent.id}`,
    );

    // P09
    await prisma.agent.update({
      where: { id: ownerAgent.id },
      data: {
        personaMode: "live",
        personaConfidence: 0.85,
        personaWarmth: 80,
        personaHumor: 60,
        personaDirectness: 70,
        personaDepth: 75,
        personaChallenge: 55,
      },
    });
    const p09ManualSnapshot = await httpJson<{ persona?: { mode?: string } }>(
      `/api/v1/agents/${ownerAgent.id}/persona`,
      {
        method: "PATCH",
        cookie: ownerCookie,
        body: {
          mode: "live",
          preset: "elys-balanced",
          warmth: 80,
          humor: 60,
          directness: 70,
          depth: 75,
          challenge: 55,
        },
      },
    );
    await prisma.agent.update({
      where: { id: ownerAgent.id },
      data: {
        personaMode: "live",
        personaWarmth: 20,
        personaHumor: 5,
        personaDirectness: 95,
        personaDepth: 15,
        personaChallenge: 90,
      },
    });
    await prisma.agentPersonaSignal.deleteMany({
      where: {
        agentId: ownerAgent.id,
        signalType: { in: ["review_approve", "review_reject"] },
      },
    });
    for (let i = 0; i < 5; i += 1) {
      await prisma.agentPersonaSignal.create({
        data: {
          agentId: ownerAgent.id,
          signalType: "review_reject",
          direction: -1,
          dimensions: JSON.stringify(["directness", "challenge"]),
          source: "review",
          createdAt: new Date(Date.now() - i * 30_000),
        },
      });
    }
    await createPeerPost("P09-rollback");
    await runAutonomousCycle(ownerAgent.id);
    const p09Agent = await prisma.agent.findUnique({
      where: { id: ownerAgent.id },
      select: { personaMode: true, personaWarmth: true, personaHumor: true },
    });
    const p09RollbackSnapshots = await prisma.agentPersonaSnapshot.count({
      where: { agentId: ownerAgent.id, source: "auto_rollback" },
    });
    add(
      "P09",
      "回滚机制",
      "live退化自动回滚shadow",
      `manualPatch=${p09ManualSnapshot.status}, mode=${p09Agent?.personaMode}, warmth=${p09Agent?.personaWarmth}, humor=${p09Agent?.personaHumor}, rollbackSnapshots=${p09RollbackSnapshots}`,
      p09ManualSnapshot.status === 200
        && p09Agent?.personaMode === "shadow"
        && p09RollbackSnapshots > 0,
      `agent=${ownerAgent.id}`,
    );

    // P10
    const p10Legacy = await prisma.notification.create({
      data: {
        userId: owner.id,
        type: "agent_event",
        message: `legacy-p10-${runTag}`,
      },
    });
    const p10List = await httpJson<{ notifications?: Array<{ id: string; event_kind?: string; agent_style_confidence?: number | null; agent_persona_mode?: string | null }> }>(
      "/api/v1/notifications?limit=50",
      {
        method: "GET",
        cookie: ownerCookie,
      },
    );
    const p10Row = (p10List.data.notifications || []).find((row) => row.id === p10Legacy.id);
    const p10Approve = await httpJson<{ event_kind?: string }>(`/api/v1/notifications/${p10Legacy.id}/review`, {
      method: "POST",
      cookie: ownerCookie,
      body: { action: "approve" },
    });
    add(
      "P10",
      "兼容性",
      "旧通知与persona字段兼容",
      `list=${p10List.status}, rowKind=${p10Row?.event_kind}, style=${p10Row?.agent_style_confidence}, mode=${p10Row?.agent_persona_mode}, approve=${p10Approve.status}`,
      p10List.status === 200
        && Boolean(p10Row)
        && p10Approve.status === 200,
      `notification=${p10Legacy.id}`,
    );
  } catch (error) {
    console.error("issue39 e2e failed:", error);
    add("GLOBAL", "执行", "脚本完整执行", `error=${error instanceof Error ? error.message : String(error)}`, false, "fatal");
  } finally {
    try {
      for (const userId of cleanupIds) {
        await prisma.user.delete({ where: { id: userId } }).catch(() => {});
      }
    } catch {
      // ignore cleanup errors
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));

    const reportDir = join(process.cwd(), "reports", "issue39");
    if (!existsSync(reportDir)) {
      mkdirSync(reportDir, { recursive: true });
    }
    const csvPath = join(reportDir, "acceptance.csv");
    const mdPath = join(reportDir, "e2e-report.md");
    writeFileSync(csvPath, toCsv(rows), "utf8");
    writeFileSync(mdPath, toMarkdown(rows), "utf8");

    const failed = rows.filter((row) => row.通过失败 === "失败");
    console.log(`Issue39 memory e2e finished: total=${rows.length}, failed=${failed.length}`);
    if (failed.length > 0) {
      process.exitCode = 1;
    }
  }
}

void main();
