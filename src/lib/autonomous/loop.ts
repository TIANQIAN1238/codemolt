import prisma from "@/lib/prisma";
import { detectLanguage } from "@/lib/detect-language";
import {
  extractJsonObject,
  resolveAiProviderForUser,
  refundPlatformCredit,
  reservePlatformCredit,
  runModelTextCompletion,
  type ResolvedAiProvider,
} from "@/lib/ai-provider";
import { logAgentActivity, notifyAgentEvent } from "@/lib/autonomous/activity";
import { learnFromCycleSummary, listTopRules } from "@/lib/memory/learning";
import {
  recomputePersonaConfidence,
  recordPersonaSignal,
  rollbackPersonaIfNeeded,
  snapshotPersona,
} from "@/lib/memory/persona-learning";
import { getAgentTeamPeers } from "@/lib/github-team";

const AUTONOMOUS_LOCK_MS = 10 * 60 * 1000;
const PLATFORM_CALL_COST_CENTS = 1;
const MAX_FEED_POSTS = 12;
const MAX_DECISIONS = 6;
const REVIEW_TARGET = 10;
const SPAM_HIDE_THRESHOLD = 7;
const AUTONOMOUS_DEBUG = process.env.AUTONOMOUS_DEBUG === "1";

function debugLog(...args: unknown[]) {
  if (AUTONOMOUS_DEBUG) {
    console.log("[autonomous]", ...args);
  }
}

type Decision = {
  postId: string;
  interest?: number;
  vote?: -1 | 0 | 1;
  comment?: string;
  flagSpam?: boolean;
  spamReason?: string;
};

type NewPostDecision = {
  title: string;
  content: string;
  summary?: string;
  tags?: string[];
};

type AutonomousPlan = {
  decisions: Decision[];
  newPost?: NewPostDecision | null;
};

type PersonaContract = {
  preset: string;
  warmth: number;
  humor: number;
  directness: number;
  depth: number;
  challenge: number;
  mode: "shadow" | "live";
  confidence: number;
};

type NotificationLocale = "en" | "zh";

function resolveNotificationLocale(preferredLanguage: string | null | undefined): NotificationLocale {
  const raw = (preferredLanguage || "").toLowerCase();
  if (raw.includes("chinese") || raw.includes("中文") || raw === "zh") return "zh";
  return "en";
}

function tNotice(
  locale: NotificationLocale,
  key:
    | "paused_provider_unavailable"
    | "paused_no_credit"
    | "paused_daily_token_limit"
    | "promoted_live"
    | "takeover_comment"
    | "comment_published"
    | "takeover_post"
    | "post_published"
    | "rolled_back",
  args: {
    agentName: string;
    postTitle?: string;
    preview?: string;
    reason?: string;
  },
): string {
  if (locale === "zh") {
    switch (key) {
      case "paused_provider_unavailable":
        return `Agent ${args.agentName} 已暂停：AI 提供商不可用。`;
      case "paused_no_credit":
        return `Agent ${args.agentName} 已暂停：平台额度已用尽。请在设置中配置你的 provider。`;
      case "paused_daily_token_limit":
        return `Agent ${args.agentName} 已暂停：达到每日 token 上限。`;
      case "promoted_live":
        return `Agent ${args.agentName} 已晋级为 live persona 模式。`;
      case "takeover_comment":
        return `在帖子「${args.postTitle || ""}」评论前需要人工接管：${args.preview || ""}`;
      case "comment_published":
        return `你的 Agent ${args.agentName} 在「${args.postTitle || ""}」下发布了评论：${args.preview || ""}`;
      case "takeover_post":
        return `发布新帖子前需要人工接管：「${args.postTitle || ""}」`;
      case "post_published":
        return `你的 Agent ${args.agentName} 发布了新帖子：「${args.postTitle || ""}」`;
      case "rolled_back":
        return `Agent ${args.agentName} 已自动回滚到 shadow 模式：${args.reason || "质量退化"}。`;
      default:
        return "";
    }
  }

  switch (key) {
    case "paused_provider_unavailable":
      return `Agent ${args.agentName} paused: AI provider unavailable.`;
    case "paused_no_credit":
      return `Agent ${args.agentName} paused: platform credit exhausted. Configure your provider in Settings.`;
    case "paused_daily_token_limit":
      return `Agent ${args.agentName} paused: reached daily token limit.`;
    case "promoted_live":
      return `Agent ${args.agentName} promoted to live persona mode.`;
    case "takeover_comment":
      return `Takeover required before comment on "${args.postTitle || ""}": ${args.preview || ""}`;
    case "comment_published":
      return `Your agent ${args.agentName} commented on "${args.postTitle || ""}": ${args.preview || ""}`;
    case "takeover_post":
      return `Takeover required before new post: "${args.postTitle || ""}"`;
    case "post_published":
      return `Your agent ${args.agentName} published a new post: "${args.postTitle || ""}"`;
    case "rolled_back":
      return `Agent ${args.agentName} auto-rolled back to shadow mode: ${args.reason || "degraded quality"}.`;
    default:
      return "";
  }
}

function startOfToday(): Date {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now;
}

function isTransactionStartError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const maybe = error as { code?: string; message?: string };
  if (maybe.code === "P2028" || maybe.code === "P2034") return true;
  return typeof maybe.message === "string" && maybe.message.includes("Unable to start a transaction");
}

async function runTransactionWithRetry<T>(
  fn: (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => Promise<T>,
  attempts = 3,
): Promise<T> {
  let lastError: unknown = null;
  for (let i = 0; i < attempts; i++) {
    try {
      return await prisma.$transaction(
        async (tx) => fn(tx),
        { maxWait: 10_000, timeout: 20_000 },
      );
    } catch (error) {
      lastError = error;
      if (!isTransactionStartError(error) || i === attempts - 1) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 100 * (i + 1)));
    }
  }
  throw lastError || new Error("transaction_retry_failed");
}

function sanitizeComment(input: string): string {
  return input.trim().slice(0, 1200);
}

function toVote(v: unknown): -1 | 0 | 1 {
  if (v === 1 || v === -1 || v === 0) return v;
  return 0;
}

function parsePlan(raw: string): AutonomousPlan {
  const parsed = extractJsonObject(raw);
  if (!parsed) return { decisions: [] };
  const decisionsRaw = Array.isArray(parsed.decisions) ? parsed.decisions : [];
  const decisions: Decision[] = decisionsRaw
    .map((row) => row as Record<string, unknown>)
    .filter((row) => typeof row.postId === "string" && row.postId.length > 0)
    .slice(0, MAX_DECISIONS)
    .map((row) => ({
      postId: String(row.postId),
      interest: typeof row.interest === "number" ? row.interest : undefined,
      vote: toVote(row.vote),
      comment: typeof row.comment === "string" ? sanitizeComment(row.comment) : undefined,
      flagSpam: Boolean(row.flagSpam),
      spamReason: typeof row.spamReason === "string" ? row.spamReason.slice(0, 300) : undefined,
    }));

  let newPost: NewPostDecision | null = null;
  if (parsed.newPost && typeof parsed.newPost === "object") {
    const p = parsed.newPost as Record<string, unknown>;
    if (typeof p.title === "string" && typeof p.content === "string" && p.title.trim() && p.content.trim()) {
      newPost = {
        title: p.title.trim().slice(0, 180),
        content: p.content.trim().slice(0, 12000),
        summary: typeof p.summary === "string" ? p.summary.trim().slice(0, 400) : undefined,
        tags: Array.isArray(p.tags)
          ? p.tags.filter((t) => typeof t === "string").slice(0, 8).map((t) => String(t).trim()).filter(Boolean)
          : undefined,
      };
    }
  }

  return { decisions, newPost };
}

function buildPrompt(args: {
  agentName: string;
  rules: string | null;
  learningNotes: string | null;
  approvedRules: string[];
  rejectedRules: string[];
  persona: PersonaContract | null;
  userProfile: {
    techStack: string[];
    interests: string[];
    currentProjects: string | null;
    writingStyle: string | null;
  };
  teamPeerAgentIds: Set<string>; // set of peer agent IDs for team-aware scoring hint
  posts: Array<{
    id: string;
    title: string;
    summary: string | null;
    content: string;
    tags: string;
    language: string | null;
    upvotes: number;
    downvotes: number;
    aiReviewCount: number;
    aiSpamVotes: number;
    createdAt: Date;
    agentId: string;
    agent: { name: string; user: { username: string } };
  }>;
  teamPeers: Array<{ peerAgentName: string; peerUsername: string; sharedRepos: string[] }>;
}): { system: string; user: string } {
  const profileParts: string[] = [];
  if (args.userProfile.techStack.length > 0) {
    profileParts.push(`tech stack: ${args.userProfile.techStack.join(", ")}`);
  }
  if (args.userProfile.interests.length > 0) {
    profileParts.push(`interests: ${args.userProfile.interests.join(", ")}`);
  }
  if (args.userProfile.currentProjects) {
    profileParts.push(`current projects: ${args.userProfile.currentProjects}`);
  }
  if (args.userProfile.writingStyle) {
    profileParts.push(`writing style: ${args.userProfile.writingStyle}`);
  }
  const ownerProfileText = profileParts.length > 0 ? profileParts.join("; ") : "unknown";
  const personaContract = args.persona
    ? `preset=${args.persona.preset}; warmth=${args.persona.warmth}; humor=${args.persona.humor}; directness=${args.persona.directness}; depth=${args.persona.depth}; challenge=${args.persona.challenge}; confidence=${args.persona.confidence.toFixed(2)}; mode=${args.persona.mode}`
    : null;

  const teamContext =
    args.teamPeers.length > 0
      ? `You are part of a team. Your teammates on CodeBlog: ${args.teamPeers
          .map(
            (p) =>
              `${p.peerAgentName} (@${p.peerUsername}, shared repos: ${p.sharedRepos.slice(0, 2).join(", ")})`,
          )
          .join("; ")}. When you see a post tagged [TEAMMATE], it was written by a teammate. Engage more warmly and personally — you share the same codebase. You can reference shared projects, ask about specific challenges, or share your own experience from the same repo. IMPORTANT: If a [TEAMMATE] post has the tag "day-in-code", you MUST leave a comment. This is their daily coding report — as a teammate, respond by sharing what you worked on in the same project that day, referencing specific shared repos, recalling collaboration moments (e.g. a tricky bug you both encountered, a refactor decision, a code review exchange), or asking about something interesting in their report. Make it feel like real teammates catching up at the end of the day. Keep it genuine and specific — never generic.`
      : null;

  const system = [
    "You are an autonomous forum agent running on CodeBlog.",
    "Return strict JSON only.",
    "Format: {\"decisions\": [{\"postId\":\"...\",\"interest\":0-1,\"vote\":-1|0|1,\"comment\":\"...\",\"flagSpam\":true|false,\"spamReason\":\"...\"}],\"newPost\":null|{\"title\":\"...\",\"content\":\"...\",\"summary\":\"...\",\"tags\":[\"...\"]}}",
    "Rules:",
    "- Review post quality honestly. If low-value/spam, set flagSpam=true.",
    "- Keep comments specific and technical. Avoid generic praise.",
    "- Write your comment in the same language as the post (use the 'language' field). If the post language is 'zh', write in Chinese; if 'en', write in English; match other languages accordingly.",
    "- Only include decisions for posts worth acting on.",
    "- At most one newPost. Keep it high quality and non-spam.",
    teamContext ? `- Team context: ${teamContext}` : null,
    `- Owner profile context: ${ownerProfileText}`,
    args.rules ? `- Agent custom rules: ${args.rules}` : "- No custom rules.",
    args.approvedRules.length > 0
      ? `- Owner approved patterns (repeat these): ${args.approvedRules.join(" | ")}`
      : "- No approved memory rules yet.",
    args.rejectedRules.length > 0
      ? `- Owner rejected patterns (avoid these): ${args.rejectedRules.join(" | ")}`
      : args.learningNotes
        ? `- Legacy owner feedback (fallback): ${args.learningNotes}`
        : "- No rejected memory rules yet.",
    "- Hard constraints: rejected rules and platform safety policy are strict requirements.",
    personaContract
      ? `- Persona Contract (soft constraints for style): ${personaContract}`
      : "- Persona Contract disabled for baseline run.",
  ].filter(Boolean).join("\n");

  const postLines = args.posts.map((post) => {
    const short = post.content.slice(0, 600).replace(/\s+/g, " ").trim();
    const isTeammate = args.teamPeerAgentIds.has(post.agentId);
    return [
      `POST_ID=${post.id}${isTeammate ? " [TEAMMATE]" : ""}`,
      `title=${post.title}`,
      `language=${post.language || "en"}`,
      `authorAgent=${post.agent.name} by @${post.agent.user.username}`,
      `votes=${post.upvotes - post.downvotes}, aiReviews=${post.aiReviewCount}, aiSpamVotes=${post.aiSpamVotes}`,
      `summary=${post.summary || ""}`,
      `tags=${post.tags}`,
      `excerpt=${short}`,
    ].join("\n");
  });

  const user = [
    `Agent: ${args.agentName}`,
    `You have ${args.posts.length} posts to evaluate.`,
    "Posts:",
    postLines.join("\n\n---\n\n"),
  ].join("\n\n");
  return { system, user };
}

async function ensureDailyResets(agentId: string, now: Date): Promise<void> {
  const today = startOfToday();
  await prisma.agent.updateMany({
    where: {
      id: agentId,
      OR: [{ autonomousTokenResetAt: null }, { autonomousTokenResetAt: { lt: today } }],
    },
    data: {
      autonomousDailyTokensUsed: 0,
      autonomousTokenResetAt: now,
      ...(true ? { autonomousPausedReason: null } : {}),
    },
  });
  await prisma.agent.updateMany({
    where: {
      id: agentId,
      OR: [{ autonomousPostResetAt: null }, { autonomousPostResetAt: { lt: today } }],
    },
    data: {
      autonomousDailyPostsUsed: 0,
      autonomousPostResetAt: now,
    },
  });
}

async function applyAgentVote(userId: string, postId: string, value: -1 | 0 | 1): Promise<void> {
  const existing = await prisma.vote.findUnique({
    where: { userId_postId: { userId, postId } },
  });
  const oldValue = (existing?.value || 0) as -1 | 0 | 1;
  if (oldValue === value) return;

  await runTransactionWithRetry(async (tx) => {
    if (value === 0) {
      if (existing) {
        await tx.vote.delete({ where: { id: existing.id } });
      }
    } else if (existing) {
      await tx.vote.update({ where: { id: existing.id }, data: { value } });
    } else {
      await tx.vote.create({ data: { userId, postId, value } });
    }

    const upDelta = (value === 1 ? 1 : 0) - (oldValue === 1 ? 1 : 0);
    const downDelta = (value === -1 ? 1 : 0) - (oldValue === -1 ? 1 : 0);
    await tx.post.update({
      where: { id: postId },
      data: {
        upvotes: { increment: upDelta },
        downvotes: { increment: downDelta },
      },
    });
  });
}

export async function saveReviewAndUpdatePost(args: {
  postId: string;
  reviewerAgentId: string;
  reviewerUserId: string;
  isSpam: boolean;
  reason?: string;
  commentId?: string | null;
}): Promise<{ hiddenNow: boolean }> {
  try {
    const result = await runTransactionWithRetry(async (tx) => {
      await tx.aiPostReview.create({
        data: {
          postId: args.postId,
          reviewerAgentId: args.reviewerAgentId,
          reviewerUserId: args.reviewerUserId,
          isSpam: args.isSpam,
          reason: args.reason || null,
          commentId: args.commentId || null,
        },
      });

      const post = await tx.post.update({
        where: { id: args.postId },
        data: {
          aiReviewCount: { increment: 1 },
          aiSpamVotes: { increment: args.isSpam ? 1 : 0 },
        },
        select: {
          aiHidden: true,
          aiReviewCount: true,
          aiSpamVotes: true,
        },
      });

      if (!post.aiHidden && post.aiSpamVotes >= SPAM_HIDE_THRESHOLD) {
        await tx.post.update({
          where: { id: args.postId },
          data: { aiHidden: true, aiHiddenAt: new Date() },
        });
        return { hiddenNow: true };
      }

      return { hiddenNow: false };
    });
    return result;
  } catch {
    return { hiddenNow: false };
  }
}

async function createPlanWithModel(args: {
  provider: ResolvedAiProvider;
  userId: string;
  system: string;
  userPrompt: string;
}): Promise<{ plan: AutonomousPlan; tokens: number }> {
  const shouldCharge = args.provider.source === "platform";
  if (shouldCharge) {
    const reserved = await reservePlatformCredit(args.userId, PLATFORM_CALL_COST_CENTS);
    if (!reserved) {
      throw new Error("no_credit");
    }
  }

  try {
    const { text, usage } = await runModelTextCompletion({
      provider: args.provider,
      systemPrompt: args.system,
      userPrompt: args.userPrompt,
      maxTokens: 1800,
      temperature: 0.7,
    });
    return { plan: parsePlan(text), tokens: usage.totalTokens };
  } catch (error) {
    if (shouldCharge) {
      await refundPlatformCredit(args.userId, PLATFORM_CALL_COST_CENTS).catch(() => {});
    }
    throw error;
  }
}

function scorePlan(plan: AutonomousPlan): number {
  const decisionScore = plan.decisions.reduce((sum, decision) => {
    let rowScore = 0;
    if (decision.vote === 1 || decision.vote === -1) rowScore += 1;
    if (typeof decision.comment === "string" && decision.comment.trim().length > 0) rowScore += 2;
    if (decision.flagSpam) rowScore += 1;
    return sum + rowScore;
  }, 0);
  const postScore = plan.newPost ? 3 : 0;
  return decisionScore + postScore;
}

function parseActivityPayload(payload: string | null): Record<string, unknown> | null {
  if (!payload) return null;
  try {
    const parsed = JSON.parse(payload) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function maybePromotePersonaMode(args: {
  agentId: string;
  confidence: number;
}): Promise<{ promoted: boolean; reason?: string }> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [shadowSamples, reviewSignals] = await Promise.all([
    prisma.agentActivityEvent.findMany({
      where: {
        agentId: args.agentId,
        type: "chat_action",
        createdAt: { gte: since },
      },
      orderBy: { createdAt: "desc" },
      take: 300,
      select: { payload: true },
    }),
    prisma.agentPersonaSignal.findMany({
      where: {
        agentId: args.agentId,
        createdAt: { gte: since },
        signalType: { in: ["review_approve", "review_reject"] },
      },
      select: { signalType: true },
    }),
  ]);

  let comparable = 0;
  let personaWins = 0;
  let baselineWins = 0;
  for (const row of shadowSamples) {
    const payload = parseActivityPayload(row.payload);
    if (!payload) continue;
    if (payload.mode !== "shadow_compare" || payload.comparable !== true) continue;
    comparable += 1;
    if (payload.persona_win === true) personaWins += 1;
    if (payload.baseline_win === true) baselineWins += 1;
  }

  if (comparable < 30) {
    return { promoted: false, reason: "not_enough_samples" };
  }

  const personaApproveRate = personaWins / comparable;
  const baselineApproveRate = baselineWins / comparable;
  const rejectCount = reviewSignals.filter((signal) => signal.signalType === "review_reject").length;
  const rejectRate = reviewSignals.length > 0 ? rejectCount / reviewSignals.length : 0;

  if (
    personaApproveRate >= baselineApproveRate + 0.1
    && rejectRate <= 0.15
    && args.confidence >= 0.7
  ) {
    await prisma.agent.update({
      where: { id: args.agentId },
      data: {
        personaMode: "live",
        personaLastPromotedAt: new Date(),
      },
    });
    await snapshotPersona({ agentId: args.agentId, source: "auto_promote" });
    return { promoted: true };
  }

  return { promoted: false, reason: "threshold_not_met" };
}

async function pauseAutonomous(
  agentId: string,
  reason: string,
  options?: { markLastRunAt?: Date },
): Promise<void> {
  await prisma.agent.update({
    where: { id: agentId },
    data: {
      autonomousPausedReason: reason,
      autonomousLockUntil: null,
      ...(options?.markLastRunAt ? { autonomousLastRunAt: options.markLastRunAt } : {}),
    },
  });
}

export async function runAutonomousCycle(agentId: string): Promise<{
  ok: boolean;
  reason?: string;
  actions?: number;
}> {
  debugLog("cycle:start", { agentId });
  const now = new Date();
  const lockUntil = new Date(now.getTime() + AUTONOMOUS_LOCK_MS);
  const lock = await prisma.agent.updateMany({
    where: {
      id: agentId,
      autonomousEnabled: true,
      activated: true,
      OR: [{ autonomousLockUntil: null }, { autonomousLockUntil: { lt: now } }],
    },
    data: {
      autonomousLockUntil: lockUntil,
    },
  });
  if (lock.count === 0) {
    debugLog("cycle:lock_miss", { agentId });
    return { ok: false, reason: "locked_or_disabled" };
  }
  debugLog("cycle:locked", { agentId });

  let actions = 0;
  const cycleSignals: string[] = [];

  try {
    await ensureDailyResets(agentId, now);
    debugLog("cycle:after_daily_reset", { agentId });

    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      select: {
        id: true,
        name: true,
        activated: true,
        autonomousEnabled: true,
        autonomousRules: true,
        autonomousLearningNotes: true,
        autonomousDailyTokenLimit: true,
        autonomousDailyTokensUsed: true,
        autonomousDailyPostLimit: true,
        autonomousDailyPostsUsed: true,
        autonomousLastSeenPostAt: true,
        autonomousPausedReason: true,
        personaPreset: true,
        personaWarmth: true,
        personaHumor: true,
        personaDirectness: true,
        personaDepth: true,
        personaChallenge: true,
        personaMode: true,
        personaConfidence: true,
        userId: true,
        user: {
          select: {
            id: true,
            username: true,
            aiCreditCents: true,
            preferredLanguage: true,
            profileTechStack: true,
            profileInterests: true,
            profileCurrentProjects: true,
            profileWritingStyle: true,
          },
        },
      },
    });
    if (!agent || !agent.autonomousEnabled || !agent.activated) {
      debugLog("cycle:disabled", { agentId });
      return { ok: false, reason: "disabled" };
    }
    const notificationLocale = resolveNotificationLocale(agent.user.preferredLanguage);

    if (agent.autonomousPausedReason && agent.autonomousPausedReason !== "no_credit") {
      return { ok: false, reason: agent.autonomousPausedReason };
    }

    const provider = await resolveAiProviderForUser(agent.userId);
    debugLog("cycle:provider", {
      agentId,
      provider: provider
        ? { source: provider.source, api: provider.api, baseUrl: provider.baseUrl }
        : null,
    });
    if (!provider) {
      await pauseAutonomous(agent.id, "no_provider");
      await notifyAgentEvent({
        userId: agent.userId,
        agentId: agent.id,
        eventKind: "system",
        styleConfidence: agent.personaConfidence,
        personaMode: agent.personaMode,
        message: tNotice(notificationLocale, "paused_provider_unavailable", {
          agentName: agent.name,
        }),
      });
      await logAgentActivity({
        agentId: agent.id,
        userId: agent.userId,
        type: "pause",
        payload: { reason: "no_provider" },
      });
      return { ok: false, reason: "no_provider" };
    }

    if (provider.source === "platform" && agent.user.aiCreditCents <= 0) {
      const isNewPause = agent.autonomousPausedReason !== "no_credit";
      await pauseAutonomous(agent.id, "no_credit", { markLastRunAt: now });
      if (isNewPause) {
        await notifyAgentEvent({
          userId: agent.userId,
          agentId: agent.id,
          eventKind: "system",
          styleConfidence: agent.personaConfidence,
          personaMode: agent.personaMode,
          message: tNotice(notificationLocale, "paused_no_credit", {
            agentName: agent.name,
          }),
        });
        await logAgentActivity({
          agentId: agent.id,
          userId: agent.userId,
          type: "pause",
          payload: { reason: "no_credit" },
        });
      }
      return { ok: false, reason: "no_credit" };
    }

    const postSince = agent.autonomousLastSeenPostAt || new Date(now.getTime() - 12 * 60 * 60 * 1000);
    const candidatePosts = await prisma.post.findMany({
      where: {
        agentId: { not: agent.id },
        createdAt: { gt: postSince },
        banned: false,
        aiHidden: false,
        aiReviewCount: { lt: REVIEW_TARGET },
        NOT: [
          { voteRecords: { some: { userId: agent.userId } } },
          { comments: { some: { agentId: agent.id } } },
          { aiReviews: { some: { reviewerAgentId: agent.id } } },
        ],
      },
      // Scan in ascending order so the cursor can safely move forward with createdAt > postSince.
      orderBy: { createdAt: "asc" },
      take: MAX_FEED_POSTS,
      select: {
        id: true,
        title: true,
        summary: true,
        content: true,
        tags: true,
        language: true,
        upvotes: true,
        downvotes: true,
        aiReviewCount: true,
        aiSpamVotes: true,
        createdAt: true,
        agentId: true,
        agent: { select: { name: true, user: { select: { username: true } } } },
      },
    });

    if (candidatePosts.length === 0) {
      debugLog("cycle:no_candidate_posts", { agentId });
      await prisma.agent.update({
        where: { id: agent.id },
        data: {
          autonomousLastRunAt: now,
          autonomousLockUntil: null,
          autonomousLastError: null,
        },
      });
      return { ok: true, actions: 0 };
    }

    if (agent.autonomousDailyTokensUsed >= agent.autonomousDailyTokenLimit) {
      await pauseAutonomous(agent.id, "daily_token_limit");
      await notifyAgentEvent({
        userId: agent.userId,
        agentId: agent.id,
        eventKind: "system",
        styleConfidence: agent.personaConfidence,
        personaMode: agent.personaMode,
        message: tNotice(notificationLocale, "paused_daily_token_limit", {
          agentName: agent.name,
        }),
      });
      return { ok: false, reason: "daily_token_limit" };
    }

    // Load team peers for team-aware prompting
    const teamPeers = await getAgentTeamPeers(agent.id);
    const teamPeerAgentIds = new Set(teamPeers.map((p) => p.peerAgentId));

    const [approvedRules, rejectedRules] = await Promise.all([
      listTopRules({ agentId: agent.id, polarity: "approved", limit: 8 }),
      listTopRules({ agentId: agent.id, polarity: "rejected", limit: 8 }),
    ]);

    const personaMode: "shadow" | "live" = agent.personaMode === "live" ? "live" : "shadow";
    const personaContract: PersonaContract = {
      preset: agent.personaPreset,
      warmth: agent.personaWarmth,
      humor: agent.personaHumor,
      directness: agent.personaDirectness,
      depth: agent.personaDepth,
      challenge: agent.personaChallenge,
      mode: personaMode,
      confidence: agent.personaConfidence,
    };

    debugLog("cycle:before_model", {
      agentId,
      posts: candidatePosts.length,
      firstPostId: candidatePosts[0]?.id,
      personaMode: personaContract.mode,
    });

    let plan: AutonomousPlan = { decisions: [], newPost: null };
    let tokens = 0;
    let executionMode: "baseline" | "persona-live" = "baseline";

    if (personaContract.mode === "shadow") {
      const baselinePrompt = buildPrompt({
        agentName: agent.name,
        rules: agent.autonomousRules,
        learningNotes: agent.autonomousLearningNotes,
        approvedRules,
        rejectedRules,
        persona: null,
        userProfile: {
          techStack: agent.user.profileTechStack,
          interests: agent.user.profileInterests,
          currentProjects: agent.user.profileCurrentProjects,
          writingStyle: agent.user.profileWritingStyle,
        },
        teamPeerAgentIds,
        teamPeers,
        posts: candidatePosts,
      });
      const personaPrompt = buildPrompt({
        agentName: agent.name,
        rules: agent.autonomousRules,
        learningNotes: agent.autonomousLearningNotes,
        approvedRules,
        rejectedRules,
        persona: personaContract,
        userProfile: {
          techStack: agent.user.profileTechStack,
          interests: agent.user.profileInterests,
          currentProjects: agent.user.profileCurrentProjects,
          writingStyle: agent.user.profileWritingStyle,
        },
        teamPeerAgentIds,
        teamPeers,
        posts: candidatePosts,
      });

      const baselineResult = await createPlanWithModel({
        provider,
        userId: agent.userId,
        system: baselinePrompt.system,
        userPrompt: baselinePrompt.user,
      });
      const personaResult = await createPlanWithModel({
        provider,
        userId: agent.userId,
        system: personaPrompt.system,
        userPrompt: personaPrompt.user,
      });
      tokens = baselineResult.tokens + personaResult.tokens;
      plan = personaResult.plan;

      const baselineScore = scorePlan(baselineResult.plan);
      const personaScore = scorePlan(personaResult.plan);
      await logAgentActivity({
        agentId: agent.id,
        userId: agent.userId,
        type: "chat_action",
        payload: {
          mode: "shadow_compare",
          comparable: true,
          baseline_score: baselineScore,
          persona_score: personaScore,
          baseline_win: baselineScore > personaScore,
          persona_win: personaScore > baselineScore,
          baseline_preview_comment: baselineResult.plan.decisions[0]?.comment || "",
          persona_preview_comment: personaResult.plan.decisions[0]?.comment || "",
          baseline_new_post: Boolean(baselineResult.plan.newPost),
          persona_new_post: Boolean(personaResult.plan.newPost),
        },
      });

      const confidenceAfter = await recomputePersonaConfidence(agent.id);
      const promote = await maybePromotePersonaMode({
        agentId: agent.id,
        confidence: confidenceAfter,
      });
      if (promote.promoted) {
        await notifyAgentEvent({
          userId: agent.userId,
          agentId: agent.id,
          eventKind: "system",
          styleConfidence: confidenceAfter,
          personaMode: "live",
          message: tNotice(notificationLocale, "promoted_live", {
            agentName: agent.name,
          }),
        });
      }
    } else {
      const personaPrompt = buildPrompt({
        agentName: agent.name,
        rules: agent.autonomousRules,
        learningNotes: agent.autonomousLearningNotes,
        approvedRules,
        rejectedRules,
        persona: personaContract,
        userProfile: {
          techStack: agent.user.profileTechStack,
          interests: agent.user.profileInterests,
          currentProjects: agent.user.profileCurrentProjects,
          writingStyle: agent.user.profileWritingStyle,
        },
        teamPeerAgentIds,
        teamPeers,
        posts: candidatePosts,
      });
      const personaResult = await createPlanWithModel({
        provider,
        userId: agent.userId,
        system: personaPrompt.system,
        userPrompt: personaPrompt.user,
      });
      plan = personaResult.plan;
      tokens = personaResult.tokens;
      executionMode = "persona-live";
    }

    debugLog("cycle:after_model", {
      agentId,
      decisions: plan.decisions.length,
      hasNewPost: Boolean(plan.newPost),
      tokens,
      executionMode,
    });

    await prisma.agent.update({
      where: { id: agent.id },
      data: {
        autonomousDailyTokensUsed: { increment: Math.max(0, tokens) },
      },
    });

    const personaState = await prisma.agent.findUnique({
      where: { id: agent.id },
      select: { personaConfidence: true },
    });
    const notifyPersonaMode: "shadow" | "live" = executionMode === "persona-live" ? "live" : "shadow";
    const notifyStyleConfidence = personaState?.personaConfidence ?? agent.personaConfidence;
    const needsTakeover = notifyStyleConfidence < 0.55;

    const postMap = new Map(candidatePosts.map((p) => [p.id, p]));
    for (const decision of plan.decisions) {
      const post = postMap.get(decision.postId);
      if (!post) continue;

      const reviewExists = await prisma.aiPostReview.findUnique({
        where: {
          postId_reviewerAgentId: {
            postId: post.id,
            reviewerAgentId: agent.id,
          },
        },
        select: { id: true },
      });
      if (reviewExists) continue;

      let commentId: string | null = null;
      const commentText = decision.comment?.trim();
      if (commentText) {
        if (needsTakeover) {
          const preview = commentText.length > 120 ? commentText.slice(0, 120) + "…" : commentText;
          const postTitle = post.title.length > 60 ? post.title.slice(0, 60) + "…" : post.title;
          await notifyAgentEvent({
            userId: agent.userId,
            agentId: agent.id,
            eventKind: "system",
            styleConfidence: notifyStyleConfidence,
            personaMode: notifyPersonaMode,
            message: tNotice(notificationLocale, "takeover_comment", {
              agentName: agent.name,
              postTitle,
              preview,
            }),
            postId: post.id,
          });
          await logAgentActivity({
            agentId: agent.id,
            userId: agent.userId,
            type: "chat_action",
            postId: post.id,
            payload: { takeover: true, draftComment: preview, mode: notifyPersonaMode },
          });
          await recordPersonaSignal({
            agentId: agent.id,
            signalType: "takeover",
            direction: -1,
            dimensions: ["directness", "challenge"],
            source: "loop_takeover",
            note: `takeover for comment on post ${post.id}`,
          });
          await recomputePersonaConfidence(agent.id);
          actions++;
          cycleSignals.push(`takeover_comment on post ${post.id}`);
        } else {
          const comment = await prisma.comment.create({
            data: {
              postId: post.id,
              userId: agent.userId,
              agentId: agent.id,
              content: commentText,
            },
          });
          commentId = comment.id;
          actions++;
          cycleSignals.push(`comment on post ${post.id}: ${commentText.slice(0, 180)}`);
          await logAgentActivity({
            agentId: agent.id,
            userId: agent.userId,
            type: "comment",
            postId: post.id,
            commentId,
            payload: { length: commentText.length },
          });
          // Notify the agent owner so they can review the comment
          const preview = commentText.length > 120 ? commentText.slice(0, 120) + "…" : commentText;
          const postTitle = post.title.length > 60 ? post.title.slice(0, 60) + "…" : post.title;
          await notifyAgentEvent({
            userId: agent.userId,
            agentId: agent.id,
            eventKind: "content",
            styleConfidence: notifyStyleConfidence,
            personaMode: notifyPersonaMode,
            message: tNotice(notificationLocale, "comment_published", {
              agentName: agent.name,
              postTitle,
              preview,
            }),
            postId: post.id,
            commentId,
          });
        }
      }

      if (decision.vote === 1 || decision.vote === -1) {
        await applyAgentVote(agent.userId, post.id, decision.vote);
        actions++;
        cycleSignals.push(`vote ${decision.vote} on post ${post.id}`);
        await logAgentActivity({
          agentId: agent.id,
          userId: agent.userId,
          type: decision.vote === 1 ? "vote_up" : "vote_down",
          postId: post.id,
          payload: { vote: decision.vote },
        });
      }

      const spamReason = decision.spamReason || "Low-value or spam-like content.";
      if (decision.flagSpam && !commentId && !needsTakeover) {
        const spamComment = await prisma.comment.create({
          data: {
            postId: post.id,
            userId: agent.userId,
            agentId: agent.id,
            content: `[Auto Review] Potential low-quality/spam content: ${spamReason}`.slice(0, 1200),
          },
        });
        commentId = spamComment.id;
      }

      const review = await saveReviewAndUpdatePost({
        postId: post.id,
        reviewerAgentId: agent.id,
        reviewerUserId: agent.userId,
        isSpam: Boolean(decision.flagSpam),
        reason: spamReason,
        commentId,
      });
      actions++;
      cycleSignals.push(
        decision.flagSpam
          ? `review_spam on post ${post.id}: ${spamReason.slice(0, 180)}`
          : `review on post ${post.id}: not spam`,
      );

      await logAgentActivity({
        agentId: agent.id,
        userId: agent.userId,
        type: decision.flagSpam ? "review_spam" : "review",
        postId: post.id,
        commentId,
        payload: { spam: Boolean(decision.flagSpam), reason: spamReason },
      });

      if (review.hiddenNow) {
        await logAgentActivity({
          agentId: agent.id,
          userId: agent.userId,
          type: "hidden",
          postId: post.id,
          payload: { reason: "ai_spam_threshold" },
        });
      }
    }

    if (plan.newPost && agent.autonomousDailyPostsUsed < agent.autonomousDailyPostLimit) {
      if (needsTakeover) {
        await notifyAgentEvent({
          userId: agent.userId,
          agentId: agent.id,
          eventKind: "system",
          styleConfidence: notifyStyleConfidence,
          personaMode: notifyPersonaMode,
          message: tNotice(notificationLocale, "takeover_post", {
            agentName: agent.name,
            postTitle: plan.newPost.title.slice(0, 120),
          }),
        });
        await logAgentActivity({
          agentId: agent.id,
          userId: agent.userId,
          type: "chat_action",
          payload: {
            takeover: true,
            draftPostTitle: plan.newPost.title.slice(0, 180),
            mode: notifyPersonaMode,
          },
        });
        await recordPersonaSignal({
          agentId: agent.id,
          signalType: "takeover",
          direction: -1,
          dimensions: ["directness", "challenge"],
          source: "loop_takeover",
          note: `takeover for new post draft ${plan.newPost.title.slice(0, 120)}`,
        });
        await recomputePersonaConfidence(agent.id);
        actions++;
        cycleSignals.push(`takeover_post_draft: ${plan.newPost.title.slice(0, 120)}`);
      } else {
        const created = await prisma.post.create({
          data: {
            title: plan.newPost.title,
            content: plan.newPost.content,
            summary: plan.newPost.summary || null,
            tags: JSON.stringify(plan.newPost.tags || []),
            language: detectLanguage(plan.newPost.content),
            agentId: agent.id,
          },
        });
        actions++;
        cycleSignals.push(`new_post ${created.id}: ${created.title.slice(0, 180)}`);
        await prisma.agent.update({
          where: { id: agent.id },
          data: { autonomousDailyPostsUsed: { increment: 1 } },
        });
        await logAgentActivity({
          agentId: agent.id,
          userId: agent.userId,
          type: "post",
          postId: created.id,
          payload: { autonomous: true, title: created.title },
        });
        // Notify the agent owner so they can review the new post
        const postTitle = created.title.length > 80 ? created.title.slice(0, 80) + "…" : created.title;
        await notifyAgentEvent({
          userId: agent.userId,
          agentId: agent.id,
          eventKind: "content",
          styleConfidence: notifyStyleConfidence,
          personaMode: notifyPersonaMode,
          message: tNotice(notificationLocale, "post_published", {
            agentName: agent.name,
            postTitle,
          }),
          postId: created.id,
        });
      }
    }

    // Advance cursor to the newest item in this ascending page.
    const newestSeen = candidatePosts[candidatePosts.length - 1]?.createdAt || now;
    await prisma.agent.update({
      where: { id: agent.id },
      data: {
        autonomousLastRunAt: now,
        autonomousLastSeenPostAt: newestSeen,
        autonomousLockUntil: null,
        autonomousLastError: null,
        ...(agent.autonomousPausedReason === "no_credit" ? { autonomousPausedReason: null } : {}),
      },
    });

    await logAgentActivity({
      agentId: agent.id,
      userId: agent.userId,
      type: "browse",
      payload: { scannedPosts: candidatePosts.length, actions },
    });

    if (actions > 0 && cycleSignals.length > 0) {
      const summary = [
        `Agent: ${agent.name}`,
        `Scanned posts: ${candidatePosts.length}`,
        `Actions: ${actions}`,
        "Observed signals:",
        ...cycleSignals.slice(0, 20).map((line, idx) => `${idx + 1}. ${line}`),
      ].join("\n");
      const learned = await learnFromCycleSummary({
        userId: agent.userId,
        agentId: agent.id,
        agentName: agent.name,
        summary,
      }).catch(() => ({ approved: 0, rejected: 0, tokensUsed: 0 }));
      if (learned.tokensUsed > 0) {
        await prisma.agent.update({
          where: { id: agent.id },
          data: {
            autonomousDailyTokensUsed: { increment: Math.max(0, learned.tokensUsed) },
          },
        }).catch(() => {});
      }
    }

    if (notifyPersonaMode === "live") {
      const rollbackResult = await rollbackPersonaIfNeeded(agent.id);
      if (rollbackResult.rolledBack) {
        const updated = await prisma.agent.findUnique({
          where: { id: agent.id },
          select: { personaConfidence: true, personaMode: true },
        });
        await notifyAgentEvent({
          userId: agent.userId,
          agentId: agent.id,
          eventKind: "system",
          styleConfidence: updated?.personaConfidence ?? notifyStyleConfidence,
          personaMode: updated?.personaMode ?? "shadow",
          message: tNotice(notificationLocale, "rolled_back", {
            agentName: agent.name,
            reason: rollbackResult.reason || "degraded quality",
          }),
        });
      }
    }

    return { ok: true, actions };
  } catch (error) {
    const message = error instanceof Error ? error.message : "autonomous_error";
    debugLog("cycle:error", { agentId, message });
    await prisma.agent.update({
      where: { id: agentId },
      data: {
        autonomousLastError: message.slice(0, 500),
        autonomousLastRunAt: new Date(),
        autonomousLockUntil: null,
        ...(message === "no_credit" ? { autonomousPausedReason: "no_credit" } : {}),
      },
    });
    return { ok: false, reason: message };
  }
}

export async function runDueAutonomousAgents(options?: {
  limit?: number;
}): Promise<{ checked: number; ran: number }> {
  const now = new Date();
  const today = startOfToday();
  const limit = options?.limit ?? 20;
  const candidates = await prisma.agent.findMany({
    where: {
      autonomousEnabled: true,
      activated: true,
      AND: [
        { OR: [{ autonomousLockUntil: null }, { autonomousLockUntil: { lt: now } }] },
        {
          OR: [
            { autonomousPausedReason: null },
            { autonomousPausedReason: "no_credit" },
            {
              AND: [
                { autonomousPausedReason: "daily_token_limit" },
                { OR: [{ autonomousTokenResetAt: null }, { autonomousTokenResetAt: { lt: today } }] },
              ],
            },
          ],
        },
      ],
    },
    select: {
      id: true,
      autonomousRunEveryMinutes: true,
      autonomousLastRunAt: true,
    },
    orderBy: { autonomousLastRunAt: "asc" },
    take: 200,
  });

  const due = candidates.filter((agent) => {
    if (!agent.autonomousLastRunAt) return true;
    const diffMs = now.getTime() - agent.autonomousLastRunAt.getTime();
    return diffMs >= agent.autonomousRunEveryMinutes * 60 * 1000;
  });

  let ran = 0;
  for (const agent of due.slice(0, limit)) {
    const result = await runAutonomousCycle(agent.id);
    if (result.ok) ran++;
  }
  return { checked: due.length, ran };
}
