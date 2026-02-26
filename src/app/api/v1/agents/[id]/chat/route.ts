import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifyBearerAuth, extractBearerToken } from "@/lib/agent-auth";
import { getCurrentUser } from "@/lib/auth";
import { detectLanguage } from "@/lib/detect-language";
import {
  refundPlatformCredit,
  resolveAiProviderForUser,
  reservePlatformCredit,
  runModelTextCompletion,
} from "@/lib/ai-provider";
import { logAgentActivity } from "@/lib/autonomous/activity";

const PLATFORM_CHAT_COST_CENTS = 1;

type ChatMessage = { role: "user" | "assistant"; content: string };

type ActionResult = {
  type: "none" | "vote" | "comment" | "post";
  success: boolean;
  message: string;
  postId?: string;
  commentId?: string;
};

function isWriteActionCommand(text: string): boolean {
  const input = text.trim();
  return /^\/(vote|comment|post)\b/i.test(input);
}

function summarizeActivity(events: Array<{ type: string }>) {
  return {
    browsed: events.filter((e) => e.type === "browse").length,
    comments: events.filter((e) => e.type === "comment").length,
    votes: events.filter((e) => e.type === "vote_up" || e.type === "vote_down").length,
    posts: events.filter((e) => e.type === "post").length,
  };
}

async function applyAgentVote(userId: string, postId: string, value: -1 | 0 | 1): Promise<void> {
  const existing = await prisma.vote.findUnique({
    where: { userId_postId: { userId, postId } },
  });
  const oldValue = (existing?.value || 0) as -1 | 0 | 1;
  if (oldValue === value) return;

  await prisma.$transaction(async (tx) => {
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

async function tryExecuteAction(args: {
  text: string;
  userId: string;
  agentId: string;
}): Promise<ActionResult> {
  const input = args.text.trim();
  if (!input) {
    return { type: "none", success: true, message: "" };
  }

  const voteMatch = input.match(/^\/vote\s+([a-z0-9]+)\s+(up|down|clear)$/i);
  if (voteMatch) {
    const postId = voteMatch[1];
    const voteCmd = voteMatch[2].toLowerCase();
    const value: -1 | 0 | 1 = voteCmd === "up" ? 1 : voteCmd === "down" ? -1 : 0;

    const post = await prisma.post.findUnique({
      where: { id: postId },
      select: { id: true, aiHidden: true, banned: true, status: true },
    });
    if (!post || post.banned || post.aiHidden || post.status !== "published") {
      return { type: "vote", success: false, message: "Target post not available." };
    }

    await applyAgentVote(args.userId, post.id, value);
    await logAgentActivity({
      agentId: args.agentId,
      userId: args.userId,
      type: "chat_action",
      postId: post.id,
      payload: { action: "vote", value },
    });
    return {
      type: "vote",
      success: true,
      message: value === 1 ? "Upvoted the post." : value === -1 ? "Downvoted the post." : "Cleared vote.",
      postId: post.id,
    };
  }

  const commentMatch = input.match(/^\/comment\s+([a-z0-9]+)\s+([\s\S]+)$/i);
  if (commentMatch) {
    const postId = commentMatch[1];
    const content = commentMatch[2].trim().slice(0, 1200);
    if (!content) {
      return { type: "comment", success: false, message: "Comment cannot be empty." };
    }
    const post = await prisma.post.findUnique({
      where: { id: postId },
      select: { id: true, aiHidden: true, banned: true, status: true },
    });
    if (!post || post.banned || post.aiHidden || post.status !== "published") {
      return { type: "comment", success: false, message: "Target post not available." };
    }
    const comment = await prisma.comment.create({
      data: {
        postId: post.id,
        userId: args.userId,
        agentId: args.agentId,
        content,
      },
    });
    await logAgentActivity({
      agentId: args.agentId,
      userId: args.userId,
      type: "chat_action",
      postId: post.id,
      commentId: comment.id,
      payload: { action: "comment" },
    });
    return {
      type: "comment",
      success: true,
      message: "Comment published.",
      postId: post.id,
      commentId: comment.id,
    };
  }

  const postMatch = input.match(/^\/post\s+([\s\S]+)$/i);
  if (postMatch) {
    const body = postMatch[1].trim();
    const [rawTitle, ...rest] = body.split("\n");
    const title = rawTitle?.trim().slice(0, 180);
    const content = rest.join("\n").trim().slice(0, 12000);
    if (!title || !content) {
      return {
        type: "post",
        success: false,
        message: "Use format: /post <title>\\n<content>.",
      };
    }
    const created = await prisma.post.create({
      data: {
        title,
        content,
        summary: content.slice(0, 260),
        tags: "[]",
        language: detectLanguage(content),
        agentId: args.agentId,
      },
    });
    await logAgentActivity({
      agentId: args.agentId,
      userId: args.userId,
      type: "chat_action",
      postId: created.id,
      payload: { action: "post" },
    });
    return {
      type: "post",
      success: true,
      message: "New post created.",
      postId: created.id,
    };
  }

  return { type: "none", success: true, message: "" };
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: agentId } = await params;
  const token = extractBearerToken(req.headers.get("authorization"));
  const auth = token ? await verifyBearerAuth(token) : null;
  const userId = auth?.userId || (await getCurrentUser());

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const agent = await prisma.agent.findFirst({
    where: { id: agentId, userId },
    select: { id: true, name: true, autonomousEnabled: true, activated: true },
  });
  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    messages?: ChatMessage[];
    postContext?: { id?: string; title?: string; summary?: string | null; content?: string };
  };
  const messages = Array.isArray(body.messages) ? body.messages.slice(-30) : [];
  const lastUserMessage = [...messages]
    .reverse()
    .find((m) => m.role === "user" && typeof m.content === "string")?.content;
  if (!lastUserMessage) {
    return NextResponse.json({ error: "messages is required" }, { status: 400 });
  }

  const wantsWriteAction = isWriteActionCommand(lastUserMessage);
  if (wantsWriteAction && !agent.activated) {
    return NextResponse.json(
      {
        reply: "This agent is not activated yet. Please activate it before using /post, /comment, or /vote.",
        action: {
          type: "none",
          success: false,
          message: "Agent not activated.",
        } satisfies ActionResult,
      },
      { status: 400 },
    );
  }

  const provider = await resolveAiProviderForUser(userId);
  const shouldCharge = provider?.source === "platform";
  if (provider?.source === "platform") {
    const reserved = await reservePlatformCredit(userId, PLATFORM_CHAT_COST_CENTS);
    if (!reserved) {
      return NextResponse.json(
        {
          reply:
            "Platform credit is exhausted. Configure your own provider in Settings to continue chatting.",
          action: {
            type: "none",
            success: false,
            message: "Platform credit exhausted.",
          } satisfies ActionResult,
        },
        { status: 402 },
      );
    }
  }

  let actionResult: ActionResult;
  try {
    actionResult = await tryExecuteAction({
      text: lastUserMessage,
      userId,
      agentId: agent.id,
    });
  } catch (error) {
    if (shouldCharge) {
      await refundPlatformCredit(userId, PLATFORM_CHAT_COST_CENTS).catch(() => {});
    }
    console.error("Agent chat action error:", error);
    return NextResponse.json(
      {
        reply: "Failed to execute the requested action. Please retry.",
        action: {
          type: "none",
          success: false,
          message: "Action execution failed.",
        } satisfies ActionResult,
      },
      { status: 500 },
    );
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const events = await prisma.agentActivityEvent.findMany({
    where: {
      userId,
      agentId: agent.id,
      createdAt: { gte: today },
    },
    orderBy: { createdAt: "desc" },
    take: 60,
  });
  const summary = summarizeActivity(events);

  if (!provider) {
    const fallback = [
      `I am ${agent.name}. Today I browsed ${summary.browsed}, commented ${summary.comments}, voted ${summary.votes}, posted ${summary.posts}.`,
      actionResult.message ? `Action result: ${actionResult.message}` : "",
    ]
      .filter(Boolean)
      .join(" ");
    return NextResponse.json({ reply: fallback, action: actionResult });
  }

  const postContext = body.postContext || {};
  const contextText = [
    postContext.id ? `Current post id: ${postContext.id}` : "",
    postContext.title ? `Current post title: ${postContext.title}` : "",
    postContext.summary ? `Current post summary: ${postContext.summary}` : "",
    postContext.content ? `Current post excerpt: ${postContext.content.slice(0, 600)}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const convoText = messages
    .slice(-12)
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n");

  const systemPrompt = [
    `You are ${agent.name}, a user's autonomous forum agent on CodeBlog.`,
    "Keep responses concise, specific, and practical.",
    "You can explain today's activity and what you learned.",
    "If an action was already executed, confirm result and suggest next useful step.",
  ].join("\n");
  const userPrompt = [
    `Today's activity summary: browsed=${summary.browsed}, comments=${summary.comments}, votes=${summary.votes}, posts=${summary.posts}.`,
    actionResult.message ? `Executed action result: ${actionResult.message}` : "No action executed.",
    contextText ? `Context:\n${contextText}` : "",
    `Conversation:\n${convoText}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    const { text } = await runModelTextCompletion({
      provider,
      systemPrompt,
      userPrompt,
      maxTokens: 700,
      temperature: 0.4,
    });
    return NextResponse.json({
      reply: text || `I reviewed today's activity: ${JSON.stringify(summary)}.`,
      action: actionResult,
    });
  } catch {
    if (shouldCharge) {
      await refundPlatformCredit(userId, PLATFORM_CHAT_COST_CENTS).catch(() => {});
    }
    const fallback = [
      `I am ${agent.name}. Today's stats: browsed ${summary.browsed}, comments ${summary.comments}, votes ${summary.votes}, posts ${summary.posts}.`,
      actionResult.message ? `Action result: ${actionResult.message}` : "",
    ]
      .filter(Boolean)
      .join(" ");
    return NextResponse.json({ reply: fallback, action: actionResult });
  }
}
