import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { listMemoryRules, listSystemMemoryLogs } from "@/lib/memory/learning";

function sanitizeArray(input: unknown, maxItems = 20, maxLength = 40): string[] | null {
  if (!Array.isArray(input)) return null;
  const dedup = new Set<string>();
  for (const raw of input) {
    if (typeof raw !== "string") continue;
    const text = raw.replace(/\s+/g, " ").trim().slice(0, maxLength);
    if (text.length < 2) continue;
    dedup.add(text);
    if (dedup.size >= maxItems) break;
  }
  return Array.from(dedup);
}

function toProfilePayload(user: {
  profileTechStack: string[];
  profileInterests: string[];
  profileCurrentProjects: string | null;
  profileWritingStyle: string | null;
  profileGithubUrl: string | null;
  profileLastSyncedAt: Date | null;
}) {
  return {
    tech_stack: user.profileTechStack,
    interests: user.profileInterests,
    current_projects: user.profileCurrentProjects,
    writing_style: user.profileWritingStyle,
    github_url: user.profileGithubUrl,
    last_synced_at: user.profileLastSyncedAt?.toISOString() || null,
  };
}

export async function GET() {
  const userId = await getCurrentUser();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      profileTechStack: true,
      profileInterests: true,
      profileCurrentProjects: true,
      profileWritingStyle: true,
      profileGithubUrl: true,
      profileLastSyncedAt: true,
      agents: {
        select: {
          id: true,
          name: true,
          personaPreset: true,
          personaWarmth: true,
          personaHumor: true,
          personaDirectness: true,
          personaDepth: true,
          personaChallenge: true,
          personaMode: true,
          personaConfidence: true,
          personaVersion: true,
          personaLastPromotedAt: true,
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const agents = await Promise.all(
    user.agents.map(async (agent) => {
      const memory = await listMemoryRules(agent.id);
      const systemLogs = await listSystemMemoryLogs(agent.id, 20);
      return {
        id: agent.id,
        name: agent.name,
        approved_rules: memory.approved.map((row) => ({
          id: row.id,
          category: row.category,
          text: row.text,
          weight: row.weight,
          evidence_count: row.evidenceCount,
          source: row.source,
          updated_at: row.updatedAt.toISOString(),
        })),
        rejected_rules: memory.rejected.map((row) => ({
          id: row.id,
          category: row.category,
          text: row.text,
          weight: row.weight,
          evidence_count: row.evidenceCount,
          source: row.source,
          updated_at: row.updatedAt.toISOString(),
        })),
        system_logs: systemLogs.map((log) => ({
          id: log.id,
          review_action: log.reviewAction,
          message: log.message,
          note: log.note,
          notification_id: log.notificationId,
          created_at: log.createdAt.toISOString(),
        })),
        persona: {
          preset: agent.personaPreset,
          warmth: agent.personaWarmth,
          humor: agent.personaHumor,
          directness: agent.personaDirectness,
          depth: agent.personaDepth,
          challenge: agent.personaChallenge,
          mode: agent.personaMode,
          confidence: agent.personaConfidence,
          version: agent.personaVersion,
          last_promoted_at: agent.personaLastPromotedAt?.toISOString() || null,
        },
      };
    }),
  );

  return NextResponse.json({
    profile: toProfilePayload(user),
    agents,
  });
}

export async function PATCH(req: NextRequest) {
  const userId = await getCurrentUser();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const data: {
    profileTechStack?: string[];
    profileInterests?: string[];
    profileCurrentProjects?: string | null;
    profileWritingStyle?: string | null;
    profileGithubUrl?: string | null;
  } = {};

  if (body.tech_stack !== undefined) {
    const value = sanitizeArray(body.tech_stack, 20, 40);
    if (!value) {
      return NextResponse.json({ error: "tech_stack must be a string array" }, { status: 400 });
    }
    data.profileTechStack = value;
  }
  if (body.interests !== undefined) {
    const value = sanitizeArray(body.interests, 20, 40);
    if (!value) {
      return NextResponse.json({ error: "interests must be a string array" }, { status: 400 });
    }
    data.profileInterests = value;
  }
  if (body.current_projects !== undefined) {
    if (body.current_projects === null || body.current_projects === "") {
      data.profileCurrentProjects = null;
    } else if (typeof body.current_projects === "string") {
      data.profileCurrentProjects = body.current_projects.replace(/\s+/g, " ").trim().slice(0, 1500);
    } else {
      return NextResponse.json({ error: "current_projects must be a string" }, { status: 400 });
    }
  }
  if (body.writing_style !== undefined) {
    if (body.writing_style === null || body.writing_style === "") {
      data.profileWritingStyle = null;
    } else if (typeof body.writing_style === "string") {
      data.profileWritingStyle = body.writing_style.replace(/\s+/g, " ").trim().slice(0, 500);
    } else {
      return NextResponse.json({ error: "writing_style must be a string" }, { status: 400 });
    }
  }
  if (body.github_url !== undefined) {
    if (body.github_url === null || body.github_url === "") {
      data.profileGithubUrl = null;
    } else if (typeof body.github_url === "string") {
      data.profileGithubUrl = body.github_url.trim().slice(0, 300);
    } else {
      return NextResponse.json({ error: "github_url must be a string" }, { status: 400 });
    }
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const user = await prisma.user.update({
    where: { id: userId },
    data,
    select: {
      profileTechStack: true,
      profileInterests: true,
      profileCurrentProjects: true,
      profileWritingStyle: true,
      profileGithubUrl: true,
      profileLastSyncedAt: true,
    },
  });

  return NextResponse.json({
    profile: toProfilePayload(user),
  });
}
