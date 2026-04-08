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
  // ── Bare "faf" → go straight to dashboard (QuickReply handles action buttons) ──
  { pattern: /^faf$/i, action: "dashboard", toolName: "faf_dashboard" },

  // ── Dashboard (many natural forms) ──
  { pattern: /^faf\s+(status|dashboard|info)$/i, action: "dashboard", toolName: "faf_dashboard" },
  { pattern: /^show\s+(?:my\s+)?faf/i, action: "dashboard", toolName: "faf_dashboard" },
  { pattern: /^(?:my\s+)?faf\s+(?:staking|stake)\s*(?:status|info|dashboard)?$/i, action: "dashboard", toolName: "faf_dashboard" },
  { pattern: /^(?:what(?:'s| is)\s+)?my\s+faf/i, action: "dashboard", toolName: "faf_dashboard" },
  { pattern: /^faf\s+(rewards?|earnings?|balance)$/i, action: "dashboard", toolName: "faf_dashboard" },
  { pattern: /^faf\s+(points?|voltage)$/i, action: "dashboard", toolName: "faf_dashboard" },
  { pattern: /^how much (?:faf )?(?:do i have |have i )?stak/i, action: "dashboard", toolName: "faf_dashboard" },

  // ── Unstake (with amount) — MUST be before stake patterns (regex "stake" matches inside "unstake") ──
  { pattern: /^(?:faf\s+)?unstake\s+(\d+(?:\.\d+)?)\s*(?:faf)?$/i, action: "unstake", toolName: "faf_unstake", extract: (m) => ({ amount: parseFloat(m[1]) }) },
  { pattern: /^unstake\s+(\d+(?:\.\d+)?)\s+faf/i, action: "unstake", toolName: "faf_unstake", extract: (m) => ({ amount: parseFloat(m[1]) }) },
  { pattern: /(?:want|wanna|like)\s+to\s+unstake\s+(\d+(?:\.\d+)?)\s*(?:faf)?/i, action: "unstake", toolName: "faf_unstake", extract: (m) => ({ amount: parseFloat(m[1]) }) },
  { pattern: /unstake\s+(\d+(?:\.\d+)?)\s*(?:faf|tokens?)?/i, action: "unstake", toolName: "faf_unstake", extract: (m) => ({ amount: parseFloat(m[1]) }) },

  // ── Unstake (no amount → prompt) ──
  { pattern: /^faf\s+unstake$/i, action: "unstake_prompt", toolName: "__prompt__" },
  { pattern: /(?:want|wanna|like)\s+to\s+unstake\s+(?:my\s+)?(?:faf|tokens?)?\s*$/i, action: "unstake_prompt", toolName: "__prompt__" },
  { pattern: /^unstake\s+(?:my\s+)?(?:faf|tokens?)\s*$/i, action: "unstake_prompt", toolName: "__prompt__" },

  // ── Stake (with amount — many natural forms) ──
  { pattern: /^(?:faf\s+)?stake\s+(\d+(?:\.\d+)?)\s*(?:faf)?$/i, action: "stake", toolName: "faf_stake", extract: (m) => ({ amount: parseFloat(m[1]) }) },
  { pattern: /^faf\s+stake\s+(\d+(?:\.\d+)?)/i, action: "stake", toolName: "faf_stake", extract: (m) => ({ amount: parseFloat(m[1]) }) },
  { pattern: /^stake\s+(\d+(?:\.\d+)?)\s+faf/i, action: "stake", toolName: "faf_stake", extract: (m) => ({ amount: parseFloat(m[1]) }) },
  { pattern: /(?:want|wanna|like)\s+to\s+(?!un)stake\s+(\d+(?:\.\d+)?)\s*(?:faf)?/i, action: "stake", toolName: "faf_stake", extract: (m) => ({ amount: parseFloat(m[1]) }) },
  { pattern: /(?<!un)stake\s+(\d+(?:\.\d+)?)\s*(?:faf|tokens?)?/i, action: "stake", toolName: "faf_stake", extract: (m) => ({ amount: parseFloat(m[1]) }) },

  // ── Stake (no amount → prompt) ──
  { pattern: /^faf\s+stake$/i, action: "stake_prompt", toolName: "__prompt__" },
  { pattern: /(?:want|wanna|like)\s+to\s+(?!un)stake\s+(?:my\s+)?(?:faf|tokens?)\s*$/i, action: "stake_prompt", toolName: "__prompt__" },
  { pattern: /^stake\s+(?:my\s+)?(?:faf|tokens?)\s*$/i, action: "stake_prompt", toolName: "__prompt__" },

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

// Button-triggered intents return Galileo-style option cards (rendered by OptionsCard)
const CONVERSATIONAL_INTENTS: { pattern: RegExp; toolName: string; data: Record<string, unknown> }[] = [
  {
    pattern: /^I want to trade$/i,
    toolName: "action_options",
    data: {
      type: "action_options",
      title: "What would you like to trade?",
      options: [
        { label: "Long SOL", intent: "long SOL 5x $25", description: "5x leverage, $25 collateral" },
        { label: "Short SOL", intent: "short SOL 3x $25", description: "3x leverage, $25 collateral" },
        { label: "Long BTC", intent: "long BTC 5x $50", description: "5x leverage, $50 collateral" },
        { label: "Long ETH", intent: "long ETH 5x $25", description: "5x leverage, $25 collateral" },
        { label: "All markets", intent: "show all prices", description: "View prices + open interest" },
      ],
    },
  },
  {
    pattern: /^I want to earn yield$/i,
    toolName: "action_options",
    data: {
      type: "action_options",
      title: "Choose a pool to start earning",
      options: [
        { label: "See available pools", intent: "what earn pools are available and their APY?", description: "View pool APYs" },
        { label: "Deposit to Crypto pool", intent: "deposit 50 USDC into crypto pool", description: "Crypto.1 pool" },
        { label: "Deposit to DeFi pool", intent: "deposit 50 USDC into defi pool", description: "Governance pool" },
        { label: "My earn positions", intent: "show my earn positions", description: "Current deposits" },
      ],
    },
  },
  {
    pattern: /^I want to transfer tokens$/i,
    toolName: "transfer_picker",
    data: {
      type: "transfer_picker",
      title: "Transfer Tokens",
      tokens: ["SOL", "USDC"],
    },
  },
  {
    pattern: /^show my portfolio$/i,
    toolName: "action_options",
    data: {
      type: "action_options",
      title: "Portfolio",
      options: [
        { label: "My positions", intent: "show my positions", description: "Open trades" },
        { label: "Wallet balances", intent: "what are my token balances?", description: "All tokens" },
        { label: "Portfolio risk", intent: "analyze my portfolio risk and exposure", description: "Risk analysis" },
        { label: "FAF staking", intent: "faf", description: "Staking dashboard" },
      ],
    },
  },
];

function matchConversationalIntent(input: string): (typeof CONVERSATIONAL_INTENTS)[number] | null {
  const trimmed = input.trim();
  for (const intent of CONVERSATIONAL_INTENTS) {
    if (intent.pattern.test(trimmed)) return intent;
  }
  return null;
}

// ---- Direct Tool Matching (NO AI — deterministic regex → tool.execute()) ----

interface DirectToolMatch {
  toolName: string;
  params: Record<string, unknown>;
}

const MARKET_ALIASES: Record<string, string> = {
  sol: "SOL", solana: "SOL", btc: "BTC", bitcoin: "BTC", eth: "ETH", ethereum: "ETH",
  sui: "SUI", jup: "JUP", jupiter: "JUP", bonk: "BONK", wif: "WIF", pepe: "PEPE",
  doge: "DOGE", dogecoin: "DOGE", avax: "AVAX", ada: "ADA", xrp: "XRP", link: "LINK",
  matic: "MATIC", arb: "ARB", op: "OP", apt: "APT", near: "NEAR", atom: "ATOM",
  dot: "DOT", ltc: "LTC", bnb: "BNB", trump: "TRUMP", render: "RENDER", ray: "RAY",
  ondo: "ONDO", hnt: "HNT", pyth: "PYTH", jto: "JTO", wen: "WEN", w: "W",
  tnsr: "TNSR", kmno: "KMNO", fartcoin: "FARTCOIN", pengu: "PENGU", me: "ME",
  s: "S", aave: "AAVE", ena: "ENA", tia: "TIA", sei: "SEI", orca: "ORCA",
};

function resolveMarket(input: string): string {
  const lower = input.toLowerCase().trim();
  return MARKET_ALIASES[lower] ?? input.toUpperCase();
}

function matchDirectTool(input: string): DirectToolMatch | null {
  const t = input.toLowerCase().trim();

  // ── Price queries ──
  // "price of SOL", "SOL price", "what's SOL at", "how much is BTC", "price SOL", "btc?"
  let m: RegExpExecArray | null;

  m = /^(?:price\s+(?:of\s+)?|what(?:'s| is)\s+(?:the\s+)?(?:price\s+(?:of\s+)?)?|how\s+much\s+is\s+)(\w+)(?:\s+(?:price|at|worth|trading|cost))?[?\s]*$/i.exec(t);
  if (m) return { toolName: "get_price", params: { market: resolveMarket(m[1]) } };

  m = /^(\w+)\s+price[?\s]*$/i.exec(t);
  if (m) return { toolName: "get_price", params: { market: resolveMarket(m[1]) } };

  m = /^(\w{2,10})\?$/i.exec(t);
  if (m && MARKET_ALIASES[m[1].toLowerCase()]) return { toolName: "get_price", params: { market: resolveMarket(m[1]) } };

  // ── All prices / markets ──
  if (/^(?:prices|all\s+prices|show\s+(?:all\s+)?prices|markets|all\s+markets|show\s+(?:all\s+)?markets)$/i.test(t)) {
    return { toolName: "get_all_prices", params: {} };
  }

  // ── Positions ──
  if (/^(?:(?:show\s+)?(?:my\s+)?positions?|(?:my\s+)?open\s+(?:trades?|positions?)|(?:show\s+)?(?:my\s+)?trades?)$/i.test(t)) {
    return { toolName: "get_positions", params: {} };
  }

  // ── Portfolio ──
  if (/^(?:portfolio|(?:show\s+)?(?:my\s+)?portfolio|(?:my\s+)?(?:wallet\s+)?balance[s]?|(?:show\s+)?(?:my\s+)?balance[s]?|(?:what(?:'s| is| are)\s+)?(?:my\s+)?(?:token\s+)?balance[s]?)$/i.test(t)) {
    return { toolName: "get_portfolio", params: {} };
  }

  // ── Market info ──
  m = /^(?:(?:market\s+)?info\s+(?:on\s+|for\s+)?|(?:show\s+)?(?:market\s+)?(?:info|details|stats)\s+(?:for\s+|on\s+)?)(\w+)$/i.exec(t);
  if (m) return { toolName: "get_market_info", params: { market: resolveMarket(m[1]) } };

  // ── Close position ──
  m = /^(?:close|exit|flatten)\s+(?:my\s+)?(\w+)(?:\s+(?:position|trade|long|short))?$/i.exec(t);
  if (m) return { toolName: "close_position_preview", params: { market: resolveMarket(m[1]) } };

  // ── Transfer: "send 0.1 SOL to <address>" ──
  m = /^(?:send|transfer)\s+(\d+(?:\.\d+)?)\s+(\w+)\s+to\s+([1-9A-HJ-NP-Za-km-z]{32,44})$/i.exec(t);
  if (m) return { toolName: "transfer_preview", params: { token: m[2].toUpperCase(), amount: parseFloat(m[1]), recipient: m[3] } };

  // ── Earn pools ──
  if (/^(?:(?:what\s+)?(?:earn\s+)?pools?|(?:show\s+)?(?:available\s+)?pools?|(?:earn|yield)\s+(?:pools?|options?)|(?:what\s+(?:earn\s+)?pools?\s+(?:are\s+)?available))/i.test(t)) {
    return { toolName: "earn_deposit", params: { action: "list" } };
  }

  // ── Earn deposit: "deposit 50 USDC into crypto pool" ──
  m = /^deposit\s+(\d+(?:\.\d+)?)\s+(\w+)\s+(?:into?|to)\s+(\w+)\s*(?:pool)?$/i.exec(t);
  if (m) return { toolName: "earn_deposit", params: { amount: parseFloat(m[1]), token: m[2].toUpperCase(), pool: m[3].toLowerCase() } };

  // ── Show earn positions ──
  if (/^(?:(?:show\s+)?(?:my\s+)?earn(?:ing)?\s+(?:positions?|deposits?)|(?:my\s+)?(?:earn|yield)\s+(?:positions?|deposits?))$/i.test(t)) {
    return { toolName: "earn_deposit", params: { action: "positions" } };
  }

  // ── Transfer history ──
  if (/^(?:(?:show\s+)?(?:my\s+)?transfer(?:s|\s+history)?|(?:my\s+)?(?:spending|transaction)\s*(?:history|patterns?)?)$/i.test(t)) {
    return { toolName: "transfer_history", params: {} };
  }

  // ── Help ──
  if (/^(?:help|what\s+can\s+you\s+do|commands?|what\s+(?:do|can)\s+(?:you|i)\s+(?:do|use))$/i.test(t)) {
    return null; // Let AI handle help
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

  // ---- CONVERSATIONAL FAST PATH: button intents → Galileo-style option cards ----
  {
    const convMatch = matchConversationalIntent(lastUserText);
    if (convMatch) {
      logInfo("fast_path", { wallet: walletAddress, data: { type: "conversational", input: lastUserText.slice(0, 40) } });
      return createFafStreamResponse(convMatch.toolName, {
        status: "success",
        data: convMatch.data,
        request_id: `opt_${Date.now()}`,
        latency_ms: 0,
      });
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

  // ---- DIRECT TOOL FAST PATH: common queries → call tool directly (NO AI) ----
  {
    const t = lastUserText.trim();
    const directMatch = matchDirectTool(t);
    if (directMatch) {
      logInfo("fast_path", { wallet: walletAddress, data: { type: "direct_tool", tool: directMatch.toolName, input: t.slice(0, 60) } });
      try {
        const toolFn = tools[directMatch.toolName as keyof typeof tools];
        if (toolFn && "execute" in toolFn) {
          const execFn = (toolFn as unknown as { execute: (params: Record<string, unknown>) => Promise<unknown> }).execute;
          const result = await execFn(directMatch.params) as Record<string, unknown>;
          if (result) {
            return createFafStreamResponse(directMatch.toolName, result);
          }
        }
      } catch (err) {
        logError("direct_tool", { wallet: walletAddress, error: err instanceof Error ? err.message : "unknown" });
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
