// ============================================
// Flash AI — Chat API Route (Orchestrator)
// ============================================
// Thin orchestrator. All tool logic lives in ./tools/.
//
// Safety layers enforced here:
// 1. IP rate limiting
// 2. Replay protection (request_id dedup)
// 3. Cache warmup
// 4. Hybrid intent engine (parser-first)
// 5. Tool-level guards (kill switch, wallet rate limit, firewall)
//
// No heavy logic in this file — delegate to tools.

import {
  streamText,
  convertToModelMessages,
  stepCountIs,
  type UIMessage,
} from "ai";
import { groq } from "@ai-sdk/groq";

import { getSystemPrompt } from "./system-prompt";
import { resolveIntent } from "./hybrid-engine";
import { fetchAllPrices, fetchPositions } from "./flash-api";
import { warmCache } from "./cache";
import { buildTools } from "./tools";
import { isReplay } from "@/lib/tool-dedup";
import { logInfo, logError, setTraceId } from "@/lib/logger";

// ---- IP Rate Limiting ----

const ipRequests = new Map<string, { count: number; resetAt: number }>();
const IP_RATE_LIMIT = 20;
const IP_RATE_WINDOW_MS = 60_000;
const MAX_IP_ENTRIES = 1000; // [F2] Prevent unbounded growth

function checkIpRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = ipRequests.get(ip);

  if (!entry || now > entry.resetAt) {
    // [F2] Evict oldest if at capacity
    if (ipRequests.size >= MAX_IP_ENTRIES && !ipRequests.has(ip)) {
      const firstKey = ipRequests.keys().next().value;
      if (firstKey !== undefined) ipRequests.delete(firstKey);
    }
    ipRequests.set(ip, { count: 1, resetAt: now + IP_RATE_WINDOW_MS });
    return true;
  }

  if (entry.count >= IP_RATE_LIMIT) return false;
  entry.count++;
  return true;
}

// ---- POST Handler ----

// [B3] Max request body size (100KB — chat messages + context)
const MAX_BODY_SIZE = 100_000;

export async function POST(req: Request) {
  // 0. [B3] Body size guard
  const contentLength = req.headers.get("content-length");
  if (contentLength && parseInt(contentLength) > MAX_BODY_SIZE) {
    return new Response(
      JSON.stringify({ error: "Request too large" }),
      { status: 413, headers: { "Content-Type": "application/json" } },
    );
  }

  // 1. IP rate limit
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!checkIpRateLimit(ip)) {
    return new Response(
      JSON.stringify({ error: "Rate limit exceeded" }),
      { status: 429, headers: { "Content-Type": "application/json" } },
    );
  }

  // 2. Parse request (with error handling for malformed JSON)
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid JSON body" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const messages: UIMessage[] = Array.isArray(body.messages) ? body.messages : [];
  const walletAddress: string = typeof body.wallet_address === "string" ? body.wallet_address : "";
  const context = (typeof body.context === "object" && body.context !== null) ? body.context : {};
  const traceId: string =
    typeof body.trace_id === "string"
      ? body.trace_id
      : `trace_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  setTraceId(traceId);

  // 3. Replay protection
  const requestId = typeof body.request_id === "string" ? body.request_id : "";
  if (requestId && isReplay(requestId)) {
    logError("ai_request", {
      wallet: walletAddress,
      error: "Replay detected",
      data: { request_id: requestId },
    });
    return new Response(
      JSON.stringify({ error: "Duplicate request rejected" }),
      { status: 409, headers: { "Content-Type": "application/json" } },
    );
  }

  logInfo("ai_request", {
    wallet: walletAddress,
    data: { message_count: messages.length, trace_id: traceId },
  });

  // 4. Warm cache (wallet-scoped)
  if (walletAddress) {
    await warmCache(walletAddress, fetchAllPrices, fetchPositions);
  }

  // 5. Hybrid intent: try parser first
  const lastUserMsg = messages.filter((m) => m.role === "user").at(-1);
  const lastUserText =
    lastUserMsg?.parts
      ?.filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => p.text)
      .join(" ") ?? "";

  const hybrid = resolveIntent(lastUserText);

  // 6. Stream response (parser-fast or AI-full)
  const tools = buildTools(walletAddress);

  // Simple greetings / casual messages — no tools needed
  const greetingPattern = /^(h(ello|i|ey|owdy)|gm|good\s*(morning|evening|night)|yo|sup|what'?s?\s*up|thanks?|ty|ok|okay|sure|yes|no|yep|nah)\b/i;
  try {

  if (greetingPattern.test(lastUserText.trim())) {
    const result = streamText({
      model: groq("llama-3.1-8b-instant"),
      system: getSystemPrompt(context),
      messages: await convertToModelMessages(messages),
      temperature: 0,
      maxOutputTokens: 150,
    });
    return result.toUIMessageStreamResponse();
  }

  // Parser resolved a known intent — let AI call the right tool
  if (
    !hybrid.aiNeeded &&
    hybrid.parseResult &&
    hybrid.parseResult.type !== "unknown"
  ) {
    const result = streamText({
      model: groq("llama-3.1-8b-instant"),
      system: getSystemPrompt(context),
      messages: await convertToModelMessages(messages),
      tools,
      stopWhen: stepCountIs(3),
      temperature: 0,
      maxOutputTokens: 300,
    });

    return result.toUIMessageStreamResponse();
  }

  // Full AI path
    const result = streamText({
      model: groq("llama-3.1-8b-instant"),
      system: getSystemPrompt(context),
      messages: await convertToModelMessages(messages),
      tools,
      stopWhen: stepCountIs(5),
      temperature: 0,
      maxOutputTokens: 800,
    });

    return result.toUIMessageStreamResponse();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "AI processing failed";
    logError("ai_request", { wallet: walletAddress, error: msg });
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
