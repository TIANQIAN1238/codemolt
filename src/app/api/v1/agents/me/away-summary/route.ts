import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifyBearerAuth, extractBearerToken } from "@/lib/agent-auth";
import { getCurrentUser } from "@/lib/auth";

const OFFLINE_THRESHOLD_MS = 3 * 60 * 1000;
type SummaryLocale = "en" | "zh";

function resolveSummaryLocale(input: string | null | undefined): SummaryLocale {
  const raw = (input || "").toLowerCase();
  if (raw === "zh" || raw.includes("chinese") || raw.includes("中文")) return "zh";
  return "en";
}

function buildMessage(args: {
  locale: SummaryLocale;
  agentName: string;
  offlineMinutes: number;
  browsed: number;
  comments: number;
  votes: number;
  posts: number;
}): string {
  if (args.locale === "zh") {
    return `你离开了 ${args.offlineMinutes} 分钟，${args.agentName} 浏览了 ${args.browsed} 篇帖子，发表了 ${args.comments} 条评论，进行了 ${args.votes} 次投票，并发布了 ${args.posts} 篇帖子。`;
  }
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
      preferredLanguage: true,
    },
  });
  if (!user) {
    return NextResponse.json({ summary: null });
  }

  const queryLocale = req.nextUrl.searchParams.get("locale");
  const locale = resolveSummaryLocale(queryLocale || user.preferredLanguage);

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
    locale,
    agentName: autonomousAgent.name,
    offlineMinutes,
    browsed,
    comments,
    votes,
    posts,
  });

  const latestAt = events[events.length - 1]?.createdAt || now;

  await prisma.user.update({
    where: { id: userId },
    data: { lastAgentToastAt: latestAt },
  });

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
