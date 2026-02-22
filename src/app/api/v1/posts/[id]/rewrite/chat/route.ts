import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifyBearerAuth, extractBearerToken } from "@/lib/agent-auth";
import { getCurrentUser } from "@/lib/auth";

const PLATFORM_API_KEY = process.env.AI_PROXY_API_KEY || "";
const PLATFORM_BASE_URL = (process.env.AI_PROXY_BASE_URL || "https://api.openai-next.com").replace(/\/+$/, "");
const PLATFORM_MODEL = process.env.AI_PROXY_MODEL || "claude-sonnet-4-5-20250929";

const INPUT_COST_PER_M = 300;
const OUTPUT_COST_PER_M = 1500;
const MIN_BALANCE_CENTS = 5;
const PRE_DEDUCT_CENTS = 5;
const RATE_LIMIT_PER_MIN = 10;

function estimateCostCents(inputTokens: number, outputTokens: number): number {
  const cost =
    (inputTokens / 1_000_000) * INPUT_COST_PER_M +
    (outputTokens / 1_000_000) * OUTPUT_COST_PER_M;
  return Math.max(1, Math.ceil(cost));
}

const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(userId);
  if (!bucket || now > bucket.resetAt) {
    rateBuckets.set(userId, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (bucket.count >= RATE_LIMIT_PER_MIN) return false;
  bucket.count++;
  return true;
}

setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of rateBuckets) {
    if (now > bucket.resetAt) rateBuckets.delete(key);
  }
}, 300_000);

function buildSystemPrompt(post: {
  title: string;
  content: string;
  summary: string | null;
  tags: string;
  agent: { name: string; sourceType: string };
}): string {
  let tagsArr: string[];
  try {
    tagsArr = JSON.parse(post.tags) as string[];
  } catch {
    tagsArr = [];
  }
  const contentTruncated =
    post.content.length > 8000
      ? post.content.slice(0, 8000) + "\n\n[Content truncated for context window]"
      : post.content;

  return `You are a post editing assistant for CodeBlog, a developer community forum.

The user owns an AI Agent named "${post.agent.name}" (source: ${post.agent.sourceType}). This agent analyzed a coding session and wrote the following post. You are helping the user refine and edit this agent-generated post.

Current post state:
- Title: ${post.title}
- Tags: ${tagsArr.join(", ") || "(none)"}
- Summary: ${post.summary || "(none)"}
- Content:
${contentTruncated}

You can help the user:
1. Rewrite the post content with a different style or tone
2. Add, remove, or modify tags
3. Edit the title or summary
4. Add more details or restructure the content
5. Translate the post to a different language

When the user asks you to make changes, respond with a JSON block at the end of your message wrapped in \`\`\`json ... \`\`\` containing the fields to update. Only include fields that changed. Valid fields: "title", "content", "tags" (array of strings), "summary".

Example response format:
"I've rewritten the title and added the requested tag.

\`\`\`json
{
  "title": "New Title Here",
  "tags": ["existing-tag", "new-tag"]
}
\`\`\`"

Always explain what changes you're making before the JSON block. If the user just wants to chat or ask questions about the post, respond normally without a JSON block. Match the language of the user's message in your response.`;
}

// Resolve which AI provider to use for a given user
// Aligned with codeblog-app provider registry: uses api + baseUrl from UserAiProvider
async function resolveProvider(userId: string): Promise<{
  apiKey: string;
  baseUrl: string;
  model: string;
  api: string;
  source: "user" | "platform";
} | null> {
  // 1. Check if user has their own AI provider configured
  const userProvider = await prisma.userAiProvider.findUnique({
    where: { userId },
  });

  if (userProvider) {
    const baseUrl = (userProvider.baseUrl || "").replace(/\/+$/, "");
    const model = userProvider.model || "";
    const api = userProvider.api || "openai-compatible";

    // baseUrl and model should already be set by the save API
    // Fallback defaults for the 4 core provider types
    const DEFAULT_MODEL: Record<string, string> = {
      anthropic: "claude-sonnet-4-20250514",
      openai: "gpt-4o",
      google: "gemini-2.5-flash",
      "openai-compatible": "gpt-4o",
    };

    return {
      apiKey: userProvider.apiKey,
      baseUrl,
      model: model || DEFAULT_MODEL[api] || "gpt-4o",
      api,
      source: "user",
    };
  }

  // 2. Fall back to platform credit
  if (!PLATFORM_API_KEY) return null;

  return {
    apiKey: PLATFORM_API_KEY,
    baseUrl: PLATFORM_BASE_URL,
    model: PLATFORM_MODEL,
    api: "openai-compatible",
    source: "platform",
  };
}

// POST /api/v1/posts/[id]/rewrite/chat — AI-powered post rewrite chat
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const token = extractBearerToken(req.headers.get("authorization"));
    const agentAuth = token ? await verifyBearerAuth(token) : null;
    const userId = agentAuth?.userId || (await getCurrentUser());

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!checkRateLimit(userId)) {
      return NextResponse.json(
        { error: "Too many requests. Please wait a moment." },
        { status: 429 }
      );
    }

    const post = await prisma.post.findUnique({
      where: { id },
      select: {
        title: true,
        content: true,
        summary: true,
        tags: true,
        agent: { select: { userId: true, name: true, sourceType: true } },
      },
    });

    if (!post) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }

    if (post.agent.userId !== userId) {
      return NextResponse.json(
        { error: "You can only rewrite your own posts" },
        { status: 403 }
      );
    }

    const provider = await resolveProvider(userId);
    if (!provider) {
      return NextResponse.json(
        { error: "AI service not available. Please configure your AI provider in Settings." },
        { status: 503 }
      );
    }

    let body: { messages?: unknown };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const rawMessages = body.messages;

    // C2: Validate and sanitize user messages
    if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
      return NextResponse.json({ error: "messages must be a non-empty array" }, { status: 400 });
    }
    if (rawMessages.length > 50) {
      return NextResponse.json({ error: "Too many messages (max 50)" }, { status: 400 });
    }
    let totalContentLen = 0;
    const userMessages: { role: string; content: string }[] = [];
    for (const msg of rawMessages) {
      if (!msg || typeof msg.content !== "string") continue;
      // Only allow user and assistant roles — strip any injected system messages
      const role = msg.role === "assistant" ? "assistant" : "user";
      const content = msg.content.slice(0, 32_000); // cap individual message
      totalContentLen += content.length;
      if (totalContentLen > 100_000) {
        return NextResponse.json({ error: "Total message content too large" }, { status: 400 });
      }
      userMessages.push({ role, content });
    }

    // Inject system prompt server-side
    const messages = [
      { role: "system" as const, content: buildSystemPrompt(post) },
      ...userMessages,
    ];

    // Platform credit: pre-deduct only after request validation passes.
    let preDeducted = false;
    if (provider.source === "platform") {
      const result = await prisma.user.updateMany({
        where: { id: userId, aiCreditCents: { gte: MIN_BALANCE_CENTS } },
        data: { aiCreditCents: { decrement: PRE_DEDUCT_CENTS } },
      });
      if (result.count === 0) {
        return NextResponse.json(
          {
            error: "Insufficient credit. Configure your own AI provider in Settings.",
            balance_cents: 0,
          },
          { status: 402 }
        );
      }
      preDeducted = true;
    }

    let upstream: Response;

    if (provider.api === "anthropic") {
      // Anthropic native API: /v1/messages with x-api-key header
      const anthropicBody = {
        model: provider.model,
        max_tokens: 4096,
        system: buildSystemPrompt(post),
        messages: userMessages,
        stream: true,
      };

      upstream = await fetch(`${provider.baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": provider.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(anthropicBody),
      });
    } else {
      // OpenAI / OpenAI-compatible / Google(OpenAI-compat): chat/completions with Bearer
      const requestBody = {
        model: provider.model,
        messages,
        stream: true,
        stream_options: { include_usage: true },
      };

      const baseUrl = provider.baseUrl.replace(/\/+$/, "");
      const endpoint =
        provider.api === "google"
          ? /\/v1beta\/openai$/i.test(baseUrl)
            ? `${baseUrl}/chat/completions`
            : `${baseUrl}/v1beta/openai/chat/completions`
          : `${baseUrl}/v1/chat/completions`;

      upstream = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${provider.apiKey}`,
        },
        body: JSON.stringify(requestBody),
      });
    }

    if (!upstream.ok) {
      if (preDeducted) {
        await prisma.user
          .update({
            where: { id: userId },
            data: { aiCreditCents: { increment: PRE_DEDUCT_CENTS } },
          })
          .catch(() => {});
      }
      console.error(`[rewrite/chat] upstream error: ${upstream.status}`);
      return NextResponse.json(
        { error: "AI service temporarily unavailable" },
        { status: 503 }
      );
    }

    const upstreamBody = upstream.body;
    if (!upstreamBody) {
      if (preDeducted) {
        await prisma.user
          .update({
            where: { id: userId },
            data: { aiCreditCents: { increment: PRE_DEDUCT_CENTS } },
          })
          .catch(() => {});
      }
      return NextResponse.json(
        { error: "No response body from upstream" },
        { status: 502 }
      );
    }

    // Only do credit reconciliation for platform provider
    if (provider.source === "platform") {
      let inputTokens = 0;
      let outputTokens = 0;
      const uid = userId;
      let sseBuffer = "";

      const transform = new TransformStream({
        transform(chunk, controller) {
          controller.enqueue(chunk);
          sseBuffer += new TextDecoder().decode(chunk);
          const lines = sseBuffer.split("\n");
          sseBuffer = lines.pop() || "";
          for (const line of lines) {
            if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
            try {
              const data = JSON.parse(line.slice(6));
              if (data.usage) {
                inputTokens = data.usage.prompt_tokens || data.usage.input_tokens || 0;
                outputTokens = data.usage.completion_tokens || data.usage.output_tokens || 0;
              }
            } catch {}
          }
        },
        async flush() {
          if (sseBuffer.startsWith("data: ") && sseBuffer !== "data: [DONE]") {
            try {
              const data = JSON.parse(sseBuffer.slice(6));
              if (data.usage) {
                inputTokens = data.usage.prompt_tokens || data.usage.input_tokens || 0;
                outputTokens = data.usage.completion_tokens || data.usage.output_tokens || 0;
              }
            } catch {}
          }
          const actualCost = estimateCostCents(inputTokens, outputTokens);
          const diff = actualCost - PRE_DEDUCT_CENTS;
          try {
            if (diff > 0) {
              // Cap deduction at remaining balance to prevent negative credit
              await prisma.user.updateMany({
                where: { id: uid, aiCreditCents: { gte: diff } },
                data: { aiCreditCents: { decrement: diff } },
              });
            } else if (diff < 0) {
              await prisma.user.update({
                where: { id: uid },
                data: { aiCreditCents: { increment: -diff } },
              });
            }
          } catch (err) {
            console.error("[rewrite/chat] reconcile failed:", err);
          }
        },
      });

      const stream = upstreamBody.pipeThrough(transform);
      return new NextResponse(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }

    // User's own provider: passthrough (with Anthropic SSE → OpenAI SSE conversion if needed)
    if (provider.api === "anthropic") {
      // Convert Anthropic streaming format to OpenAI streaming format for frontend compatibility
      let anthropicBuffer = "";
      let doneEmitted = false;
      const anthropicTransform = new TransformStream({
        transform(chunk, controller) {
          anthropicBuffer += new TextDecoder().decode(chunk);
          const lines = anthropicBuffer.split("\n");
          anthropicBuffer = lines.pop() || "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === "content_block_delta" && data.delta?.text) {
                // Convert to OpenAI format
                const openaiChunk = {
                  choices: [{ index: 0, delta: { content: data.delta.text } }],
                };
                controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(openaiChunk)}\n\n`));
              } else if (data.type === "message_stop") {
                doneEmitted = true;
                controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
              }
            } catch {}
          }
        },
        flush(controller) {
          if (!doneEmitted) {
            controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
          }
        },
      });
      const stream = upstreamBody.pipeThrough(anthropicTransform);
      return new NextResponse(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }

    return new NextResponse(upstreamBody, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("Rewrite chat error:", error);
    return NextResponse.json({ error: "Failed to process rewrite" }, { status: 500 });
  }
}
