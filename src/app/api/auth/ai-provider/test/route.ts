import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { resolveAiProviderForUser, type ResolvedAiProvider } from "@/lib/ai-provider";

function buildEndpoint(provider: ResolvedAiProvider): string {
  const baseUrl = provider.baseUrl.replace(/\/+$/, "");
  if (provider.api === "anthropic") {
    return `${baseUrl}/v1/messages`;
  }
  if (provider.api === "google") {
    return /\/v1beta\/openai$/i.test(baseUrl)
      ? `${baseUrl}/chat/completions`
      : `${baseUrl}/v1beta/openai/chat/completions`;
  }
  return `${baseUrl}/v1/chat/completions`;
}

function buildHeaders(provider: ResolvedAiProvider): Record<string, string> {
  if (provider.api === "anthropic") {
    return {
      "Content-Type": "application/json",
      "x-api-key": provider.apiKey,
      "anthropic-version": "2023-06-01",
    };
  }
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${provider.apiKey}`,
  };
}

function buildBody(provider: ResolvedAiProvider, withMaxTokens: boolean): string {
  if (provider.api === "anthropic") {
    const body: Record<string, unknown> = {
      model: provider.model,
      messages: [{ role: "user", content: "say 1" }],
    };
    if (withMaxTokens) body.max_tokens = 1;
    return JSON.stringify(body);
  }
  const body: Record<string, unknown> = {
    model: provider.model,
    messages: [{ role: "user", content: "say 1" }],
  };
  if (withMaxTokens) body.max_tokens = 1;
  return JSON.stringify(body);
}

function classifyError(status: number): string {
  if (status === 401 || status === 403) return "auth";
  if (status === 404) return "endpoint";
  if (status === 429) return "rate_limit";
  return "unknown";
}

// POST /api/auth/ai-provider/test — Test connectivity of saved AI provider
export async function POST() {
  try {
    const userId = await getCurrentUser();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const provider = await resolveAiProviderForUser(userId);
    if (!provider) {
      return NextResponse.json(
        { ok: false, error: "No AI provider configured and no platform credit available" },
        { status: 200 },
      );
    }

    const endpoint = buildEndpoint(provider);
    const headers = buildHeaders(provider);

    // First attempt: with max_tokens=1
    const res1 = await fetch(endpoint, {
      method: "POST",
      headers,
      body: buildBody(provider, true),
      signal: AbortSignal.timeout(15_000),
    });

    if (res1.ok) {
      return NextResponse.json({
        ok: true,
        source: provider.source,
        provider: provider.api,
        model: provider.model,
      });
    }

    const errorType = classifyError(res1.status);

    // Auth / endpoint errors won't be fixed by removing max_tokens
    if (errorType === "auth" || errorType === "endpoint" || errorType === "rate_limit") {
      let detail = "";
      try {
        const body = await res1.json();
        detail = (body as Record<string, unknown>).error
          ? String((body as Record<string, { message?: string }>).error?.message || (body as Record<string, unknown>).error)
          : "";
      } catch {}
      return NextResponse.json({
        ok: false,
        error: `${res1.status}${detail ? `: ${detail}` : ""}`,
        source: provider.source,
        provider: provider.api,
        model: provider.model,
      });
    }

    // Second attempt: without max_tokens (some providers don't support it)
    const res2 = await fetch(endpoint, {
      method: "POST",
      headers,
      body: buildBody(provider, false),
      signal: AbortSignal.timeout(15_000),
    });

    if (res2.ok) {
      return NextResponse.json({
        ok: true,
        source: provider.source,
        provider: provider.api,
        model: provider.model,
      });
    }

    let detail = "";
    try {
      const body = await res2.json();
      detail = (body as Record<string, unknown>).error
        ? String((body as Record<string, { message?: string }>).error?.message || (body as Record<string, unknown>).error)
        : "";
    } catch {}

    return NextResponse.json({
      ok: false,
      error: `${res2.status}${detail ? `: ${detail}` : ""}`,
      source: provider.source,
      provider: provider.api,
      model: provider.model,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      return NextResponse.json({ ok: false, error: "Connection timed out (15s)" });
    }
    return NextResponse.json(
      { ok: false, error: `Connection failed: ${error instanceof Error ? error.message : String(error)}` },
    );
  }
}
