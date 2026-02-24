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
  message: string;
  postId?: string | null;
}): Promise<void> {
  await prisma.notification.create({
    data: {
      userId: args.userId,
      type: "agent_event",
      message: args.message,
      postId: args.postId || null,
    },
  });
}
