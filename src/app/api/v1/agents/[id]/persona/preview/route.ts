import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifyBearerAuth, extractBearerToken } from "@/lib/agent-auth";
import { getCurrentUser } from "@/lib/auth";
import {
  extractJsonObject,
  refundPlatformCredit,
  reservePlatformCredit,
  resolveAiProviderForUser,
  runModelTextCompletion,
} from "@/lib/ai-provider";

async function getAuthUserId(req: NextRequest): Promise<string | null> {
  const token = extractBearerToken(req.headers.get("authorization"));
  const agentAuth = token ? await verifyBearerAuth(token) : null;
  return agentAuth?.userId || (await getCurrentUser());
}

const PERSONA_PREVIEW_COST_CENTS = 1;

type LocaleHint = "zh" | "en";

function parsePreviewPayload(text: string): { baseline: string; persona: string } | null {
  const obj = extractJsonObject(text);
  if (!obj) return null;
  const baseline = typeof obj.baseline === "string" ? obj.baseline.trim() : "";
  const persona = typeof obj.persona === "string" ? obj.persona.trim() : "";
  if (!baseline || !persona) return null;
  return { baseline, persona };
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
  const locale: LocaleHint = body.locale === "zh" ? "zh" : "en";
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

  const provider = await resolveAiProviderForUser(userId);
  if (!provider) {
    return NextResponse.json({ error: "AI provider unavailable" }, { status: 400 });
  }

  const shouldCharge = provider.source === "platform";
  if (shouldCharge) {
    const reserved = await reservePlatformCredit(userId, PERSONA_PREVIEW_COST_CENTS);
    if (!reserved) {
      return NextResponse.json({ error: "Platform credit exhausted" }, { status: 400 });
    }
  }

  const systemPrompt = locale === "zh"
    ? [
        "你是数字分身写作风格预览助手。",
        "请返回严格 JSON：{\"baseline\":\"...\",\"persona\":\"...\"}。",
        "baseline：自然中性风格回复。",
        "persona：根据给定风格参数生成更贴近数字分身个性的回复。",
        "不要输出参数名、数值、技术术语解释，不要加 markdown。",
        "两段都要可直接给最终用户阅读。",
      ].join("\n")
    : [
        "You are a digital twin style preview assistant.",
        "Return strict JSON only: {\"baseline\":\"...\",\"persona\":\"...\"}.",
        "baseline: neutral natural response.",
        "persona: response adapted to the provided style controls.",
        "Do not mention parameter names, numbers, or technical terms.",
        "Both should be user-facing final text.",
      ].join("\n");

  const userPrompt = [
    `Agent: ${agent.name}`,
    `Scenario: ${scenario.replace(/\s+/g, " ").slice(0, 800)}`,
    "Persona controls:",
    `preset=${agent.personaPreset}`,
    `warmth=${agent.personaWarmth}`,
    `humor=${agent.personaHumor}`,
    `directness=${agent.personaDirectness}`,
    `depth=${agent.personaDepth}`,
    `challenge=${agent.personaChallenge}`,
    `mode=${agent.personaMode}`,
  ].join("\n");

  let text = "";
  try {
    const result = await runModelTextCompletion({
      provider,
      systemPrompt,
      userPrompt,
      maxTokens: 500,
      temperature: 0.4,
    });
    text = result.text;
  } catch (error) {
    if (shouldCharge) {
      await refundPlatformCredit(userId, PERSONA_PREVIEW_COST_CENTS).catch(() => {});
    }
    console.error("persona preview upstream failed", error);
    return NextResponse.json({ error: "Preview generation failed" }, { status: 502 });
  }

  const parsed = parsePreviewPayload(text);
  if (!parsed) {
    const compact = scenario.replace(/\s+/g, " ").slice(0, 160);
    const fallback = locale === "zh"
      ? {
          baseline: `这是一个稳妥、清晰的默认回复：${compact}`,
          persona: `这是更贴近当前数字分身语气的回复：${compact}`,
        }
      : {
          baseline: `Here is a clear and neutral baseline response: ${compact}`,
          persona: `Here is a response adapted to the current digital twin style: ${compact}`,
        };
    return NextResponse.json({
      agent_id: agent.id,
      mode: agent.personaMode,
      confidence: agent.personaConfidence,
      baseline: fallback.baseline,
      persona: fallback.persona,
    });
  }

  return NextResponse.json({
    agent_id: agent.id,
    mode: agent.personaMode,
    confidence: agent.personaConfidence,
    baseline: parsed.baseline,
    persona: parsed.persona,
  });
}
