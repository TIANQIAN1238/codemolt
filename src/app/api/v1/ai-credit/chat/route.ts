import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { withApiAuth, type ApiAuth } from "@/lib/api-auth";

const API_KEY = process.env.AI_PROXY_API_KEY || "";
const BASE_URL = (process.env.AI_PROXY_BASE_URL || "https://api.openai-next.com/v1").replace(/\/+$/, "");
const MODEL = process.env.AI_PROXY_MODEL || "claude-sonnet-4-5-20250929";

// Cost per 1M tokens in cents (conservative estimate)
const INPUT_COST_PER_M = 300;   // $3/M input tokens
const OUTPUT_COST_PER_M = 1500; // $15/M output tokens
// Minimum balance required to start a request
const MIN_BALANCE_CENTS = 5;
// Pre-deduct amount to reserve before streaming (prevents concurrent abuse)
const PRE_DEDUCT_CENTS = 5;
// Rate limit: max requests per user per minute
const RATE_LIMIT_PER_MIN = 10;

function estimateCostCents(inputTokens: number, outputTokens: number): number {
  const cost = (inputTokens / 1_000_000) * INPUT_COST_PER_M
             + (outputTokens / 1_000_000) * OUTPUT_COST_PER_M;
  return Math.max(1, Math.ceil(cost));
}

// Simple in-memory rate limiter (per-user, per-minute)
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

// Cleanup stale buckets every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of rateBuckets) {
    if (now > bucket.resetAt) rateBuckets.delete(key);
  }
}, 300_000);

export const POST = withApiAuth(async (req: NextRequest, auth: ApiAuth) => {
  if (!API_KEY) {
    return NextResponse.json({ error: "AI proxy not configured" }, { status: 503 });
  }

  // Rate limit check
  if (!checkRateLimit(auth.userId)) {
    return NextResponse.json(
      { error: "Too many requests. Please wait a moment." },
      { status: 429 },
    );
  }

  // Atomically pre-deduct balance to prevent concurrent abuse
  let preDeducted = false;
  try {
    const result = await prisma.user.updateMany({
      where: { id: auth.userId, aiCreditCents: { gte: MIN_BALANCE_CENTS } },
      data: { aiCreditCents: { decrement: PRE_DEDUCT_CENTS } },
    });
    if (result.count === 0) {
      return NextResponse.json(
        { error: "Insufficient credit. Configure your own API key: codeblog ai setup", balance_cents: 0 },
        { status: 402 },
      );
    }
    preDeducted = true;
  } catch {
    return NextResponse.json(
      { error: "Insufficient credit", balance_cents: 0 },
      { status: 402 },
    );
  }

  const body = await req.json();
  body.model = MODEL;
  body.stream = true;
  body.stream_options = { include_usage: true };

  const upstream = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!upstream.ok) {
    // Refund pre-deduction on upstream failure
    if (preDeducted) {
      await prisma.user.update({
        where: { id: auth.userId },
        data: { aiCreditCents: { increment: PRE_DEDUCT_CENTS } },
      }).catch(() => {});
    }
    console.error(`[ai-credit] upstream error: ${upstream.status}`);
    return NextResponse.json(
      { error: "AI service temporarily unavailable" },
      { status: 503 },
    );
  }
  const upstreamBody = upstream.body;
  if (!upstreamBody) {
    if (preDeducted) {
      await prisma.user.update({
        where: { id: auth.userId },
        data: { aiCreditCents: { increment: PRE_DEDUCT_CENTS } },
      }).catch(() => {});
    }
    return NextResponse.json({ error: "No response body from upstream" }, { status: 502 });
  }

  let inputTokens = 0;
  let outputTokens = 0;
  const userId = auth.userId;
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
      // Reconcile: actual cost vs pre-deducted amount
      const actualCost = estimateCostCents(inputTokens, outputTokens);
      const diff = actualCost - PRE_DEDUCT_CENTS;
      try {
        if (diff > 0) {
          // Actual cost exceeded pre-deduction, charge the difference
          await prisma.user.update({
            where: { id: userId },
            data: { aiCreditCents: { decrement: diff } },
          });
        } else if (diff < 0) {
          // Actual cost was less, refund the difference
          await prisma.user.update({
            where: { id: userId },
            data: { aiCreditCents: { increment: -diff } },
          });
        }
        // diff === 0: pre-deduction was exact, nothing to do
      } catch (err) {
        console.error("[ai-credit] reconcile failed:", err);
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
});
