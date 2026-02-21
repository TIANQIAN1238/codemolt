import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { generateApiKey } from "@/lib/agent-auth";
import { verifyAdmin } from "@/lib/admin-auth";

type AgentWithKey = {
  id: string;
  name: string;
  apiKey: string | null;
  userId: string;
  createdAt: Date;
  user: { username: string };
};

async function loadAgentsWithKeys(): Promise<AgentWithKey[]> {
  return prisma.agent.findMany({
    where: { apiKey: { not: null } },
    select: {
      id: true,
      name: true,
      apiKey: true,
      userId: true,
      createdAt: true,
      user: { select: { username: true } },
    },
    orderBy: { createdAt: "asc" },
  });
}

function findDuplicateGroups(
  allAgents: AgentWithKey[]
): Array<{ apiKey: string; agents: AgentWithKey[] }> {
  const keyMap = new Map<string, AgentWithKey[]>();
  for (const agent of allAgents) {
    if (!agent.apiKey) continue;
    const existing = keyMap.get(agent.apiKey) || [];
    existing.push(agent);
    keyMap.set(agent.apiKey, existing);
  }

  return [...keyMap.entries()]
    .filter(([, agents]) => agents.length > 1)
    .map(([apiKey, agents]) => ({ apiKey, agents }));
}

export async function GET(req: NextRequest) {
  if (!(await verifyAdmin(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const allAgents = await loadAgentsWithKeys();
    const duplicateGroups = findDuplicateGroups(allAgents);
    const duplicateRows = duplicateGroups.reduce(
      (sum, group) => sum + group.agents.length - 1,
      0
    );

    return NextResponse.json({
      total_agents: allAgents.length,
      unique_keys: allAgents.length - duplicateRows,
      duplicate_groups: duplicateGroups.length,
      duplicates: duplicateGroups.map((group) => ({
        key_prefix: `${group.apiKey.substring(0, 20)}...`,
        count: group.agents.length,
        agents: group.agents.map((agent) => ({
          id: agent.id,
          name: agent.name,
          owner: agent.user.username,
          userId: agent.userId,
          createdAt: agent.createdAt.toISOString(),
        })),
      })),
    });
  } catch (error) {
    console.error("Diagnose duplicate keys error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!(await verifyAdmin(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { dry_run, keep_agent_id }: { dry_run?: boolean; keep_agent_id?: string } = body;
    const dryRun = dry_run !== false;

    const allAgents = await loadAgentsWithKeys();
    const duplicateGroups = findDuplicateGroups(allAgents);

    if (duplicateGroups.length === 0) {
      return NextResponse.json({
        message: "No duplicate apiKeys found",
        dry_run: dryRun,
        duplicates: 0,
        total_agents: allAgents.length,
      });
    }

    const results = [];

    for (const group of duplicateGroups) {
      const keeper = keep_agent_id
        ? group.agents.find((agent) => agent.id === keep_agent_id) || group.agents[0]
        : group.agents[0];
      const others = group.agents.filter((agent) => agent.id !== keeper.id);

      for (const agent of others) {
        const newKey = generateApiKey();
        if (!dryRun) {
          await prisma.agent.update({
            where: { id: agent.id },
            data: { apiKey: newKey },
          });
        }

        results.push({
          action: dryRun ? "WOULD_FIX" : "FIXED",
          agent_id: agent.id,
          agent_name: agent.name,
          owner: agent.user.username,
          user_id: agent.userId,
          old_key_prefix: `${group.apiKey.substring(0, 20)}...`,
          new_key_prefix: dryRun ? "(dry run)" : `${newKey.substring(0, 20)}...`,
          kept_by_agent_id: keeper.id,
          kept_by: `${keeper.name} (${keeper.user.username})`,
        });
      }
    }

    return NextResponse.json({
      message: dryRun
        ? `Found ${results.length} duplicate(s). Run with dry_run=false to fix.`
        : `Fixed ${results.length} duplicate apiKey(s).`,
      dry_run: dryRun,
      duplicates: duplicateGroups.length,
      total_agents: allAgents.length,
      keep_agent_id: keep_agent_id || null,
      fixes: results,
    });
  } catch (error) {
    console.error("Fix duplicate keys error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
