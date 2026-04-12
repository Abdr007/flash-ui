// ============================================
// Flash AI — Tool: add_collateral
// ============================================
// Adds collateral to an existing position, reducing leverage and
// moving liquidation price further from entry.

import { tool } from "ai";
import { z } from "zod";
import { fetchPositions, fetchPrice } from "../flash-api";
import { makeRequestId } from "@/lib/tool-dedup";
import { withLatency, logError } from "@/lib/logger";
import type { ToolResponse } from "./shared";
import { runTradeGuards, resolveMarket, logToolCall, logToolResult } from "./shared";

// Fetch accurate preview from Flash API transaction-builder
async function fetchCollateralPreview(
  positionKey: string, amount: string, market: string, owner: string
): Promise<{ newCollateralUsd: string; newLeverage: string; newLiquidationPrice: string } | null> {
  try {
    const url = `${process.env.NEXT_PUBLIC_FLASH_API_URL || "https://flashapi.trade"}/transaction-builder/add-collateral`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ positionKey, depositAmountUi: amount, depositTokenSymbol: market, owner }),
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (data.err) return null;
    return data;
  } catch {
    return null;
  }
}

export function createAddCollateralTool(wallet: string) {
  return tool({
    description:
      "Add collateral (USD) to an existing open position to reduce leverage and move liquidation price further away. Use when user says 'add collateral', 'add $X to my position', 'reduce leverage on', etc.",
    inputSchema: z.object({
      market: z.string().describe("Market symbol (e.g., SOL, BTC, ETH)"),
      side: z.enum(["LONG", "SHORT"]).describe("Position side"),
      amount_usd: z.number().min(1).describe("Amount of collateral to add in USD"),
    }),
    execute: async ({
      market,
      side,
      amount_usd,
    }): Promise<ToolResponse<unknown>> => {
      const requestId = makeRequestId();

      try {
        const guardBlock = runTradeGuards(requestId, wallet);
        if (guardBlock) return guardBlock;

        if (!wallet) {
          return { status: "error", data: null, error: "No wallet connected", request_id: requestId, latency_ms: 0 };
        }

        const resolved = resolveMarket(market);
        if (!resolved) {
          return { status: "error", data: null, error: `Unknown market: ${market}`, request_id: requestId, latency_ms: 0 };
        }

        logToolCall("add_collateral", requestId, wallet, { market: resolved, side, amount_usd });

        const { result, latency_ms } = await withLatency(async () => {
          const [positions, priceData] = await Promise.all([
            fetchPositions(wallet),
            fetchPrice(resolved),
          ]);
          return { positions, priceData };
        });

        const position = result.positions.find(
          (p) => p.market === resolved && p.side === side,
        );

        if (!position) {
          return {
            status: "error",
            data: null,
            error: `No ${side} ${resolved} position found`,
            request_id: requestId,
            latency_ms,
          };
        }

        const currentCollateral = position.collateral_usd;

        // Flash Trade website always deposits as USDC regardless of position collateral
        // The Flash program handles the internal swap (USDC→JitoSOL etc.)
        const collateralToken = "USDC";

        // Convert USD amount to token amount using current price
        const currentPrice = result.priceData?.price ?? position.mark_price;
        const tokenAmount = currentPrice > 0 ? (amount_usd / currentPrice) : 0;

        if (tokenAmount <= 0) {
          return {
            status: "error",
            data: null,
            error: "Could not calculate token amount — price unavailable",
            request_id: requestId,
            latency_ms,
          };
        }

        // Use Flash API for accurate preview (includes fees, funding, PnL)
        // depositAmountUi expects TOKEN amount, not USD
        const apiPreview = await fetchCollateralPreview(
          position.pubkey, tokenAmount.toFixed(6), collateralToken, wallet
        );

        const newCollateral = apiPreview
          ? parseFloat(apiPreview.newCollateralUsd)
          : currentCollateral + amount_usd;
        const newLeverage = apiPreview
          ? parseFloat(apiPreview.newLeverage)
          : position.size_usd / (currentCollateral + amount_usd);
        const mmr = Math.min(0.005, 0.5 / newLeverage);
        const newLiqPrice = apiPreview
          ? parseFloat(apiPreview.newLiquidationPrice)
          : (side === "LONG"
            ? position.entry_price * (1 - 1 / newLeverage + mmr)
            : position.entry_price * (1 + 1 / newLeverage - mmr));

        const markPrice = result.priceData?.price ?? position.mark_price;
        const currentLiqDistance = markPrice > 0
          ? (side === "LONG"
            ? ((markPrice - position.liquidation_price) / markPrice) * 100
            : ((position.liquidation_price - markPrice) / markPrice) * 100)
          : 0;
        const newLiqDistance = markPrice > 0
          ? (side === "LONG"
            ? ((markPrice - newLiqPrice) / markPrice) * 100
            : ((newLiqPrice - markPrice) / markPrice) * 100)
          : 0;

        logToolResult("add_collateral", requestId, wallet, latency_ms, "success");

        return {
          status: "success",
          data: {
            action: "add_collateral",
            market: resolved,
            side,
            amount_usd,
            current_collateral: currentCollateral,
            new_collateral: Math.round(newCollateral * 100) / 100,
            current_leverage: position.leverage,
            new_leverage: Math.round(newLeverage * 100) / 100,
            current_liq_price: position.liquidation_price,
            new_liq_price: Math.round(newLiqPrice * 100) / 100,
            current_liq_distance_pct: Math.round(currentLiqDistance * 10) / 10,
            new_liq_distance_pct: Math.round(newLiqDistance * 10) / 10,
            mark_price: markPrice,
            size_usd: position.size_usd,
            pubkey: position.pubkey,
            token_amount: Math.round(tokenAmount * 1e6) / 1e6,
            collateral_token: collateralToken,
          },
          request_id: requestId,
          latency_ms,
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        logError("tool_result", { tool: "add_collateral", request_id: requestId, error: msg });
        return { status: "error", data: null, error: msg, request_id: requestId, latency_ms: 0 };
      }
    },
  });
}
