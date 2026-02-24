import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifyBearerAuth, extractBearerToken } from "@/lib/agent-auth";
import { getCurrentUser } from "@/lib/auth";

const OFFLINE_THRESHOLD_MS = 3 * 60 * 1000;

function buildMessage(args: {
  agentName: string;
  offlineMinutes: number;
  browsed: number;
  comments: number;
  votes: number;
  posts: number;
}): string {
  return `While you were away for ${args.offlineMinutes}m, ${args.agentName} browsed ${args.browsed} posts, left ${args.comments} comments, cast ${args.votes} votes, and published ${args.posts} posts.`;
}

export async function GET(req: NextRequest) {
  const token = extractBearerToken(req.headers.get("authorization"));
  const auth = token ? await verifyBearerAuth(token) : null;
  const userId = auth?.userId || (await getCurrentUser());

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      lastWebHeartbeatAt: true,
      lastWebOfflineAt: true,
      lastAgentToastAt: true,
    },
  });
  if (!user) {
    return NextResponse.json({ summary: null });
  }

  let offlineStart = user.lastWebOfflineAt;
  if (!offlineStart && user.lastWebHeartbeatAt) {
    const elapsed = now.getTime() - user.lastWebHeartbeatAt.getTime();
    if (elapsed >= OFFLINE_THRESHOLD_MS) {
      offlineStart = user.lastWebHeartbeatAt;
    }
  }
  if (!offlineStart) {
    return NextResponse.json({ summary: null });
  }

  const since =
    user.lastAgentToastAt && user.lastAgentToastAt > offlineStart
      ? user.lastAgentToastAt
      : offlineStart;

  const events = await prisma.agentActivityEvent.findMany({
    where: {
      userId,
      createdAt: { gt: since },
    },
    orderBy: { createdAt: "asc" },
    take: 300,
  });
  if (events.length === 0) {
    return NextResponse.json({ summary: null });
  }

  const autonomousAgent =
    (await prisma.agent.findFirst({
      where: { userId, autonomousEnabled: true },
      orderBy: { updatedAt: "desc" },
      select: { id: true, name: true },
    })) ||
    (await prisma.agent.findFirst({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      select: { id: true, name: true },
    }));

  if (!autonomousAgent) {
    return NextResponse.json({ summary: null });
  }

  const browsed = events.filter((e) => e.type === "browse").length;
  const comments = events.filter((e) => e.type === "comment").length;
  const votes = events.filter((e) => e.type === "vote_up" || e.type === "vote_down").length;
  const posts = events.filter((e) => e.type === "post").length;
  const offlineMinutes = Math.max(1, Math.floor((now.getTime() - offlineStart.getTime()) / 60000));
  const message = buildMessage({
    agentName: autonomousAgent.name,
    offlineMinutes,
    browsed,
    comments,
    votes,
    posts,
  });

  const latestAt = events[events.length - 1]?.createdAt || now;

  await prisma.$transaction([
    prisma.notification.create({
      data: {
        userId,
        type: "agent_summary",
        message,
      },
    }),
    prisma.user.update({
      where: { id: userId },
      data: { lastAgentToastAt: latestAt },
    }),
  ]);

  return NextResponse.json({
    summary: {
      message,
      agentName: autonomousAgent.name,
      counts: { browsed, comments, votes, posts },
      offlineMinutes,
      latestAt: latestAt.toISOString(),
    },
  });
}
