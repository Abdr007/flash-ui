// ============================================
// Flash AI — Tool: build_trade
// ============================================
// CRITICAL: Full guard chain + firewall enforced.
//
// Execution order (STRICT):
// 1. Replay protection (request_id)
// 2. Wallet rate limit (5/sec, 20/10s)
// 3. Kill switch (TRADING_ENABLED)
// 4. Market resolution
// 5. Fetch data (price + positions)
// 6. Build trade preview
// 7. Firewall validation
// 8. Log firewall result (pass AND block)
// 9. Return response
//
// NEVER deduplicated — always fetches fresh price.
// No uncaught exceptions — wrapped in try/catch.

import { tool } from "ai";
import { z } from "zod";
import { fetchPrice, fetchPositions, fetchTradePreview } from "../flash-api";
import { makeRequestId } from "@/lib/tool-dedup";
import { withLatency, logError } from "@/lib/logger";
import { enforceFirewall } from "@/lib/trade-firewall";
import { MIN_COLLATERAL, MAX_LEVERAGE, DEFAULT_SLIPPAGE_BPS } from "@/lib/constants";
import type { ToolResponse } from "./shared";
import { validatePrice, isVolatilitySpike } from "@/lib/price-validator";
import {
  resolveMarket,
  runTradeGuards,
  withToolTimeout,
  logToolCall,
  logToolResult,
  logFirewallResult,
} from "./shared";

export function createBuildTradeTool(wallet: string) {
  return tool({
    description:
      "Build a trade preview with entry price, liquidation price, fees, and size. " +
      "Does NOT execute the trade — returns a preview for the user to confirm. " +
      "Supports take profit (tp) and stop loss (sl) prices. " +
      "Example: 'long SOL 5x $100 tp 200 sl 50'",
    inputSchema: z.object({
      market: z.string().describe("Market symbol (e.g., SOL, BTC)"),
      side: z.enum(["LONG", "SHORT"]).describe("Trade direction"),
      collateral_usd: z
        .number()
        .min(MIN_COLLATERAL)
        .describe("Collateral in USD"),
      leverage: z
        .number()
        .min(1)
        .max(MAX_LEVERAGE)
        .describe("Leverage multiplier"),
      take_profit_price: z
        .number()
        .positive()
        .optional()
        .describe("Take profit price — must be above entry for LONG, below for SHORT"),
      stop_loss_price: z
        .number()
        .positive()
        .optional()
        .describe("Stop loss price — must be below entry for LONG, above for SHORT"),
    }),
    execute: async ({
      market,
      side,
      collateral_usd,
      leverage,
      take_profit_price,
      stop_loss_price,
    }): Promise<ToolResponse<unknown>> => {
      const requestId = makeRequestId();

      try {
        // ---- STEP 1-3: Guard chain (replay → rate limit → kill switch) ----
        const guardBlock = runTradeGuards(requestId, wallet);
        if (guardBlock) return guardBlock;

        // ---- STEP 4: Market resolution ----
        const resolved = resolveMarket(market);
        if (!resolved) {
          return {
            status: "error",
            data: null,
            error: `Unknown market: ${market}`,
            request_id: requestId,
            latency_ms: 0,
          };
        }

        logToolCall("build_trade", requestId, wallet, {
          market: resolved,
          side,
          collateral_usd,
          leverage,
        });

        // ---- STEP 5: Fetch data with TIMEOUT (2s max) ----
        const { result: fetchResult, timedOut } = await withToolTimeout(
          async () => {
            const { result: r, latency_ms: l } = await withLatency(async () => {
              const [priceData, positions] = await Promise.all([
                fetchPrice(resolved),
                wallet ? fetchPositions(wallet) : Promise.resolve([]),
              ]);
              return { priceData, positions };
            });
            return { ...r, latency_ms: l };
          },
          null,
        );

        if (timedOut || !fetchResult) {
          return {
            status: "error",
            data: null,
            error: `${resolved} data fetch timed out (>2s) — try again`,
            request_id: requestId,
            latency_ms: 2000,
          };
        }

        const { priceData, positions: fetchedPositions } = fetchResult;
        const latency_ms = fetchResult.latency_ms;

        if (!priceData || priceData.price <= 0) {
          logToolResult("build_trade", requestId, wallet, latency_ms, "error", {
            reason: "price_fetch_failed",
          });
          return {
            status: "error",
            data: null,
            error: `Could not fetch ${resolved} price`,
            request_id: requestId,
            latency_ms,
          };
        }

        // ---- STEP 5b: Volatility circuit breaker ----
        const volCheck = isVolatilitySpike(resolved);
        if (volCheck.spiked) {
          return {
            status: "error",
            data: null,
            error: `${resolved} volatility spike (${volCheck.range_pct.toFixed(1)}% range) — trading paused`,
            request_id: requestId,
            latency_ms,
          };
        }

        // ---- STEP 6: Build trade preview via Flash API ----
        const preview = await fetchTradePreview(resolved, side, collateral_usd, leverage);
        const entry_price = preview?.entry_price ?? priceData.price;
        const position_size = preview?.position_size ?? collateral_usd * leverage;
        const fee_rate = preview?.fee_rate ?? 0.0008;
        const fees = preview?.fees ?? position_size * fee_rate;
        const slippage_bps = DEFAULT_SLIPPAGE_BPS;
        const liquidation_price = preview?.liquidation_price ?? (
          side === "LONG"
            ? entry_price * (1 - 1 / leverage + 0.005)
            : entry_price * (1 + 1 / leverage - 0.005)
        );

        // ---- STEP 6b: Validate TP/SL — dynamic range + direction ----
        if (take_profit_price != null) {
          const dist = Math.abs(take_profit_price - entry_price) / entry_price;
          if (dist > 5.0) {
            return { status: "error", data: null, error: `Take profit $${take_profit_price} is >500% from market — unrealistic`, request_id: requestId, latency_ms };
          }
          if (dist < 0.001) {
            return { status: "error", data: null, error: `Take profit $${take_profit_price} is <0.1% from entry — too tight`, request_id: requestId, latency_ms };
          }
          if (side === "LONG" && take_profit_price <= entry_price) {
            return { status: "error", data: null, error: `Take profit ($${take_profit_price}) must be above entry ($${entry_price.toFixed(2)}) for LONG`, request_id: requestId, latency_ms };
          }
          if (side === "SHORT" && take_profit_price >= entry_price) {
            return { status: "error", data: null, error: `Take profit ($${take_profit_price}) must be below entry ($${entry_price.toFixed(2)}) for SHORT`, request_id: requestId, latency_ms };
          }
        }
        if (stop_loss_price != null) {
          const dist = Math.abs(stop_loss_price - entry_price) / entry_price;
          if (dist > 5.0) {
            return { status: "error", data: null, error: `Stop loss $${stop_loss_price} is >500% from market — unrealistic`, request_id: requestId, latency_ms };
          }
          if (dist < 0.001) {
            return { status: "error", data: null, error: `Stop loss $${stop_loss_price} is <0.1% from entry — too tight`, request_id: requestId, latency_ms };
          }
          if (side === "LONG" && stop_loss_price >= entry_price) {
            return { status: "error", data: null, error: `Stop loss ($${stop_loss_price}) must be below entry ($${entry_price.toFixed(2)}) for LONG`, request_id: requestId, latency_ms };
          }
          if (side === "SHORT" && stop_loss_price <= entry_price) {
            return { status: "error", data: null, error: `Stop loss ($${stop_loss_price}) must be above entry ($${entry_price.toFixed(2)}) for SHORT`, request_id: requestId, latency_ms };
          }
        }

        const tradePreview = {
          market: resolved,
          side,
          collateral_usd,
          leverage,
          entry_price,
          liquidation_price,
          position_size,
          fees,
          fee_rate,
          slippage_bps,
          ...(take_profit_price != null && { take_profit_price }),
          ...(stop_loss_price != null && { stop_loss_price }),
        };

        // ---- STEP 7: Firewall validation ----
        const firewall = enforceFirewall(
          "build_trade",
          tradePreview,
          wallet,
          fetchedPositions,
        );

        // ---- STEP 8: Log firewall result (ALWAYS — pass or block) ----
        logFirewallResult(
          "build_trade",
          requestId,
          wallet,
          firewall.blocked,
          firewall.errors,
          firewall.warnings,
        );

        if (firewall.blocked) {
          return {
            status: "error",
            data: null,
            error: `Trade failed validation: ${firewall.errors?.join("; ")}`,
            request_id: requestId,
            latency_ms,
          };
        }

        // ---- STEP 9: Return validated response ----
        logToolResult("build_trade", requestId, wallet, latency_ms, "success", {
          market: resolved,
          side,
        });

        return {
          status: "success",
          data: tradePreview,
          request_id: requestId,
          latency_ms,
          warnings: firewall.warnings,
        };
      } catch (err: unknown) {
        // No silent failures — structured error response
        const errorMsg = err instanceof Error ? err.message : "Unknown error in build_trade";
        logError("tool_result", {
          tool: "build_trade",
          request_id: requestId,
          wallet,
          error: errorMsg,
        });
        return {
          status: "error",
          data: null,
          error: errorMsg,
          request_id: requestId,
          latency_ms: 0,
        };
      }
    },
  });
}
