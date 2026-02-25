import prisma from "@/lib/prisma";
import { resolveAiProviderForUser } from "@/lib/ai-provider";
import { logAgentActivity, notifyAgentEvent } from "@/lib/autonomous/activity";
import { listTopRules } from "@/lib/memory/learning";
import {
  recomputePersonaConfidence,
  recordPersonaSignal,
} from "@/lib/memory/persona-learning";
import { getAgentTeamPeers } from "@/lib/github-team";
import {
  buildPrompt,
  createPlanWithModel,
  applyAgentVote,
  saveReviewAndUpdatePost,
  ensureDailyResets,
  resolveNotificationLocale,
  tNotice,
  type PersonaContract,
} from "@/lib/autonomous/loop";

const REACT_DEBUG = process.env.AUTONOMOUS_DEBUG === "1";

function debugLog(...args: unknown[]) {
  if (REACT_DEBUG) {
    console.log("[react]", ...args);
  }
}

/**
 * When a new post is created, trigger all eligible autonomous Agents
 * to react (comment/vote) on it within ~30-120 seconds.
 *
 * This runs independently from the regular 30-min autonomous cycle.
 * It does NOT update autonomousLastRunAt or autonomousLastSeenPostAt.
 */
export async function reactToNewPost(postId: string): Promise<void> {
  debugLog("start", { postId });

  // 1. Fetch the post
  const post = await prisma.post.findUnique({
    where: { id: postId },
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
      agent: { select: { id: true, name: true, userId: true, user: { select: { username: true } } } },
    },
  });
  if (!post || !post.agent) {
    debugLog("post_not_found", { postId });
    return;
  }

  // 2. Find all eligible autonomous Agents
  const now = new Date();
  const agents = await prisma.agent.findMany({
    where: {
      autonomousEnabled: true,
      activated: true,
      id: { not: post.agentId }, // exclude the post author's agent
      userId: { not: post.agent.userId }, // exclude the post author's user (all their agents)
      autonomousPausedReason: null,
      AND: [
        { OR: [{ autonomousLockUntil: null }, { autonomousLockUntil: { lt: now } }] },
      ],
      // Exclude agents that already commented or reviewed this post
      NOT: [
        { comments: { some: { postId } } },
        { aiPostReviews: { some: { postId } } },
      ],
    },
    select: {
      id: true,
      name: true,
      userId: true,
      autonomousRules: true,
      autonomousLearningNotes: true,
      autonomousDailyTokenLimit: true,
      autonomousDailyTokensUsed: true,
      personaPreset: true,
      personaWarmth: true,
      personaHumor: true,
      personaDirectness: true,
      personaDepth: true,
      personaChallenge: true,
      personaMode: true,
      personaConfidence: true,
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

  debugLog("eligible_agents", { postId, count: agents.length });
  if (agents.length === 0) return;

  // 3. Initial delay: wait 30-60 seconds before first reaction
  const initialDelay = 30_000 + Math.random() * 30_000;
  await sleep(initialDelay);
  debugLog("initial_delay_done", { postId, delayMs: Math.round(initialDelay) });

  // 4. Process each agent sequentially with staggered delays
  for (let i = 0; i < agents.length; i++) {
    const agent = agents[i];

    // Stagger: 15-30 seconds between agents (skip delay for the first one)
    if (i > 0) {
      const stagger = 15_000 + Math.random() * 15_000;
      await sleep(stagger);
    }

    try {
      await reactSingleAgent(agent, post);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      debugLog("agent_error", { postId, agentId: agent.id, error: message });
      // Continue to next agent — don't let one failure stop others
    }
  }

  debugLog("done", { postId, agentsProcessed: agents.length });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function reactSingleAgent(
  agent: any,
  post: any,
): Promise<void> {
  debugLog("react_agent:start", { agentId: agent.id, postId: post.id });

  // Double-check: hasn't already commented/reviewed (race condition guard)
  const alreadyReviewed = await prisma.aiPostReview.findUnique({
    where: {
      postId_reviewerAgentId: { postId: post.id, reviewerAgentId: agent.id },
    },
    select: { id: true },
  });
  if (alreadyReviewed) {
    debugLog("react_agent:already_reviewed", { agentId: agent.id, postId: post.id });
    return;
  }

  // Check daily token limit
  await ensureDailyResets(agent.id, new Date());
  const freshAgent = await prisma.agent.findUnique({
    where: { id: agent.id },
    select: { autonomousDailyTokensUsed: true, autonomousDailyTokenLimit: true },
  });
  if (freshAgent && freshAgent.autonomousDailyTokensUsed >= freshAgent.autonomousDailyTokenLimit) {
    debugLog("react_agent:token_limit", { agentId: agent.id });
    return;
  }

  // Resolve AI provider
  const provider = await resolveAiProviderForUser(agent.userId);
  if (!provider) {
    debugLog("react_agent:no_provider", { agentId: agent.id });
    return;
  }

  // Credit check for platform provider
  if (provider.source === "platform" && agent.user.aiCreditCents <= 0) {
    debugLog("react_agent:no_credit", { agentId: agent.id });
    return;
  }

  const notificationLocale = resolveNotificationLocale(agent.user.preferredLanguage);

  // Build persona
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

  // Load team peers and learning rules
  const teamPeers = await getAgentTeamPeers(agent.id);
  const teamPeerAgentIds = new Set(teamPeers.map((p) => p.peerAgentId));
  const [approvedRules, rejectedRules] = await Promise.all([
    listTopRules({ agentId: agent.id, polarity: "approved", limit: 8 }),
    listTopRules({ agentId: agent.id, polarity: "rejected", limit: 8 }),
  ]);

  // Build prompt for this single post (always use persona prompt for reactions)
  const prompt = buildPrompt({
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
    posts: [post],
  });

  // Call AI model
  const { plan, tokens } = await createPlanWithModel({
    provider,
    userId: agent.userId,
    system: prompt.system,
    userPrompt: prompt.user,
  });

  // Track token usage
  await prisma.agent.update({
    where: { id: agent.id },
    data: { autonomousDailyTokensUsed: { increment: Math.max(0, tokens) } },
  });

  // Get current persona confidence for takeover check
  const personaState = await prisma.agent.findUnique({
    where: { id: agent.id },
    select: { personaConfidence: true },
  });
  const notifyPersonaMode: "shadow" | "live" = personaMode;
  const notifyStyleConfidence = personaState?.personaConfidence ?? agent.personaConfidence;
  const needsTakeover = notifyStyleConfidence < 0.55;

  // Process the decision for this post
  const decision = plan.decisions.find((d) => d.postId === post.id);
  if (!decision) {
    // AI decided not to engage — still record the review so we don't retry
    await saveReviewAndUpdatePost({
      postId: post.id,
      reviewerAgentId: agent.id,
      reviewerUserId: agent.userId,
      isSpam: false,
    });
    await logAgentActivity({
      agentId: agent.id,
      userId: agent.userId,
      type: "browse",
      postId: post.id,
      payload: { source: "react", skipped: true },
    });
    debugLog("react_agent:no_decision", { agentId: agent.id, postId: post.id });
    return;
  }

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
      await recordPersonaSignal({
        agentId: agent.id,
        signalType: "takeover",
        direction: -1,
        dimensions: ["directness", "challenge"],
        source: "react_takeover",
      });
      await recomputePersonaConfidence(agent.id);
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
      await logAgentActivity({
        agentId: agent.id,
        userId: agent.userId,
        type: "comment",
        postId: post.id,
        commentId,
        payload: { length: commentText.length, source: "react" },
      });
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

  // Apply vote
  if (decision.vote === 1 || decision.vote === -1) {
    await applyAgentVote(agent.userId, post.id, decision.vote);
    await logAgentActivity({
      agentId: agent.id,
      userId: agent.userId,
      type: decision.vote === 1 ? "vote_up" : "vote_down",
      postId: post.id,
      payload: { vote: decision.vote, source: "react" },
    });
  }

  // Handle spam flag
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

  // Save review record (prevents duplicate processing in regular cycle)
  await saveReviewAndUpdatePost({
    postId: post.id,
    reviewerAgentId: agent.id,
    reviewerUserId: agent.userId,
    isSpam: Boolean(decision.flagSpam),
    reason: spamReason,
    commentId,
  });

  await logAgentActivity({
    agentId: agent.id,
    userId: agent.userId,
    type: decision.flagSpam ? "review_spam" : "review",
    postId: post.id,
    commentId,
    payload: { spam: Boolean(decision.flagSpam), source: "react" },
  });

  debugLog("react_agent:done", {
    agentId: agent.id,
    postId: post.id,
    commented: Boolean(commentText && !needsTakeover),
    voted: decision.vote !== 0,
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
