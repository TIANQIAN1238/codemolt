import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifyBearerAuth, extractBearerToken } from "@/lib/agent-auth";
import { getCurrentUser } from "@/lib/auth";
import {
  applyPersonaDelta,
  recomputePersonaConfidence,
  recordPersonaSignal,
  rollbackPersonaIfNeeded,
  type PersonaDimension,
} from "@/lib/memory/persona-learning";

type SignalPreset = {
  direction: -1 | 0 | 1;
  dimensions: PersonaDimension[];
};

const SIGNAL_PRESET_MAP: Record<string, SignalPreset> = {
  too_formal: { direction: 1, dimensions: ["warmth", "humor"] },
  too_casual: { direction: -1, dimensions: ["directness"] },
  too_verbose: { direction: -1, dimensions: ["directness", "depth"] },
  too_harsh: { direction: 1, dimensions: ["warmth"] },
  style_good: { direction: 1, dimensions: ["warmth", "humor", "directness", "depth", "challenge"] },
  takeover: { direction: -1, dimensions: ["directness", "challenge"] },
};

async function getAuthUserId(req: NextRequest): Promise<string | null> {
  const token = extractBearerToken(req.headers.get("authorization"));
  const agentAuth = token ? await verifyBearerAuth(token) : null;
  return agentAuth?.userId || (await getCurrentUser());
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getAuthUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const agent = await prisma.agent.findFirst({
    where: { id, userId },
    select: {
      id: true,
      personaMode: true,
      personaConfidence: true,
    },
  });
  if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const signalType = typeof body.signal_type === "string" ? body.signal_type.trim() : "";
  const preset = SIGNAL_PRESET_MAP[signalType];
  if (!preset) {
    return NextResponse.json({ error: "Invalid signal_type" }, { status: 400 });
  }

  const note = typeof body.note === "string" ? body.note.trim() : "";
  const notificationId = typeof body.notification_id === "string" ? body.notification_id : null;

  await recordPersonaSignal({
    agentId: agent.id,
    signalType,
    direction: preset.direction,
    dimensions: preset.dimensions,
    note: note || null,
    source: signalType === "takeover" ? "loop_takeover" : "notification_quick_feedback",
    notificationId,
  });

  const deltaResult = await applyPersonaDelta({
    agentId: agent.id,
    direction: preset.direction,
    dimensions: preset.dimensions,
  });
  const confidence = await recomputePersonaConfidence(agent.id);
  const rollbackResult = await rollbackPersonaIfNeeded(agent.id);

  const persona = await prisma.agent.findUnique({
    where: { id: agent.id },
    select: {
      personaMode: true,
      personaConfidence: true,
    },
  });

  return NextResponse.json({
    ok: true,
    signal_type: signalType,
    delta_applied: Object.values(deltaResult.deltaMap).reduce((sum, value) => sum + Math.abs(value), 0),
    confidence,
    mode: persona?.personaMode || agent.personaMode,
    rolled_back: rollbackResult.rolledBack,
    rollback_reason: rollbackResult.reason || null,
    current_confidence: persona?.personaConfidence ?? agent.personaConfidence,
  });
}
