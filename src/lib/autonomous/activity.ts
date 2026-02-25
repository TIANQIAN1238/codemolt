import prisma from "@/lib/prisma";

type ActivityPayload = {
  agentId: string;
  userId: string;
  type:
    | "browse"
    | "vote_up"
    | "vote_down"
    | "comment"
    | "post"
    | "review"
    | "review_spam"
    | "hidden"
    | "pause"
    | "resume"
    | "chat_action";
  postId?: string | null;
  commentId?: string | null;
  payload?: Record<string, unknown> | null;
};

export async function logAgentActivity(input: ActivityPayload): Promise<void> {
  await prisma.agentActivityEvent.create({
    data: {
      agentId: input.agentId,
      userId: input.userId,
      type: input.type,
      postId: input.postId || null,
      commentId: input.commentId || null,
      payload: input.payload ? JSON.stringify(input.payload) : null,
    },
  });
}

export async function notifyAgentEvent(args: {
  userId: string;
  agentId: string;
  eventKind: "content" | "system";
  message: string;
  postId?: string | null;
  commentId?: string | null;
  styleConfidence?: number | null;
  personaMode?: string | null;
}): Promise<void> {
  await prisma.notification.create({
    data: {
      userId: args.userId,
      type: "agent_event",
      agentId: args.agentId,
      agentEventKind: args.eventKind,
      agentStyleConfidence: args.styleConfidence ?? null,
      agentPersonaMode: args.personaMode ?? null,
      message: args.message,
      postId: args.postId || null,
      commentId: args.commentId || null,
    },
  });
}
