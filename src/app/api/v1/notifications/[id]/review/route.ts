import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { resolveAiProviderForUser, runModelTextCompletion } from "@/lib/ai-provider";

/**
 * POST /api/v1/notifications/[id]/review
 * Body: { action: "approve" | "reject", note?: string }
 *
 * - approve: marks the notification as approved (no side effects on content)
 * - reject: hides the associated comment/post + triggers AI learning update on agent
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getCurrentUser();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const action = body.action as string;
  const note = typeof body.note === "string" ? body.note.trim() : "";

  if (action !== "approve" && action !== "reject") {
    return NextResponse.json({ error: "action must be 'approve' or 'reject'" }, { status: 400 });
  }

  // Load notification and verify ownership
  const notification = await prisma.notification.findUnique({
    where: { id },
    select: {
      id: true,
      type: true,
      message: true,
      userId: true,
      postId: true,
      commentId: true,
      agentReviewStatus: true,
    },
  });

  if (!notification) {
    return NextResponse.json({ error: "Notification not found" }, { status: 404 });
  }
  if (notification.userId !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (notification.type !== "agent_event") {
    return NextResponse.json({ error: "Only agent_event notifications can be reviewed" }, { status: 400 });
  }

  // Update notification review status
  await prisma.notification.update({
    where: { id },
    data: {
      agentReviewStatus: action === "approve" ? "approved" : "rejected",
      agentReviewNote: action === "reject" && note ? note : null,
      read: true,
    },
  });

  if (action === "approve") {
    return NextResponse.json({ ok: true, action: "approved" });
  }

  // ---- REJECT path ----

  // 1. Hide the comment or post
  if (notification.commentId) {
    await prisma.comment.update({
      where: { id: notification.commentId },
      data: { hidden: true },
    }).catch(() => {
      // comment may already be deleted – not a hard failure
    });
  } else if (notification.postId) {
    // Hide the post if it belongs to an agent owned by this user
    const post = await prisma.post.findUnique({
      where: { id: notification.postId },
      select: { agentId: true, agent: { select: { userId: true } } },
    });
    if (post?.agent?.userId === userId) {
      await prisma.post.update({
        where: { id: notification.postId },
        data: { aiHidden: true, aiHiddenAt: new Date() },
      });
    }
  }

  // 2. AI learning: analyse recent rejections and update agent's autonomousLearningNotes
  // Find the specific agent that triggered this action via commentId or postId
  const agentSelect = { id: true, name: true, autonomousRules: true, autonomousLearningNotes: true } as const;
  let agent: { id: string; name: string; autonomousRules: string | null; autonomousLearningNotes: string | null } | null = null;

  if (notification.commentId) {
    const comment = await prisma.comment.findUnique({
      where: { id: notification.commentId },
      select: { agent: { select: agentSelect } },
    });
    if (comment?.agent) agent = comment.agent;
  } else if (notification.postId) {
    const post = await prisma.post.findUnique({
      where: { id: notification.postId },
      select: { agent: { select: agentSelect } },
    });
    if (post?.agent) agent = post.agent;
  }

  // Fallback: pick the most recently updated autonomous agent for this user
  if (!agent) {
    agent = await prisma.agent.findFirst({
      where: { userId, autonomousEnabled: true },
      orderBy: { updatedAt: "desc" },
      select: agentSelect,
    });
  }

  if (agent) {
    // Run AI learning update in background — don't block the response
    updateAgentLearningNotes({
      userId,
      agent,
      rejectedMessage: notification.message,
      userNote: note,
    }).catch(() => {
      // Non-critical — swallow error silently
    });
  }

  return NextResponse.json({ ok: true, action: "rejected" });
}

/**
 * POST /api/v1/notifications/[id]/review (undo — PATCH semantics via action="undo")
 * Restores a previously rejected notification to pending state.
 * Also unhides the associated comment/post if it was hidden.
 * Re-using same route: action = "undo"
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getCurrentUser();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const notification = await prisma.notification.findUnique({
    where: { id },
    select: {
      id: true,
      type: true,
      userId: true,
      postId: true,
      commentId: true,
      agentReviewStatus: true,
      agentReviewNote: true,
      message: true,
    },
  });

  if (!notification) {
    return NextResponse.json({ error: "Notification not found" }, { status: 404 });
  }
  if (notification.userId !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (notification.agentReviewStatus !== "rejected") {
    return NextResponse.json({ error: "Only rejected notifications can be undone" }, { status: 400 });
  }

  // Restore notification to pending
  await prisma.notification.update({
    where: { id },
    data: {
      agentReviewStatus: null,
      agentReviewNote: null,
      read: false,
    },
  });

  // Restore hidden comment or post
  if (notification.commentId) {
    await prisma.comment.update({
      where: { id: notification.commentId },
      data: { hidden: false },
    }).catch(() => {});
  } else if (notification.postId && !notification.commentId) {
    const post = await prisma.post.findUnique({
      where: { id: notification.postId },
      select: { agentId: true, agent: { select: { userId: true } } },
    });
    if (post?.agent?.userId === userId) {
      await prisma.post.update({
        where: { id: notification.postId },
        data: { aiHidden: false, aiHiddenAt: null },
      });
    }
  }

  return NextResponse.json({ ok: true, action: "undo" });
}

// ---------------------------------------------------------------------------
// Internal: update agent learning notes using AI
// ---------------------------------------------------------------------------

async function updateAgentLearningNotes(args: {
  userId: string;
  agent: { id: string; name: string; autonomousRules: string | null; autonomousLearningNotes: string | null };
  rejectedMessage: string;
  userNote: string;
}) {
  const provider = await resolveAiProviderForUser(args.userId);
  if (!provider) return;

  const existing = args.agent.autonomousLearningNotes || "(none yet)";
  const rules = args.agent.autonomousRules || "(no rules configured)";

  const systemPrompt = `You are an AI assistant helping to improve an autonomous forum agent named "${args.agent.name}".
The agent's owner has rejected one of the agent's actions. Your job is to:
1. Understand why the owner rejected it
2. Update a short "learning notes" paragraph (max 300 words) that will be injected into the agent's future prompts to prevent similar mistakes.

Current agent rules: ${rules}
Current learning notes: ${existing}`;

  const userPrompt = `The owner just rejected this agent action:
"${args.rejectedMessage}"

Owner's reason: "${args.userNote || "No reason provided"}"

Please write an updated "learning notes" paragraph that captures the feedback pattern.
Be concise and actionable. Focus on what the agent should do differently.
Output only the updated notes text, no extra explanation.`;

  const { text } = await runModelTextCompletion({
    provider,
    systemPrompt,
    userPrompt,
    maxTokens: 400,
    temperature: 0.3,
  });

  if (text.trim()) {
    await prisma.agent.update({
      where: { id: args.agent.id },
      data: { autonomousLearningNotes: text.trim().slice(0, 1000) },
    });
  }
}
