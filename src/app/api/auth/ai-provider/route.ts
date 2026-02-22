import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

// Provider choices — aligned with codeblog-app TUI PROVIDER_CHOICES
// Each choice maps to a core providerID + api format + default baseURL
interface ProviderChoice {
  name: string;
  providerID: string;
  api: "anthropic" | "openai" | "google" | "openai-compatible";
  baseURL: string;
}

const PROVIDER_CHOICES: ProviderChoice[] = [
  { name: "OpenAI", providerID: "openai", api: "openai", baseURL: "https://api.openai.com" },
  { name: "Anthropic", providerID: "anthropic", api: "anthropic", baseURL: "https://api.anthropic.com" },
  { name: "Google", providerID: "google", api: "google", baseURL: "https://generativelanguage.googleapis.com/v1beta/openai" },
  { name: "OpenRouter", providerID: "openai-compatible", api: "openai-compatible", baseURL: "https://openrouter.ai/api" },
  { name: "xAI (Grok)", providerID: "openai-compatible", api: "openai-compatible", baseURL: "https://api.x.ai" },
  { name: "DeepSeek", providerID: "openai-compatible", api: "openai-compatible", baseURL: "https://api.deepseek.com" },
  { name: "Groq", providerID: "openai-compatible", api: "openai-compatible", baseURL: "https://api.groq.com/openai" },
  { name: "Perplexity", providerID: "openai-compatible", api: "openai-compatible", baseURL: "https://api.perplexity.ai" },
  { name: "Together AI", providerID: "openai-compatible", api: "openai-compatible", baseURL: "https://api.together.xyz" },
  { name: "Moonshot AI", providerID: "openai-compatible", api: "openai-compatible", baseURL: "https://api.moonshot.ai" },
  { name: "MiniMax", providerID: "openai-compatible", api: "openai-compatible", baseURL: "https://api.minimax.io" },
  { name: "Hugging Face", providerID: "openai-compatible", api: "openai-compatible", baseURL: "https://router.huggingface.co" },
  { name: "Qianfan", providerID: "openai-compatible", api: "openai-compatible", baseURL: "https://qianfan.baidubce.com" },
  { name: "Vercel AI Gateway", providerID: "openai-compatible", api: "openai-compatible", baseURL: "https://ai-gateway.vercel.sh" },
  { name: "vLLM", providerID: "openai-compatible", api: "openai-compatible", baseURL: "http://127.0.0.1:8000" },
  { name: "LiteLLM", providerID: "openai-compatible", api: "openai-compatible", baseURL: "http://localhost:4000" },
  { name: "Xiaomi", providerID: "anthropic", api: "anthropic", baseURL: "https://api.xiaomimimo.com/anthropic" },
  { name: "Synthetic", providerID: "anthropic", api: "anthropic", baseURL: "https://api.synthetic.new" },
  { name: "Cloudflare AI Gateway", providerID: "anthropic", api: "anthropic", baseURL: "" },
  { name: "Custom Provider", providerID: "openai-compatible", api: "openai-compatible", baseURL: "" },
];

type ModelApi = "anthropic" | "openai" | "google" | "openai-compatible";

function compatProfileForApi(api: ModelApi): string {
  return api; // In codeblog-app: compat_profile defaults to same as api
}

const PROVIDER_ID_DEFAULT_BASE_URL: Record<"openai" | "anthropic" | "google", string> = {
  openai: "https://api.openai.com",
  anthropic: "https://api.anthropic.com",
  google: "https://generativelanguage.googleapis.com/v1beta/openai",
};

// GET /api/auth/ai-provider — Get current user's AI provider config + available choices
export async function GET() {
  try {
    const userId = await getCurrentUser();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const provider = await prisma.userAiProvider.findUnique({
      where: { userId },
    });

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { aiCreditCents: true, aiCreditGranted: true },
    });

    return NextResponse.json({
      provider: provider
        ? {
            provider: provider.provider,
            baseUrl: provider.baseUrl,
            model: provider.model,
            api: provider.api,
            compatProfile: provider.compatProfile,
            displayName: provider.displayName,
            hasApiKey: true,
            createdAt: provider.createdAt.toISOString(),
            updatedAt: provider.updatedAt.toISOString(),
          }
        : null,
      credit: {
        balanceCents: user?.aiCreditCents ?? 0,
        balanceUsd: ((user?.aiCreditCents ?? 0) / 100).toFixed(2),
        granted: user?.aiCreditGranted ?? false,
      },
      // Return provider choices so frontend stays in sync
      choices: PROVIDER_CHOICES.map((c) => ({
        name: c.name,
        providerID: c.providerID,
        api: c.api,
        baseURL: c.baseURL || "",
      })),
    });
  } catch (error) {
    console.error("Get AI provider error:", error);
    return NextResponse.json({ error: "Failed to get AI provider" }, { status: 500 });
  }
}

// PUT /api/auth/ai-provider — Save AI provider config
export async function PUT(req: NextRequest) {
  try {
    const userId = await getCurrentUser();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { displayName, providerID, apiKey, baseUrl, model, api } = body;

    if (!apiKey) {
      return NextResponse.json({ error: "apiKey is required" }, { status: 400 });
    }

    // Resolve from displayName (preferred) or providerID
    let resolvedProviderID: string;
    let resolvedApi: ModelApi;
    let resolvedBaseUrl = (typeof baseUrl === "string" ? baseUrl.trim() : "").replace(/\/+$/, "") || null;

    if (displayName) {
      // Find from PROVIDER_CHOICES by display name
      const choice = PROVIDER_CHOICES.find((c) => c.name === displayName);
      if (choice) {
        resolvedProviderID = choice.providerID;
        resolvedApi = choice.api;
        // Use choice's default baseURL if user didn't provide one
        if (!resolvedBaseUrl && choice.baseURL) {
          resolvedBaseUrl = choice.baseURL;
        }
        if (!resolvedBaseUrl && !choice.baseURL) {
          return NextResponse.json(
            { error: `${choice.name} requires a baseUrl` },
            { status: 400 }
          );
        }
      } else {
        // Unknown display name → treat as custom openai-compatible
        resolvedProviderID = "openai-compatible";
        resolvedApi = "openai-compatible";
        if (!resolvedBaseUrl) {
          return NextResponse.json(
            { error: "baseUrl is required for custom providers" },
            { status: 400 }
          );
        }
      }
    } else if (providerID) {
      // Legacy path: direct providerID
      const validProviderIDs = ["openai", "anthropic", "google", "openai-compatible"];
      if (!validProviderIDs.includes(providerID)) {
        return NextResponse.json(
          { error: `Invalid providerID. Must be one of: ${validProviderIDs.join(", ")}` },
          { status: 400 }
        );
      }
      resolvedProviderID = providerID;
      resolvedApi = (api as ModelApi) || (providerID === "anthropic" ? "anthropic" : providerID === "google" ? "google" : providerID === "openai" ? "openai" : "openai-compatible");
      if (!resolvedBaseUrl && providerID !== "openai-compatible") {
        resolvedBaseUrl = PROVIDER_ID_DEFAULT_BASE_URL[providerID as keyof typeof PROVIDER_ID_DEFAULT_BASE_URL];
      }
      if (!resolvedBaseUrl && providerID === "openai-compatible") {
        return NextResponse.json(
          { error: "baseUrl is required for openai-compatible providers" },
          { status: 400 }
        );
      }
    } else {
      return NextResponse.json({ error: "displayName or providerID is required" }, { status: 400 });
    }

    if (resolvedBaseUrl) {
      try {
        const parsed = new URL(resolvedBaseUrl);
        if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
          return NextResponse.json({ error: "baseUrl must use http or https" }, { status: 400 });
        }
      } catch {
        return NextResponse.json({ error: "Invalid baseUrl" }, { status: 400 });
      }
    }

    const resolvedCompatProfile = compatProfileForApi(resolvedApi);

    const saved = await prisma.userAiProvider.upsert({
      where: { userId },
      create: {
        userId,
        provider: resolvedProviderID,
        apiKey,
        baseUrl: resolvedBaseUrl,
        model: model || null,
        api: resolvedApi,
        compatProfile: resolvedCompatProfile,
        displayName: displayName || null,
      },
      update: {
        provider: resolvedProviderID,
        apiKey,
        baseUrl: resolvedBaseUrl,
        model: model || null,
        api: resolvedApi,
        compatProfile: resolvedCompatProfile,
        displayName: displayName || null,
      },
    });

    return NextResponse.json({
      provider: {
        provider: saved.provider,
        baseUrl: saved.baseUrl,
        model: saved.model,
        api: saved.api,
        compatProfile: saved.compatProfile,
        displayName: saved.displayName,
        hasApiKey: true,
      },
    });
  } catch (error) {
    console.error("Save AI provider error:", error);
    return NextResponse.json({ error: "Failed to save AI provider" }, { status: 500 });
  }
}

// DELETE /api/auth/ai-provider — Remove AI provider config (fall back to platform credit)
export async function DELETE() {
  try {
    const userId = await getCurrentUser();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await prisma.userAiProvider.deleteMany({ where: { userId } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete AI provider error:", error);
    return NextResponse.json({ error: "Failed to delete AI provider" }, { status: 500 });
  }
}
