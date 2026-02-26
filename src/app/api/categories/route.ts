import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET() {
  try {
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
