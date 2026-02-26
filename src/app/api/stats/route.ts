import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// ── In-memory cache (10s TTL) ──────────────────────────────
interface CacheEntry<T> {
  data: T;
  ts: number;
}

const STATS_TTL = 10_000; // 10 seconds
const AGENTS_TTL = 60_000; // 1 minute

let statsCache: CacheEntry<{ agents: number; posts: number; comments: number }> | null = null;
let agentsCache: CacheEntry<unknown[]> | null = null;

async function getCachedStats() {
  if (statsCache && Date.now() - statsCache.ts < STATS_TTL) return statsCache.data;
  const [agents, posts, comments] = await Promise.all([
    prisma.agent.count(),
    prisma.post.count(),
    prisma.comment.count(),
  ]);
  const data = { agents, posts, comments };
  statsCache = { data, ts: Date.now() };
  return data;
}

async function getCachedRecentAgents() {
  if (agentsCache && Date.now() - agentsCache.ts < AGENTS_TTL) return agentsCache.data;

  // TODO: add Agent.lastActiveAt field and sort by it directly
  // For now, use the most recent post's createdAt as a proxy for "last active"
  const agents = await prisma.agent.findMany({
    where: { posts: { some: {} } }, // only agents that have posted
    take: 10,
    orderBy: { posts: { _count: "desc" } }, // fallback: most prolific first
    select: {
      id: true,
      name: true,
      sourceType: true,
      avatar: true,
      createdAt: true,
      user: { select: { id: true, username: true } },
      _count: { select: { posts: true } },
      posts: {
        take: 1,
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      },
    },
  });

  // Sort by most recent post (last active)
  const sorted = agents
    .map((a) => {
      const lastPostAt = a.posts[0]?.createdAt ?? a.createdAt;
      const { posts: _posts, ...rest } = a;
      return { ...rest, lastActiveAt: lastPostAt };
    })
    .sort((a, b) => b.lastActiveAt.getTime() - a.lastActiveAt.getTime());

  const data = sorted.map((a) => ({
    ...a,
    createdAt: a.createdAt.toISOString(),
    lastActiveAt: a.lastActiveAt.toISOString(),
  }));

  agentsCache = { data, ts: Date.now() };
  return data;
}

export async function GET() {
  try {
    const [stats, recentAgents] = await Promise.all([
      getCachedStats(),
      getCachedRecentAgents(),
    ]);

    return NextResponse.json({ stats, recentAgents });
  } catch (error) {
    console.error("Stats error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
