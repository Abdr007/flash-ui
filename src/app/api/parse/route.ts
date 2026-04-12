// AI Fallback Parser — Server-side only
// Called when deterministic regex parser returns "unknown".
// Uses Groq (Llama 3.3 70B) for structured intent extraction.
// Returns strict JSON schema — no explanations, no markdown.
// GROQ_API_KEY never exposed to client.

import { NextRequest, NextResponse } from "next/server";
import { getClientIp, RateLimiter, rateLimitResponse, checkBodySize, sanitizeLlmInput } from "@/lib/api-security";

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.3-70b-versatile";
const TIMEOUT_MS = 8_000;
const MAX_BODY_BYTES = 2_000;

const SYSTEM_PROMPT = `You are a trading assistant embedded in a perpetual futures trading terminal (Flash.trade on Solana).

You have TWO jobs:

JOB 1: If the user wants to trade, extract a structured intent as JSON:
{
  "intent": "OPEN_POSITION" | "CLOSE_POSITION" | "REDUCE_POSITION" | "MODIFY_TRADE" | "SET_SL" | "SET_TP" | "CANCEL" | "QUERY",
  "market": "BTC" | "ETH" | "SOL" | "BNB" | "JUP" | "PYTH" | "BONK" | "WIF" | "PENGU" | "FARTCOIN" | "ORE" | "XAU" | "SPY" | "NVDA" | "TSLA" | null,
  "direction": "LONG" | "SHORT" | null,
  "collateral_usd": number | null,
  "leverage": number | null,
  "stop_loss": number | null,
  "take_profit": number | null,
  "reduce_percent": number | null
}

Trading rules:
- "long", "buy", "ape" → OPEN_POSITION + LONG
- "short", "sell" → OPEN_POSITION + SHORT
- "close", "exit" → CLOSE_POSITION
- "reduce", "half" → REDUCE_POSITION
- "make it", "change" → MODIFY_TRADE
- "SL", "stop loss" → SET_SL
- "TP", "take profit" → SET_TP
- "cancel", "abort" → CANCEL
- "price", "positions" → QUERY
- "$100" → collateral_usd: 100, "5x" → leverage: 5, "2%" → 2
- If uncertain about a field, set null

JOB 2: If the user is NOT trading (greeting, question, conversation), return:
{"intent": "QUERY", "reply": "your short response here"}

Keep replies SHORT (1-2 sentences max). You are a terminal, not a chatbot.
You know about: perpetual futures, leverage, liquidation, Flash.trade, Solana, Pyth oracles.
Personality: direct, helpful, no fluff.

Examples:
- "hello" → {"intent": "QUERY", "reply": "Ready. What do you want to trade?"}
- "what markets do you support" → {"intent": "QUERY", "reply": "SOL, BTC, ETH, BNB, JUP, BONK, WIF, NVDA, TSLA, and more. Type 'long SOL 10 2x' to start."}
- "what is leverage" → {"intent": "QUERY", "reply": "Leverage multiplies your position size. 5x on $100 = $500 position. Higher leverage = closer liquidation."}
- "how does this work" → {"intent": "QUERY", "reply": "Type a trade command like 'long SOL 100 5x'. I'll show a preview, you confirm, then sign with your wallet."}

Output ONLY valid JSON. No markdown. No explanation outside JSON.`;

// Rate limit: 15 req/min per IP
const limiter = new RateLimiter(15);

export async function POST(req: NextRequest) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "AI parser not configured" }, { status: 503 });
  }

  // ---- Rate Limit (trusted IP) ----
  const ip = getClientIp(req);
  if (!limiter.check(ip)) return rateLimitResponse();

  // ---- Body Size Limit ----
  const sizeCheck = checkBodySize(req, MAX_BODY_BYTES);
  if (sizeCheck) return sizeCheck;

  try {
    const { input } = await req.json();
    if (!input || typeof input !== "string" || input.length > 500) {
      return NextResponse.json({ error: "invalid_input" }, { status: 400 });
    }

    // Sanitize input before sending to LLM
    const cleanInput = sanitizeLlmInput(input, 500);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const res = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: cleanInput },
        ],
        temperature: 0,
        max_tokens: 200,
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!res.ok) {
      return NextResponse.json({ error: "groq_error" }, { status: 502 });
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content?.trim();

    if (!content) {
      return NextResponse.json({ error: "empty_response" }, { status: 502 });
    }

    // Parse the JSON response — strip markdown fences if present
    const cleaned = content.replace(/^```json?\s*/, "").replace(/\s*```$/, "").trim();
    const parsed = JSON.parse(cleaned);

    // Validate required field
    if (!parsed.intent && !parsed.error) {
      return NextResponse.json({ error: "invalid_schema" }, { status: 422 });
    }

    return NextResponse.json(parsed);
  } catch {
    return NextResponse.json({ error: "parse_failed" }, { status: 500 });
  }
}
