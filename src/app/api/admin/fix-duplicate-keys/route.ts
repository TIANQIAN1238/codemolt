import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { generateApiKey } from "@/lib/agent-auth";

// POST /api/admin/fix-duplicate-keys — Find and fix duplicate apiKeys in Agent table
// Protected by a secret token to prevent unauthorized access.
export async function POST(req: NextRequest) {
  try {
    const { secret, dry_run } = await req.json();

    // Simple secret protection — set ADMIN_SECRET env var
    const adminSecret = process.env.ADMIN_SECRET || process.env.JWT_SECRET;
    if (!secret || secret !== adminSecret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Find all duplicate apiKeys using raw SQL (SQLite)
    const duplicates = await prisma.$queryRaw<Array<{ apiKey: string; count: number }>>`
      SELECT "apiKey", COUNT(*) as count
      FROM "Agent"
      WHERE "apiKey" IS NOT NULL
      GROUP BY "apiKey"
      HAVING COUNT(*) > 1
    `;

    if (duplicates.length === 0) {
      return NextResponse.json({
        message: "No duplicate apiKeys found",
        duplicates: 0,
      });
    }

    const results = [];

    for (const dup of duplicates) {
      // Find all agents with this duplicate key
      const agents = await prisma.agent.findMany({
        where: { apiKey: dup.apiKey },
        select: {
          id: true,
          name: true,
          userId: true,
          createdAt: true,
          user: { select: { username: true } },
        },
        orderBy: { createdAt: "asc" },
      });

      // Keep the first agent's key, regenerate for all others
      const [keeper, ...others] = agents;

      for (const agent of others) {
        const newKey = generateApiKey();
        if (!dry_run) {
          await prisma.agent.update({
            where: { id: agent.id },
            data: { apiKey: newKey },
          });
        }
        results.push({
          action: dry_run ? "WOULD_FIX" : "FIXED",
          agent_id: agent.id,
          agent_name: agent.name,
          owner: agent.user.username,
          old_key_prefix: dup.apiKey.substring(0, 20) + "...",
          new_key_prefix: dry_run ? "(dry run)" : newKey.substring(0, 20) + "...",
          kept_by: `${keeper.name} (${keeper.user.username})`,
        });
      }
    }

    return NextResponse.json({
      message: dry_run
        ? `Found ${results.length} duplicate(s). Run with dry_run=false to fix.`
        : `Fixed ${results.length} duplicate apiKey(s).`,
      duplicates: duplicates.length,
      fixes: results,
    });
  } catch (error) {
    console.error("Fix duplicate keys error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
