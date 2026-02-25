import prisma from "@/lib/prisma";

const PERSONA_DIMENSIONS = ["warmth", "humor", "directness", "depth", "challenge"] as const;
const DIMENSION_FIELD_MAP = {
  warmth: "personaWarmth",
  humor: "personaHumor",
  directness: "personaDirectness",
  depth: "personaDepth",
  challenge: "personaChallenge",
} as const;

const APPROVE_STEP = 2;
const REJECT_STEP = 4;
const TAKEOVER_CONFIDENCE_THRESHOLD = 0.55;
const DEFAULT_REJECT_DIMENSIONS: PersonaDimension[] = ["directness", "depth"];

export type PersonaDimension = (typeof PERSONA_DIMENSIONS)[number];
export type PersonaSnapshotSource = "manual" | "auto_promote" | "auto_rollback";

type DimensionDeltaMap = Record<PersonaDimension, number>;

function clampSlider(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizeDimensions(input?: PersonaDimension[] | null): PersonaDimension[] {
  if (!Array.isArray(input) || input.length === 0) return [];
  const seen = new Set<PersonaDimension>();
  for (const dimension of input) {
    if (PERSONA_DIMENSIONS.includes(dimension) && !seen.has(dimension)) {
      seen.add(dimension);
    }
  }
  return Array.from(seen);
}

function parseDimensions(raw: string | null): PersonaDimension[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return normalizeDimensions(parsed.filter((row): row is PersonaDimension => typeof row === "string") as PersonaDimension[]);
  } catch {
    return [];
  }
}

function serializeDimensions(dimensions: PersonaDimension[]): string | null {
  return dimensions.length > 0 ? JSON.stringify(dimensions) : null;
}

function createEmptyDeltaMap(): DimensionDeltaMap {
  return {
    warmth: 0,
    humor: 0,
    directness: 0,
    depth: 0,
    challenge: 0,
  };
}

function buildApplyData(
  sliders: {
    personaWarmth: number;
    personaHumor: number;
    personaDirectness: number;
    personaDepth: number;
    personaChallenge: number;
  },
  dimensions: PersonaDimension[],
  delta: number,
): { data: Record<string, number | Date>; deltaMap: DimensionDeltaMap } {
  const next = {
    personaWarmth: sliders.personaWarmth,
    personaHumor: sliders.personaHumor,
    personaDirectness: sliders.personaDirectness,
    personaDepth: sliders.personaDepth,
    personaChallenge: sliders.personaChallenge,
  };
  const deltaMap = createEmptyDeltaMap();
  for (const dimension of dimensions) {
    const key = DIMENSION_FIELD_MAP[dimension];
    const current = next[key];
    const updated = clampSlider(current + delta);
    next[key] = updated;
    deltaMap[dimension] = updated - current;
  }

  return {
    data: {
      ...next,
      personaLastLearnAt: new Date(),
    },
    deltaMap,
  };
}

export function inferPersonaDimensionsFromText(input: string): PersonaDimension[] {
  const text = input.toLowerCase();
  const dimensions = new Set<PersonaDimension>();

  if (/(formal|正式|生硬|冷冰冰)/.test(text)) {
    dimensions.add("warmth");
  }
  if (/(casual|随意|轻浮|玩笑)/.test(text)) {
    dimensions.add("directness");
  }
  if (/(verbose|啰嗦|太长|冗长|废话)/.test(text)) {
    dimensions.add("directness");
    dimensions.add("depth");
  }
  if (/(harsh|强硬|攻击性|咄咄逼人)/.test(text)) {
    dimensions.add("warmth");
    dimensions.add("challenge");
  }
  if (/(boring|无趣|没意思)/.test(text)) {
    dimensions.add("humor");
  }
  if (/(style good|风格很好|满意|不错|很好)/.test(text)) {
    PERSONA_DIMENSIONS.forEach((dimension) => dimensions.add(dimension));
  }

  return Array.from(dimensions);
}

export async function recordPersonaSignal(args: {
  agentId: string;
  signalType: string;
  direction: -1 | 0 | 1;
  dimensions?: PersonaDimension[];
  note?: string | null;
  weight?: number;
  source: string;
  notificationId?: string | null;
}) {
  const dimensions = normalizeDimensions(args.dimensions);
  return prisma.agentPersonaSignal.create({
    data: {
      agentId: args.agentId,
      signalType: args.signalType,
      direction: args.direction,
      dimensions: serializeDimensions(dimensions),
      note: args.note?.trim().slice(0, 400) || null,
      weight: Math.max(1, Math.floor(args.weight ?? 1)),
      source: args.source,
      notificationId: args.notificationId || null,
    },
    select: {
      id: true,
      signalType: true,
      direction: true,
      dimensions: true,
      createdAt: true,
      notificationId: true,
    },
  });
}

export async function applyPersonaDelta(args: {
  agentId: string;
  direction: -1 | 0 | 1;
  dimensions?: PersonaDimension[];
  undoNotificationId?: string | null;
}): Promise<{
  applied: boolean;
  dimensions: PersonaDimension[];
  deltaMap: DimensionDeltaMap;
}> {
  const agent = await prisma.agent.findUnique({
    where: { id: args.agentId },
    select: {
      id: true,
      personaWarmth: true,
      personaHumor: true,
      personaDirectness: true,
      personaDepth: true,
      personaChallenge: true,
    },
  });
  if (!agent) {
    throw new Error("persona_agent_not_found");
  }

  if (args.direction === 0) {
    const rejectSignal = await prisma.agentPersonaSignal.findFirst({
      where: {
        agentId: args.agentId,
        signalType: "review_reject",
        direction: -1,
        ...(args.undoNotificationId ? { notificationId: args.undoNotificationId } : {}),
      },
      orderBy: { createdAt: "desc" },
      select: { dimensions: true },
    });

    if (!rejectSignal) {
      return { applied: false, dimensions: [], deltaMap: createEmptyDeltaMap() };
    }
    const storedDimensions = normalizeDimensions(parseDimensions(rejectSignal.dimensions || null));
    const dimensions: PersonaDimension[] = storedDimensions.length > 0 ? storedDimensions : DEFAULT_REJECT_DIMENSIONS;

    const { data, deltaMap } = buildApplyData(agent, dimensions, REJECT_STEP);
    await prisma.agent.update({
      where: { id: args.agentId },
      data,
    });
    return { applied: true, dimensions, deltaMap };
  }

  const baseDimensions = normalizeDimensions(args.dimensions);
  const dimensions: PersonaDimension[] = baseDimensions.length > 0 ? baseDimensions : DEFAULT_REJECT_DIMENSIONS;
  const delta = args.direction > 0 ? APPROVE_STEP : -REJECT_STEP;
  const { data, deltaMap } = buildApplyData(agent, dimensions, delta);
  await prisma.agent.update({
    where: { id: args.agentId },
    data,
  });
  return { applied: true, dimensions, deltaMap };
}

export async function recomputePersonaConfidence(agentId: string): Promise<number> {
  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const signals = await prisma.agentPersonaSignal.findMany({
    where: { agentId, createdAt: { gte: since } },
    orderBy: { createdAt: "asc" },
    select: {
      signalType: true,
      direction: true,
      weight: true,
    },
  });

  const reviewSignals = signals.filter((signal) =>
    signal.signalType === "review_approve" || signal.signalType === "review_reject",
  );
  const approveCount = reviewSignals.filter((signal) => signal.signalType === "review_approve").length;
  const rejectCount = reviewSignals.filter((signal) => signal.signalType === "review_reject").length;
  const totalReview = reviewSignals.length;

  const approvalRate = totalReview > 0 ? approveCount / totalReview : 0.5;
  const rejectRate = totalReview > 0 ? rejectCount / totalReview : 0;
  const signalDensity = Math.min(signals.length / 30, 1);

  const nonZeroDirections = signals.map((signal) => signal.direction).filter((direction) => direction !== 0);
  let consistencyScore = 0.5;
  if (nonZeroDirections.length >= 2) {
    let switches = 0;
    for (let i = 1; i < nonZeroDirections.length; i += 1) {
      const prev = nonZeroDirections[i - 1];
      const current = nonZeroDirections[i];
      if ((prev > 0 && current < 0) || (prev < 0 && current > 0)) {
        switches += 1;
      }
    }
    const switchRate = switches / (nonZeroDirections.length - 1);
    consistencyScore = Math.max(0, 1 - switchRate);
  }

  const confidenceRaw = (
    0.45 * approvalRate
    + 0.25 * (1 - rejectRate)
    + 0.2 * signalDensity
    + 0.1 * consistencyScore
  );
  const confidence = Math.max(0, Math.min(1, confidenceRaw));

  await prisma.agent.update({
    where: { id: agentId },
    data: { personaConfidence: confidence },
  });
  return confidence;
}

export async function snapshotPersona(args: {
  agentId: string;
  source: PersonaSnapshotSource;
}) {
  const agent = await prisma.agent.findUnique({
    where: { id: args.agentId },
    select: {
      id: true,
      personaVersion: true,
      personaPreset: true,
      personaWarmth: true,
      personaHumor: true,
      personaDirectness: true,
      personaDepth: true,
      personaChallenge: true,
      personaConfidence: true,
    },
  });
  if (!agent) {
    throw new Error("persona_agent_not_found");
  }

  const nextVersion = agent.personaVersion + 1;
  const snapshot = await prisma.agentPersonaSnapshot.upsert({
    where: {
      agentId_version: {
        agentId: args.agentId,
        version: nextVersion,
      },
    },
    update: {
      preset: agent.personaPreset,
      warmth: agent.personaWarmth,
      humor: agent.personaHumor,
      directness: agent.personaDirectness,
      depth: agent.personaDepth,
      challenge: agent.personaChallenge,
      confidence: agent.personaConfidence,
      source: args.source,
    },
    create: {
      agentId: args.agentId,
      version: nextVersion,
      preset: agent.personaPreset,
      warmth: agent.personaWarmth,
      humor: agent.personaHumor,
      directness: agent.personaDirectness,
      depth: agent.personaDepth,
      challenge: agent.personaChallenge,
      confidence: agent.personaConfidence,
      source: args.source,
    },
    select: {
      id: true,
      version: true,
      source: true,
    },
  });

  await prisma.agent.update({
    where: { id: args.agentId },
    data: {
      personaVersion: nextVersion,
      ...(args.source === "auto_promote" ? { personaLastPromotedAt: new Date() } : {}),
    },
  });

  return snapshot;
}

export async function rollbackPersonaIfNeeded(agentId: string): Promise<{
  rolledBack: boolean;
  reason?: string;
}> {
  const modeState = await prisma.agent.findUnique({
    where: { id: agentId },
    select: { personaMode: true },
  });
  if (!modeState) {
    return { rolledBack: false, reason: "agent_not_found" };
  }
  if (modeState.personaMode !== "live") {
    return { rolledBack: false, reason: "mode_not_live" };
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recentReviews = await prisma.agentPersonaSignal.findMany({
    where: {
      agentId,
      createdAt: { gte: since },
      signalType: { in: ["review_approve", "review_reject"] },
    },
    orderBy: { createdAt: "desc" },
    select: { signalType: true },
  });

  if (recentReviews.length === 0) {
    return { rolledBack: false };
  }

  const rejectCount = recentReviews.filter((signal) => signal.signalType === "review_reject").length;
  const rejectRate = rejectCount / recentReviews.length;
  let consecutiveRejects = 0;
  for (const signal of recentReviews) {
    if (signal.signalType === "review_reject") {
      consecutiveRejects += 1;
    } else {
      break;
    }
  }

  if (rejectRate <= 0.25 && consecutiveRejects < 5) {
    return { rolledBack: false };
  }

  const rollbackTarget = await prisma.agentPersonaSnapshot.findFirst({
    where: {
      agentId,
      source: { in: ["manual", "auto_promote"] },
    },
    orderBy: [{ version: "desc" }],
    select: {
      preset: true,
      warmth: true,
      humor: true,
      directness: true,
      depth: true,
      challenge: true,
      confidence: true,
    },
  });

  if (!rollbackTarget) {
    return { rolledBack: false, reason: "no_snapshot" };
  }

  await prisma.agent.update({
    where: { id: agentId },
    data: {
      personaPreset: rollbackTarget.preset,
      personaWarmth: rollbackTarget.warmth,
      personaHumor: rollbackTarget.humor,
      personaDirectness: rollbackTarget.directness,
      personaDepth: rollbackTarget.depth,
      personaChallenge: rollbackTarget.challenge,
      personaConfidence: rollbackTarget.confidence,
      personaMode: "shadow",
    },
  });

  await snapshotPersona({
    agentId,
    source: "auto_rollback",
  });

  return {
    rolledBack: true,
    reason: rejectRate > 0.25 ? "reject_rate" : "consecutive_reject",
  };
}

export async function shouldTakeoverBeforePublish(agentId: string): Promise<boolean> {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: { personaConfidence: true },
  });
  if (!agent) return false;
  return agent.personaConfidence < TAKEOVER_CONFIDENCE_THRESHOLD;
}
