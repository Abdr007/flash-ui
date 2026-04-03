// AI Fallback Parser — Server-side only
// Called when deterministic regex parser returns "unknown".
// Uses Groq (Llama 3.3 70B) for structured intent extraction.
// Returns strict JSON schema — no explanations, no markdown.
// GROQ_API_KEY never exposed to client.

import { NextRequest, NextResponse } from "next/server";

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.3-70b-versatile";
const TIMEOUT_MS = 8_000;

const SYSTEM_PROMPT = `You are a trading intent extractor. Convert user input into a JSON object. Output ONLY valid JSON, nothing else.

Schema:
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

Rules:
- "long", "buy", "go long" → OPEN_POSITION + LONG
- "short", "sell", "go short" → OPEN_POSITION + SHORT
- "close", "exit" → CLOSE_POSITION
- "reduce", "half", "cut" → REDUCE_POSITION
- "make it", "change" → MODIFY_TRADE
- "SL", "stop loss" → SET_SL
- "TP", "take profit" → SET_TP
- "cancel", "abort", "nevermind" → CANCEL
- "price", "positions", "balance" → QUERY
- "$100" → collateral_usd: 100
- "5x" → leverage: 5
- "2%" for SL/TP → stop_loss/take_profit: 2
- "half" → reduce_percent: 50
- If uncertain about ANY field, set it to null
- If the input is completely unclear, return: {"error": "ambiguous"}
- For greetings or conversational inputs (hi, hello, how are you, etc.), return: {"intent": "QUERY", "reply": "Ready. Type a trade command."}
- For questions about what you can do, return: {"intent": "QUERY", "reply": "I execute perp trades. Try: Long SOL 100 5x"}
- Output ONLY the JSON object. No explanation. No markdown.`;

// Simple IP rate limit for this endpoint
const parseRateLimit = new Map<string, { count: number; resetAt: number }>();
const PARSE_LIMIT_PER_MIN = 15;

export async function POST(req: NextRequest) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "AI parser not configured" }, { status: 503 });
  }

  // Rate limit
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const now = Date.now();
  const entry = parseRateLimit.get(ip);
  if (entry && now < entry.resetAt && entry.count >= PARSE_LIMIT_PER_MIN) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  if (!entry || now >= entry.resetAt) {
    parseRateLimit.set(ip, { count: 1, resetAt: now + 60_000 });
  } else {
    entry.count++;
  }

  try {
    const { input } = await req.json();
    if (!input || typeof input !== "string" || input.length > 500) {
      return NextResponse.json({ error: "invalid_input" }, { status: 400 });
    }

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
          { role: "user", content: input },
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
