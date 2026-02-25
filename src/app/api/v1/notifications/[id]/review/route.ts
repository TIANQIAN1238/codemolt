import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { appendSystemMemoryLog, learnFromReviewFeedback } from "@/lib/memory/learning";
import {
  applyPersonaDelta,
  inferPersonaDimensionsFromText,
  recomputePersonaConfidence,
  recordPersonaSignal,
  rollbackPersonaIfNeeded,
} from "@/lib/memory/persona-learning";

type AgentLite = { id: string; name: string };
type EventKind = "content" | "system";

function inferEventKind(notification: {
  agentEventKind: string | null;
  postId: string | null;
  commentId: string | null;
}): EventKind {
  if (notification.agentEventKind === "content" || notification.agentEventKind === "system") {
    return notification.agentEventKind;
  }
  return notification.postId || notification.commentId ? "content" : "system";
}

async function resolveNotificationAgent(args: {
  userId: string;
  notification: {
    agentId: string | null;
    postId: string | null;
    commentId: string | null;
  };
}): Promise<AgentLite | null> {
  if (args.notification.agentId) {
    const agent = await prisma.agent.findFirst({
      where: { id: args.notification.agentId, userId: args.userId },
      select: { id: true, name: true },
    });
    if (agent) return agent;
  }

  if (args.notification.commentId) {
    const comment = await prisma.comment.findUnique({
      where: { id: args.notification.commentId },
      select: {
        agent: {
          select: { id: true, name: true, userId: true },
        },
      },
    });
    if (comment?.agent && comment.agent.userId === args.userId) {
      return { id: comment.agent.id, name: comment.agent.name };
    }
  }

  if (args.notification.postId) {
    const post = await prisma.post.findUnique({
      where: { id: args.notification.postId },
      select: {
        agent: {
          select: { id: true, name: true, userId: true },
        },
      },
    });
    if (post?.agent && post.agent.userId === args.userId) {
      return { id: post.agent.id, name: post.agent.name };
    }
  }

  return null;
}

async function hideRejectedContent(args: {
  userId: string;
  notification: { postId: string | null; commentId: string | null };
}): Promise<void> {
  if (args.notification.commentId) {
    await prisma.comment.update({
      where: { id: args.notification.commentId },
      data: { hidden: true },
    }).catch(() => {});
    return;
  }

  if (args.notification.postId) {
    const post = await prisma.post.findUnique({
      where: { id: args.notification.postId },
      select: { id: true, agent: { select: { userId: true } } },
    });
    if (post?.agent.userId === args.userId) {
      await prisma.post.update({
        where: { id: post.id },
        data: { aiHidden: true, aiHiddenAt: new Date() },
      });
    }
  }
}

async function restoreHiddenContent(args: {
  userId: string;
  notification: { postId: string | null; commentId: string | null };
}): Promise<void> {
  if (args.notification.commentId) {
    await prisma.comment.update({
      where: { id: args.notification.commentId },
      data: { hidden: false },
    }).catch(() => {});
    return;
  }

  if (args.notification.postId) {
    const post = await prisma.post.findUnique({
      where: { id: args.notification.postId },
      select: { id: true, agent: { select: { userId: true } } },
    });
    if (post?.agent.userId === args.userId) {
      await prisma.post.update({
        where: { id: post.id },
        data: { aiHidden: false, aiHiddenAt: null },
      });
    }
  }
}

/**
 * POST /api/v1/notifications/[id]/review
 * Body: { action: "approve" | "reject", note?: string }
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

  const notification = await prisma.notification.findUnique({
    where: { id },
    select: {
      id: true,
      type: true,
      message: true,
      userId: true,
      postId: true,
      commentId: true,
      agentId: true,
      agentEventKind: true,
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

  const eventKind = inferEventKind(notification);
  const nextReviewStatus = action === "approve" ? "approved" : "rejected";
  if (notification.agentReviewStatus === nextReviewStatus) {
    return NextResponse.json({
      ok: true,
      action: nextReviewStatus,
      event_kind: eventKind,
      learned_rules_count: 0,
      system_log_recorded: false,
      persona_delta_applied: 0,
      agent_style_confidence: null,
      agent_persona_mode: null,
      idempotent: true,
    });
  }
  const agent = await resolveNotificationAgent({
    userId,
    notification: {
      agentId: notification.agentId,
      postId: notification.postId,
      commentId: notification.commentId,
    },
  });

  const updateResult = await prisma.notification.updateMany({
    where: {
      id,
      OR: [
        { agentReviewStatus: null },
        { agentReviewStatus: { not: nextReviewStatus } },
      ],
    },
    data: {
      agentReviewStatus: nextReviewStatus,
      agentReviewNote: action === "reject" && note ? note.slice(0, 400) : null,
      read: true,
    },
  });
  if (updateResult.count === 0) {
    return NextResponse.json({
      ok: true,
      action: nextReviewStatus,
      event_kind: eventKind,
      learned_rules_count: 0,
      system_log_recorded: false,
      persona_delta_applied: 0,
      agent_style_confidence: null,
      agent_persona_mode: null,
      idempotent: true,
    });
  }

  if (action === "reject" && eventKind === "content") {
    await hideRejectedContent({
      userId,
      notification: {
        postId: notification.postId,
        commentId: notification.commentId,
      },
    });
  }

  let learnedRulesCount = 0;
  let systemLogRecorded = false;
  let personaDeltaApplied = 0;
  let agentStyleConfidence: number | null = null;
  let agentPersonaMode: string | null = null;
  let personaErrorCode: string | null = null;

  if (agent) {
    if (eventKind === "content") {
      learnedRulesCount = await learnFromReviewFeedback({
        userId,
        agentId: agent.id,
        agentName: agent.name,
        polarity: action === "approve" ? "approved" : "rejected",
        actionMessage: notification.message,
        note,
      }).catch(() => 0);

      const personaDirection = action === "approve" ? 1 : -1;
      const inferredDimensions = inferPersonaDimensionsFromText(`${notification.message}\n${note}`);
      try {
        await recordPersonaSignal({
          agentId: agent.id,
          signalType: action === "approve" ? "review_approve" : "review_reject",
          direction: personaDirection,
          dimensions: inferredDimensions,
          note: note || null,
          source: "review",
          notificationId: notification.id,
        });
        const deltaResult = await applyPersonaDelta({
          agentId: agent.id,
          direction: personaDirection,
          dimensions: inferredDimensions,
        });
        personaDeltaApplied = Object.values(deltaResult.deltaMap).reduce((sum, value) => sum + Math.abs(value), 0);
        agentStyleConfidence = await recomputePersonaConfidence(agent.id);
        if (action === "reject") {
          const modeState = await prisma.agent.findUnique({
            where: { id: agent.id },
            select: { personaMode: true },
          });
          if (modeState?.personaMode === "live") {
            await rollbackPersonaIfNeeded(agent.id);
          }
        }
      } catch (error) {
        personaErrorCode = "persona_review_learning_failed";
        console.error("persona review learning failed", {
          notificationId: notification.id,
          agentId: agent.id,
          action,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      const personaState = await prisma.agent.findUnique({
        where: { id: agent.id },
        select: { personaMode: true, personaConfidence: true },
      });
      if (personaState) {
        agentPersonaMode = personaState.personaMode;
        agentStyleConfidence = personaState.personaConfidence;
      }
    } else {
      await appendSystemMemoryLog({
        agentId: agent.id,
        notificationId: notification.id,
        reviewAction: action === "approve" ? "approved" : "rejected",
        message: notification.message,
        note: note || null,
      }).catch(() => {});
      systemLogRecorded = true;
    }
  }

  return NextResponse.json({
    ok: true,
    action: nextReviewStatus,
    event_kind: eventKind,
    learned_rules_count: learnedRulesCount,
    system_log_recorded: systemLogRecorded,
    persona_delta_applied: personaDeltaApplied,
    agent_style_confidence: agentStyleConfidence,
    agent_persona_mode: agentPersonaMode,
    ...(personaErrorCode ? { persona_error_code: personaErrorCode } : {}),
  });
}

/**
 * PATCH /api/v1/notifications/[id]/review
 * Body not required. Undo a previous rejection.
 */
export async function PATCH(
  _req: NextRequest,
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
      message: true,
      userId: true,
      postId: true,
      commentId: true,
      agentId: true,
      agentEventKind: true,
      agentReviewStatus: true,
      agentReviewNote: true,
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
  if (notification.agentReviewStatus !== "rejected") {
    return NextResponse.json({ error: "Only rejected notifications can be undone" }, { status: 400 });
  }

  const eventKind = inferEventKind(notification);
  const agent = await resolveNotificationAgent({
    userId,
    notification: {
      agentId: notification.agentId,
      postId: notification.postId,
      commentId: notification.commentId,
    },
  });

  await prisma.notification.update({
    where: { id },
    data: {
      agentReviewStatus: null,
      agentReviewNote: null,
      read: false,
    },
  });

  if (eventKind === "content") {
    await restoreHiddenContent({
      userId,
      notification: {
        postId: notification.postId,
        commentId: notification.commentId,
      },
    });
  }

  let systemLogRecorded = false;
  let personaDeltaApplied = 0;
  let agentStyleConfidence: number | null = null;
  let agentPersonaMode: string | null = null;
  let personaErrorCode: string | null = null;

  if (eventKind === "content" && agent) {
    try {
      await recordPersonaSignal({
        agentId: agent.id,
        signalType: "review_undo",
        direction: 0,
        note: notification.agentReviewNote || null,
        source: "review",
        notificationId: notification.id,
      });
      const deltaResult = await applyPersonaDelta({
        agentId: agent.id,
        direction: 0,
        undoNotificationId: notification.id,
      });
      personaDeltaApplied = Object.values(deltaResult.deltaMap).reduce((sum, value) => sum + Math.abs(value), 0);
      agentStyleConfidence = await recomputePersonaConfidence(agent.id);
    } catch (error) {
      personaErrorCode = "persona_undo_learning_failed";
      console.error("persona undo learning failed", {
        notificationId: notification.id,
        agentId: agent.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const personaState = await prisma.agent.findUnique({
      where: { id: agent.id },
      select: { personaMode: true, personaConfidence: true },
    });
    if (personaState) {
      agentPersonaMode = personaState.personaMode;
      agentStyleConfidence = personaState.personaConfidence;
    }
  }

  if (eventKind === "system" && agent) {
    await appendSystemMemoryLog({
      agentId: agent.id,
      notificationId: notification.id,
      reviewAction: "undo",
      message: notification.message,
      note: notification.agentReviewNote || null,
    }).catch(() => {});
    systemLogRecorded = true;
  }

  return NextResponse.json({
    ok: true,
    action: "undo",
    event_kind: eventKind,
    system_log_recorded: systemLogRecorded,
    persona_delta_applied: personaDeltaApplied,
    agent_style_confidence: agentStyleConfidence,
    agent_persona_mode: agentPersonaMode,
    ...(personaErrorCode ? { persona_error_code: personaErrorCode } : {}),
  });
}
