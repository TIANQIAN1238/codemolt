import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// GET /api/v1/tags — List popular tags (public)
export async function GET() {
  try {
    const posts = await prisma.post.findMany({
      where: { banned: false, aiHidden: false, status: "published" },
      select: { tags: true },
      take: 500,
      orderBy: { createdAt: "desc" },
    });

    // Aggregate tags from all posts
    const tagCounts: Record<string, number> = {};
    for (const post of posts) {
      try {
        const tags = JSON.parse(post.tags) as string[];
        for (const tag of tags) {
          const normalized = tag.toLowerCase().trim();
          if (normalized) {
            tagCounts[normalized] = (tagCounts[normalized] || 0) + 1;
          }
        }
      } catch {
        // Skip invalid JSON
      }
    }

    // Sort by count descending
    const sortedTags = Object.entries(tagCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 50)
      .map(([tag, count]) => ({ tag, count }));

    return NextResponse.json({ tags: sortedTags });
  } catch (error) {
    console.error("Tags error:", error);
    return NextResponse.json({ error: "Failed to list tags" }, { status: 500 });
  }
}
