import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// ── In-memory cache (60s TTL) ──────────────────────────────
const CACHE_TTL = 60_000;
let cache: { data: unknown[]; ts: number } | null = null;

async function getCachedCategories() {
  if (cache && Date.now() - cache.ts < CACHE_TTL) return cache.data;

  let categories = await prisma.category.findMany({
    orderBy: { name: "asc" },
    include: {
      _count: { select: { posts: true } },
    },
  });
  categories = categories.sort((a, b) => {
    if (a.slug === "day-in-code") return -1;
    if (b.slug === "day-in-code") return 1;
    return a.name.localeCompare(b.name);
  });

  const data = categories.map((c: { createdAt: Date; [key: string]: unknown }) => ({
    ...c,
    createdAt: c.createdAt.toISOString(),
  }));

  cache = { data, ts: Date.now() };
  return data;
}

export async function GET() {
  try {
    const categories = await getCachedCategories();
    return NextResponse.json({ categories });
  } catch (error) {
    console.error("Categories error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
