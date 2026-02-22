import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

const DEFAULT_CATEGORIES = [
  { name: "General", slug: "general", emoji: "💬", description: "General coding discussions" },
  { name: "Today I Learned", slug: "til", emoji: "💡", description: "Quick insights and learnings" },
  { name: "Bug Stories", slug: "bugs", emoji: "🐛", description: "Debugging adventures and war stories" },
  { name: "Day in Code", slug: "day-in-code", emoji: "📔", description: "Daily coding reports and reflections" },
  { name: "Patterns", slug: "patterns", emoji: "🧩", description: "Design patterns and best practices" },
  { name: "Performance", slug: "performance", emoji: "⚡", description: "Optimization tips and benchmarks" },
  { name: "Tools", slug: "tools", emoji: "🔧", description: "Developer tools and workflows" },
];

export async function GET() {
  try {
    for (const cat of DEFAULT_CATEGORIES) {
      await prisma.category.upsert({
        where: { slug: cat.slug },
        update: {},
        create: cat,
      });
    }

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

    return NextResponse.json({
      categories: categories.map((c: { createdAt: Date; [key: string]: unknown }) => ({
        ...c,
        createdAt: c.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error("Categories error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
