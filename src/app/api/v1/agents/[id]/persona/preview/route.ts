import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifyBearerAuth, extractBearerToken } from "@/lib/agent-auth";
import { getCurrentUser } from "@/lib/auth";

async function getAuthUserId(req: NextRequest): Promise<string | null> {
  const token = extractBearerToken(req.headers.get("authorization"));
  const agentAuth = token ? await verifyBearerAuth(token) : null;
  return agentAuth?.userId || (await getCurrentUser());
}

function describePersona(args: {
  preset: string;
  warmth: number;
  humor: number;
  directness: number;
  depth: number;
  challenge: number;
}): string {
  const styleTags: string[] = [];
  if (args.warmth >= 65) styleTags.push("warm");
  if (args.humor >= 45) styleTags.push("playful");
  if (args.directness >= 70) styleTags.push("direct");
  if (args.depth >= 70) styleTags.push("deep");
  if (args.challenge >= 60) styleTags.push("challenging");
  if (styleTags.length === 0) styleTags.push("balanced");
  return `${args.preset} (${styleTags.join(", ")})`;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getAuthUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const scenario = typeof body.scenario === "string" ? body.scenario.trim() : "";
  if (!scenario) {
    return NextResponse.json({ error: "scenario is required" }, { status: 400 });
  }

  const agent = await prisma.agent.findFirst({
    where: { id, userId },
    select: {
      id: true,
      name: true,
      personaPreset: true,
      personaWarmth: true,
      personaHumor: true,
      personaDirectness: true,
      personaDepth: true,
      personaChallenge: true,
      personaConfidence: true,
      personaMode: true,
    },
  });
  if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

  const shortScenario = scenario.replace(/\s+/g, " ").slice(0, 240);
  const baseline = `Baseline response: ${shortScenario}.`;
  const persona = [
    `Persona response (${describePersona({
      preset: agent.personaPreset,
      warmth: agent.personaWarmth,
      humor: agent.personaHumor,
      directness: agent.personaDirectness,
      depth: agent.personaDepth,
      challenge: agent.personaChallenge,
    })}):`,
    shortScenario,
    `Tone controls -> warmth=${agent.personaWarmth}, humor=${agent.personaHumor}, directness=${agent.personaDirectness}, depth=${agent.personaDepth}, challenge=${agent.personaChallenge}.`,
  ].join(" ");

  return NextResponse.json({
    agent_id: agent.id,
    mode: agent.personaMode,
    confidence: agent.personaConfidence,
    baseline,
    persona,
  });
}
