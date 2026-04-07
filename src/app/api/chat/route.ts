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
  smoothStream,
  type UIMessage,
} from "ai";
import { google } from "@ai-sdk/google";

import { getSystemPrompt } from "./system-prompt";
import { resolveIntent } from "./hybrid-engine";
import { tryFastPath } from "./fast-path";
import { fetchAllPrices, fetchPositions } from "./flash-api";
import { warmCache } from "./cache";
import { buildTools } from "./tools";
import { isReplay } from "@/lib/tool-dedup";
import { logInfo, logError, setTraceId } from "@/lib/logger";

// ---- FAF Fast Path (deterministic, no AI needed) ----

import { createUIMessageStream, createUIMessageStreamResponse } from "ai";

interface FafCommand {
  action: string;
  toolName: string;
  params: Record<string, unknown>;
}

const FAF_PATTERNS: { pattern: RegExp; action: string; toolName: string; extract?: (m: RegExpExecArray) => Record<string, unknown> }[] = [
  // ── Bare "faf" → show options (NOT dashboard) ──
  { pattern: /^faf$/i, action: "options", toolName: "__options__" },

  // ── Dashboard (many natural forms) ──
  { pattern: /^faf\s+(status|dashboard|info)$/i, action: "dashboard", toolName: "faf_dashboard" },
  { pattern: /^show\s+(?:my\s+)?faf/i, action: "dashboard", toolName: "faf_dashboard" },
  { pattern: /^(?:my\s+)?faf\s+(?:staking|stake)\s*(?:status|info|dashboard)?$/i, action: "dashboard", toolName: "faf_dashboard" },
  { pattern: /^(?:what(?:'s| is)\s+)?my\s+faf/i, action: "dashboard", toolName: "faf_dashboard" },
  { pattern: /^faf\s+(rewards?|earnings?|balance)$/i, action: "dashboard", toolName: "faf_dashboard" },
  { pattern: /^faf\s+(points?|voltage)$/i, action: "dashboard", toolName: "faf_dashboard" },
  { pattern: /^how much (?:faf )?(?:do i have |have i )?stak/i, action: "dashboard", toolName: "faf_dashboard" },

  // ── Stake (with amount — many natural forms) ──
  { pattern: /^(?:faf\s+)?stake\s+(\d+(?:\.\d+)?)\s*(?:faf)?$/i, action: "stake", toolName: "faf_stake", extract: (m) => ({ amount: parseFloat(m[1]) }) },
  { pattern: /^faf\s+stake\s+(\d+(?:\.\d+)?)/i, action: "stake", toolName: "faf_stake", extract: (m) => ({ amount: parseFloat(m[1]) }) },
  { pattern: /^stake\s+(\d+(?:\.\d+)?)\s+faf/i, action: "stake", toolName: "faf_stake", extract: (m) => ({ amount: parseFloat(m[1]) }) },
  { pattern: /(?:want|wanna|like)\s+to\s+stake\s+(\d+(?:\.\d+)?)\s*(?:faf)?/i, action: "stake", toolName: "faf_stake", extract: (m) => ({ amount: parseFloat(m[1]) }) },
  { pattern: /stake\s+(\d+(?:\.\d+)?)\s*(?:faf|tokens?)?/i, action: "stake", toolName: "faf_stake", extract: (m) => ({ amount: parseFloat(m[1]) }) },

  // ── Stake (no amount → prompt) ──
  { pattern: /^faf\s+stake$/i, action: "stake_prompt", toolName: "__prompt__" },
  { pattern: /(?:want|wanna|like)\s+to\s+stake\s+(?:my\s+)?(?:faf|tokens?)\s*$/i, action: "stake_prompt", toolName: "__prompt__" },
  { pattern: /^stake\s+(?:my\s+)?(?:faf|tokens?)\s*$/i, action: "stake_prompt", toolName: "__prompt__" },

  // ── Unstake (with amount — many natural forms) ──
  { pattern: /^(?:faf\s+)?unstake\s+(\d+(?:\.\d+)?)\s*(?:faf)?$/i, action: "unstake", toolName: "faf_unstake", extract: (m) => ({ amount: parseFloat(m[1]) }) },
  { pattern: /^unstake\s+(\d+(?:\.\d+)?)\s+faf/i, action: "unstake", toolName: "faf_unstake", extract: (m) => ({ amount: parseFloat(m[1]) }) },
  { pattern: /(?:want|wanna|like)\s+to\s+unstake\s+(\d+(?:\.\d+)?)\s*(?:faf)?/i, action: "unstake", toolName: "faf_unstake", extract: (m) => ({ amount: parseFloat(m[1]) }) },
  { pattern: /unstake\s+(\d+(?:\.\d+)?)\s*(?:faf|tokens?)?/i, action: "unstake", toolName: "faf_unstake", extract: (m) => ({ amount: parseFloat(m[1]) }) },

  // ── Unstake (no amount → prompt) ──
  { pattern: /^faf\s+unstake$/i, action: "unstake_prompt", toolName: "__prompt__" },
  { pattern: /(?:want|wanna|like)\s+to\s+unstake\s+(?:my\s+)?(?:faf|tokens?)?\s*$/i, action: "unstake_prompt", toolName: "__prompt__" },
  { pattern: /^unstake\s+(?:my\s+)?(?:faf|tokens?)\s*$/i, action: "unstake_prompt", toolName: "__prompt__" },

  // ── Claim (many natural forms) ──
  { pattern: /^faf\s+claim(?:\s+(all|rewards?|revenue))?$/i, action: "claim", toolName: "faf_claim", extract: (m) => ({ claim_type: m[1]?.replace(/s$/, "") ?? "all" }) },
  { pattern: /^claim\s+(?:my\s+)?(?:faf\s+)?(?:rewards?|revenue|earnings?)/i, action: "claim", toolName: "faf_claim", extract: () => ({ claim_type: "all" }) },
  { pattern: /^claim\s+(?:my\s+)?faf$/i, action: "claim", toolName: "faf_claim", extract: () => ({ claim_type: "all" }) },
  { pattern: /^(?:i\s+)?want\s+to\s+claim/i, action: "claim", toolName: "faf_claim", extract: () => ({ claim_type: "all" }) },
  { pattern: /^collect\s+(?:my\s+)?(?:faf\s+)?rewards?/i, action: "claim", toolName: "faf_claim", extract: () => ({ claim_type: "all" }) },

  // ── Tiers ──
  { pattern: /^faf\s+(tier|tiers|vip)$/i, action: "tier", toolName: "faf_tier" },
  { pattern: /^(?:show\s+)?(?:vip\s+)?tiers?$/i, action: "tier", toolName: "faf_tier" },
  { pattern: /^(?:what(?:'s| is|are)\s+)?(?:the\s+)?(?:vip\s+)?tier/i, action: "tier", toolName: "faf_tier" },

  // ── Requests ──
  { pattern: /^faf\s+(requests?|pending|unstake\s+requests?)$/i, action: "requests", toolName: "faf_requests" },
  { pattern: /^(?:show\s+)?(?:my\s+)?(?:unstake\s+)?(?:pending\s+)?requests?$/i, action: "requests", toolName: "faf_requests" },

  // ── Cancel ──
  { pattern: /^faf\s+cancel\s+(\d+)$/i, action: "cancel", toolName: "faf_cancel_unstake", extract: (m) => ({ index: parseInt(m[1], 10) }) },
  { pattern: /^cancel\s+(?:unstake\s+)?(?:request\s+)?#?(\d+)$/i, action: "cancel", toolName: "faf_cancel_unstake", extract: (m) => ({ index: parseInt(m[1], 10) }) },
];

function matchFafCommand(input: string): FafCommand | null {
  const trimmed = input.trim();
  for (const p of FAF_PATTERNS) {
    const m = p.pattern.exec(trimmed);
    if (m) {
      return {
        action: p.action,
        toolName: p.toolName,
        params: p.extract ? p.extract(m) : {},
      };
    }
  }
  return null;
}

async function executeFafTool(
  cmd: FafCommand,
  wallet: string,
  tools: ReturnType<typeof buildTools>,
): Promise<Record<string, unknown> | null> {
  const toolFn = tools[cmd.toolName as keyof typeof tools];
  if (!toolFn || !("execute" in toolFn)) return null;

  // Call the tool's execute function directly
  const execFn = (toolFn as unknown as { execute: (params: Record<string, unknown>) => Promise<unknown> }).execute;
  const result = await execFn(cmd.params);
  return result as Record<string, unknown>;
}

function createFafStreamResponse(toolName: string, result: Record<string, unknown>): Response {
  const toolCallId = `faf_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  const stream = createUIMessageStream({
    execute: ({ writer }) => {
      writer.write({ type: "start" });
      writer.write({ type: "start-step" });

      writer.write({
        type: "tool-input-available",
        toolCallId,
        toolName,
        input: {},
      });

      writer.write({
        type: "tool-output-available",
        toolCallId,
        output: result,
      });

      writer.write({ type: "finish-step" });
      writer.write({ type: "finish" });
    },
  });

  return createUIMessageStreamResponse({ stream });
}

// ---- Conversational Intent Fast-Path (no AI needed) ----
// Returns text prompts for button-triggered intents when AI is unavailable

const CONVERSATIONAL_INTENTS: { pattern: RegExp; response: string }[] = [
  {
    pattern: /^I want to trade$/i,
    response:
      "**What do you want to trade?**\n\n" +
      "`long SOL 5x $25` — Long SOL, 5x leverage, $25 collateral\n" +
      "`short BTC 3x $50` — Short BTC, 3x leverage\n" +
      "`long ETH 5x $25` — Long ETH\n\n" +
      "Format: `long/short MARKET LEVx $AMOUNT`",
  },
  {
    pattern: /^I want to earn yield$/i,
    response:
      "**Earn Yield**\n\n" +
      "`deposit 50 USDC into crypto pool` — Crypto pool\n" +
      "`deposit 100 USDC into defi pool` — DeFi pool\n\n" +
      "Pools: crypto, defi, gold, meme, wif, fart, ore",
  },
  {
    pattern: /^I want to transfer tokens$/i,
    response:
      "**Transfer Tokens**\n\n" +
      "Tell me the token, amount, and recipient.\n\n" +
      "Example: `send 2 SOL to <wallet_address>`\n\n" +
      "I'll guide you step by step.",
  },
  {
    pattern: /^show my portfolio$/i,
    response:
      "**Portfolio**\n\n" +
      "`positions` — Open trading positions\n" +
      "`portfolio` — Full portfolio overview\n" +
      "`prices` — All market prices\n" +
      "`faf status` — FAF staking dashboard",
  },
];

function matchConversationalIntent(input: string): string | null {
  const trimmed = input.trim();
  for (const intent of CONVERSATIONAL_INTENTS) {
    if (intent.pattern.test(trimmed)) return intent.response;
  }
  return null;
}

function createFafTextResponse(text: string): Response {
  const id = `faf_text_${Date.now()}`;
  const stream = createUIMessageStream({
    execute: ({ writer }) => {
      writer.write({ type: "start" });
      writer.write({ type: "start-step" });
      writer.write({ type: "text-start", id });
      writer.write({ type: "text-delta", delta: text, id });
      writer.write({ type: "text-end", id });
      writer.write({ type: "finish-step" });
      writer.write({ type: "finish" });
    },
  });
  return createUIMessageStreamResponse({ stream });
}

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

  // 4. Warm cache (non-blocking — don't delay AI response)
  if (walletAddress) {
    warmCache(walletAddress, fetchAllPrices, fetchPositions).catch(() => {});
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

  // ---- FAST PATH: deterministic parse → direct tool result (NO AI, NO network) ----
  // Uses cached prices from previous requests. Fully synchronous parse + validate.
  // Positions passed from context (already available from previous chat state).
  {
    const ctxPositions = Array.isArray((context as Record<string, unknown>).positions)
      ? (context as Record<string, unknown>).positions as import("@/lib/types").Position[]
      : [];
    const fast = tryFastPath(lastUserText, walletAddress, ctxPositions);
    if (fast.matched && fast.response) {
      logInfo("fast_path", { wallet: walletAddress, data: { input: lastUserText.slice(0, 80) } });
      return fast.response;
    }
  }

  // ---- CONVERSATIONAL FAST PATH: button intents → text prompts (NO AI needed) ----
  {
    const convResponse = matchConversationalIntent(lastUserText);
    if (convResponse) {
      logInfo("fast_path", { wallet: walletAddress, data: { type: "conversational", input: lastUserText.slice(0, 40) } });
      return createFafTextResponse(convResponse);
    }
  }

  // ---- FAF FAST PATH: deterministic FAF command routing (NO AI needed) ----
  {
    const fafMatch = matchFafCommand(lastUserText);
    if (fafMatch) {
      logInfo("fast_path", { wallet: walletAddress, data: { type: "faf", command: fafMatch.action } });

      // Options → return a tool card with type "faf_options" (rendered as buttons by FafCard)
      if (fafMatch.action === "options") {
        return createFafStreamResponse("faf_dashboard", {
          status: "success",
          data: { type: "faf_options" },
          request_id: `faf_opt_${Date.now()}`,
          latency_ms: 0,
        });
      }

      // Hub and prompt actions return text — no tool card
      if (fafMatch.action === "hub") {
        return createFafTextResponse(
          "**FAF Staking Hub**\n\n" +
          "`faf status` — Dashboard (staked, rewards, tier)\n" +
          "`faf stake 1000` — Stake FAF tokens\n" +
          "`faf claim` — Claim FAF rewards + USDC revenue\n" +
          "`faf tiers` — View VIP tier levels\n" +
          "`faf requests` — Pending unstake requests\n" +
          "`faf unstake 500` — Unstake FAF tokens"
        );
      }
      if (fafMatch.action === "stake_prompt") {
        return createFafStreamResponse("faf_stake", {
          status: "success",
          data: { type: "faf_amount_picker", action: "stake", question: "How much FAF do you want to stake?", amounts: [50, 100, 500, 1000, 5000] },
          request_id: `faf_sp_${Date.now()}`, latency_ms: 0,
        });
      }
      if (fafMatch.action === "unstake_prompt") {
        return createFafStreamResponse("faf_unstake", {
          status: "success",
          data: { type: "faf_amount_picker", action: "unstake", question: "How much FAF do you want to unstake?", amounts: [50, 100, 200, 305] },
          request_id: `faf_up_${Date.now()}`, latency_ms: 0,
        });
      }

      try {
        const toolResult = await executeFafTool(fafMatch, walletAddress, tools);
        if (toolResult) {
          return createFafStreamResponse(fafMatch.toolName, toolResult);
        }
      } catch (err) {
        logError("fast_path", { wallet: walletAddress, error: err instanceof Error ? err.message : "unknown" });
      }
    }
  }

  // Simple greetings / casual messages — no tools needed
  const greetingPattern = /^(h(ello|i|ey|owdy)|gm|good\s*(morning|evening|night)|yo|sup|what'?s?\s*up|thanks?|ty|ok|okay|sure|yes|no|yep|nah)\b/i;
  try {

  if (greetingPattern.test(lastUserText.trim())) {
    const result = streamText({
      model: google("gemini-2.5-flash"),
      system: getSystemPrompt(context),
      messages: await convertToModelMessages(messages),
      experimental_transform: smoothStream(),
      temperature: 0,
      maxOutputTokens: 80,
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
      model: google("gemini-2.5-flash"),
      system: getSystemPrompt(context),
      messages: await convertToModelMessages(messages),
      tools,
      stopWhen: stepCountIs(3),
      experimental_transform: smoothStream(),
      temperature: 0,
      maxOutputTokens: 200,
    });

    return result.toUIMessageStreamResponse();
  }

  // Full AI path
    const result = streamText({
      model: google("gemini-2.5-flash"),
      system: getSystemPrompt(context),
      messages: await convertToModelMessages(messages),
      tools,
      stopWhen: stepCountIs(5),
      experimental_transform: smoothStream(),
      temperature: 0,
      maxOutputTokens: 400,
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
