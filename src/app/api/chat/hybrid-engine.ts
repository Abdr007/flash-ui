// ============================================
// Flash AI — Hybrid Intent Engine
// ============================================
// Prioritizes deterministic regex parser BEFORE AI.
// AI is only used when the parser fails or has low confidence.
//
// Flow:
// 1. Try parseCommand() from lib/parser.ts (deterministic, instant)
// 2. If confidence >= 0.8 → return parsed intent, skip AI tool calling
// 3. If parser fails → let AI handle with full tool calling

import { parseCommand } from "@/lib/parser";
import type { ParsedIntent, Side } from "@/lib/types";
import { logInfo } from "@/lib/logger";

export interface HybridResult {
  source: "parser" | "ai";
  intent?: ParsedIntent;
  aiNeeded: boolean;
  parseResult?: ReturnType<typeof parseCommand>;
}

/**
 * Resolve user intent using parser-first strategy.
 * Returns whether AI tool calling is needed.
 */
export function resolveIntent(userMessage: string): HybridResult {
  const trimmed = userMessage.trim();
  if (!trimmed) {
    return { source: "ai", aiNeeded: true };
  }

  try {
    const result = parseCommand(trimmed);

    // Parser handled it with high confidence
    if (result.type !== "unknown" && (result.confidence ?? 0) >= 0.8) {
      logInfo("parser", {
        data: {
          type: result.type,
          confidence: result.confidence,
          market: result.intent?.market,
          side: result.intent?.side,
        },
      });

      return {
        source: "parser",
        intent: result.intent,
        aiNeeded: false,
        parseResult: result,
      };
    }

    // Parser returned something but low confidence — still give AI a chance
    // but pass the partial parse as context
    if (result.type !== "unknown" && (result.confidence ?? 0) >= 0.5) {
      logInfo("parser", {
        data: {
          type: result.type,
          confidence: result.confidence,
          low_confidence: true,
        },
      });

      return {
        source: "ai",
        intent: result.intent,
        aiNeeded: true,
        parseResult: result,
      };
    }

    // Parser failed — AI takes over fully
    return { source: "ai", aiNeeded: true };
  } catch {
    // Parser threw �� AI takes over
    return { source: "ai", aiNeeded: true };
  }
}

/**
 * Build a concise AI response for a parser-resolved trade intent.
 * Used when parser handles the intent and AI just needs to format the response.
 */
export function formatParserResponse(
  result: ReturnType<typeof parseCommand>,
): string | null {
  if (!result.intent) return null;

  const { type, market, side, collateral_usd, leverage } = result.intent;

  switch (result.type) {
    case "trade": {
      if (market && side && collateral_usd && leverage) {
        return (
          `Got it — building a ${side} ${market} position: ` +
          `$${collateral_usd} collateral at ${leverage}x leverage.`
        );
      }
      return null; // Incomplete — AI should handle
    }

    case "close": {
      if (market) {
        const sideStr = side ? ` ${side}` : "";
        return `Closing your${sideStr} ${market} position.`;
      }
      return null;
    }

    case "query": {
      // Queries should go through AI for tool calling
      return null;
    }

    default:
      return null;
  }
}
