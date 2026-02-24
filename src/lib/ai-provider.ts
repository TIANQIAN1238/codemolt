import prisma from "@/lib/prisma";

const PLATFORM_API_KEY = process.env.AI_PROXY_API_KEY || "";
const PLATFORM_BASE_URL = (
  process.env.AI_PROXY_BASE_URL || "https://api.openai-next.com"
).replace(/\/+$/, "");
const PLATFORM_MODEL = process.env.AI_PROXY_MODEL || "gpt-4o-mini";

const DEFAULT_MODEL: Record<string, string> = {
  anthropic: "claude-sonnet-4-20250514",
  openai: "gpt-4o",
  google: "gemini-2.5-flash",
  "openai-compatible": "gpt-4o-mini",
};

export type ResolvedAiProvider = {
  apiKey: string;
  baseUrl: string;
  model: string;
  api: "anthropic" | "openai" | "google" | "openai-compatible";
  source: "user" | "platform";
};

export type ModelUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

function normalizeApi(api: string | null | undefined): ResolvedAiProvider["api"] {
  if (api === "anthropic" || api === "openai" || api === "google" || api === "openai-compatible") {
    return api;
  }
  return "openai-compatible";
}

export async function resolveAiProviderForUser(
  userId: string,
): Promise<ResolvedAiProvider | null> {
  const userProvider = await prisma.userAiProvider.findUnique({
    where: { userId },
  });

  if (userProvider) {
    const api = normalizeApi(userProvider.api);
    const baseUrl = (userProvider.baseUrl || "").replace(/\/+$/, "");
    return {
      apiKey: userProvider.apiKey,
      baseUrl,
      model: userProvider.model || DEFAULT_MODEL[api],
      api,
      source: "user",
    };
  }

  if (!PLATFORM_API_KEY) {
    return null;
  }

  return {
    apiKey: PLATFORM_API_KEY,
    baseUrl: PLATFORM_BASE_URL,
    model: PLATFORM_MODEL,
    api: "openai-compatible",
    source: "platform",
  };
}

export async function reservePlatformCredit(
  userId: string,
  amountCents: number,
): Promise<boolean> {
  if (amountCents <= 0) return true;
  const result = await prisma.user.updateMany({
    where: { id: userId, aiCreditCents: { gte: amountCents } },
    data: { aiCreditCents: { decrement: amountCents } },
  });
  return result.count > 0;
}

export async function refundPlatformCredit(
  userId: string,
  amountCents: number,
): Promise<void> {
  if (amountCents <= 0) return;
  await prisma.user.update({
    where: { id: userId },
    data: { aiCreditCents: { increment: amountCents } },
  });
}

function parseUsage(data: Record<string, unknown>): ModelUsage {
  const usage = (data.usage || {}) as Record<string, unknown>;
  const inputTokens = Number(
    usage.prompt_tokens || usage.input_tokens || usage.cache_creation_input_tokens || 0,
  );
  const outputTokens = Number(usage.completion_tokens || usage.output_tokens || 0);
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
  };
}

export async function runModelTextCompletion(args: {
  provider: ResolvedAiProvider;
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
  temperature?: number;
}): Promise<{ text: string; usage: ModelUsage }> {
  const { provider, systemPrompt, userPrompt, maxTokens = 1200, temperature = 0.2 } = args;

  if (provider.api === "anthropic") {
    const res = await fetch(`${provider.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": provider.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: provider.model,
        max_tokens: maxTokens,
        temperature,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });
    if (!res.ok) {
      throw new Error(`AI upstream failed with status ${res.status}`);
    }
    const data = (await res.json()) as Record<string, unknown>;
    const content = Array.isArray(data.content) ? data.content : [];
    const text = content
      .map((part) => {
        const obj = part as Record<string, unknown>;
        return typeof obj.text === "string" ? obj.text : "";
      })
      .join("\n")
      .trim();
    return { text, usage: parseUsage(data) };
  }

  const baseUrl = provider.baseUrl.replace(/\/+$/, "");
  const endpoint =
    provider.api === "google"
      ? /\/v1beta\/openai$/i.test(baseUrl)
        ? `${baseUrl}/chat/completions`
        : `${baseUrl}/v1beta/openai/chat/completions`
      : `${baseUrl}/v1/chat/completions`;

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify({
      model: provider.model,
      temperature,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });

  if (!res.ok) {
    throw new Error(`AI upstream failed with status ${res.status}`);
  }

  const data = (await res.json()) as Record<string, unknown>;
  const choices = Array.isArray(data.choices) ? data.choices : [];
  const first = (choices[0] || {}) as Record<string, unknown>;
  const message = (first.message || {}) as Record<string, unknown>;
  const text = typeof message.content === "string" ? message.content.trim() : "";
  return { text, usage: parseUsage(data) };
}

export function extractJsonObject(text: string): Record<string, unknown> | null {
  const blockMatch = text.match(/```json\s*([\s\S]*?)\s*```/i);
  if (blockMatch?.[1]) {
    try {
      return JSON.parse(blockMatch[1]) as Record<string, unknown>;
    } catch {
      // fall through
    }
  }

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return null;
  }
  const raw = text.slice(firstBrace, lastBrace + 1);
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}
