import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifyBearerAuth, extractBearerToken } from "@/lib/agent-auth";
import { getCurrentUser } from "@/lib/auth";
import { snapshotPersona } from "@/lib/memory/persona-learning";

const PRESETS = new Set(["elys-balanced", "elys-sharp", "elys-playful", "elys-calm"]);
const MODES = new Set(["shadow", "live"]);

async function getAuthUserId(req: NextRequest): Promise<string | null> {
  const token = extractBearerToken(req.headers.get("authorization"));
  const agentAuth = token ? await verifyBearerAuth(token) : null;
  return agentAuth?.userId || (await getCurrentUser());
}

async function ensureOwner(agentId: string, userId: string) {
  return prisma.agent.findFirst({
    where: { id: agentId, userId },
    select: {
      id: true,
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
  });
}

function parseSlider(value: unknown, fieldName: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
    throw new Error(`${fieldName}_out_of_range`);
  }
  return Math.round(parsed);
}

function toPersonaPayload(agent: {
  personaPreset: string;
  personaWarmth: number;
  personaHumor: number;
  personaDirectness: number;
  personaDepth: number;
  personaChallenge: number;
  personaMode: string;
  personaConfidence: number;
  personaVersion: number;
  personaLastPromotedAt: Date | null;
}) {
  return {
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
  };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getAuthUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const agent = await ensureOwner(id, userId);
  if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

  return NextResponse.json({
    agent_id: agent.id,
    persona: toPersonaPayload(agent),
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getAuthUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const existing = await ensureOwner(id, userId);
  if (!existing) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const data: Record<string, string | number | Date> = {};

  try {
    if (body.preset !== undefined) {
      if (typeof body.preset !== "string" || !PRESETS.has(body.preset)) {
        return NextResponse.json({ error: "Invalid preset" }, { status: 400 });
      }
      data.personaPreset = body.preset;
    }
    if (body.warmth !== undefined) data.personaWarmth = parseSlider(body.warmth, "warmth");
    if (body.humor !== undefined) data.personaHumor = parseSlider(body.humor, "humor");
    if (body.directness !== undefined) data.personaDirectness = parseSlider(body.directness, "directness");
    if (body.depth !== undefined) data.personaDepth = parseSlider(body.depth, "depth");
    if (body.challenge !== undefined) data.personaChallenge = parseSlider(body.challenge, "challenge");
    if (body.mode !== undefined) {
      if (typeof body.mode !== "string" || !MODES.has(body.mode)) {
        return NextResponse.json({ error: "Invalid mode" }, { status: 400 });
      }
      data.personaMode = body.mode;
    }
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "persona_patch_invalid",
    }, { status: 400 });
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  await prisma.agent.update({
    where: { id },
    data,
  });

  await snapshotPersona({
    agentId: id,
    source: "manual",
  });

  const agent = await ensureOwner(id, userId);
  if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

  return NextResponse.json({
    agent_id: id,
    persona: toPersonaPayload(agent),
  });
}
