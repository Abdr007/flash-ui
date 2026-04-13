// ============================================
// Flash AI — Limit Order Management Tools
// ============================================
// cancel_limit_order  — cancel an open limit order
// edit_limit_order    — cancel + re-place at a new limit price
// get_orders          — list all open orders (limit + trigger)
//
// Flash HTTP API endpoints used:
// - GET  /orders/owner/{pubkey}                     — list orders
// - POST /transaction-builder/cancel-limit-order    — cancel limit order
// - POST /transaction-builder/cancel-trigger-order  — cancel trigger order
//
// Note: Flash API has no edit-limit-order endpoint. "Edit" is implemented
// as cancel + re-place (build_trade with LIMIT type). The tool returns
// the cancel transaction and instructs the AI to follow up with build_trade.

import { z } from "zod";
import { tool } from "ai";
import type { ToolResponse } from "./shared";
import { runTradeGuards, runReadGuards, logToolCall, logToolResult, resolveMarket } from "./shared";

// ---- Shared Types ----

interface RawOrder {
  marketSymbol?: string;
  market?: string;
  sideUi?: string;
  side?: string;
  orderId?: number;
  orderIndex?: number;
  limitPriceUi?: number;
  limitPrice?: number;
  triggerPriceUi?: number;
  triggerPrice?: number;
  sizeUsdUi?: number;
  sizeUsd?: number;
  collateralUsdUi?: number;
  collateralUsd?: number;
  leverageUi?: number;
  leverage?: number;
  orderType?: string;
  type?: string;
  isStopLoss?: boolean;
  isActive?: boolean;
  reserveAmount?: number;
  sizeAmount?: number;
  // limit order arrays on order accounts
  limitOrders?: RawLimitEntry[];
  takeProfitOrders?: RawTriggerEntry[];
  stopLossOrders?: RawTriggerEntry[];
  triggerOrders?: RawTriggerEntry[];
}

interface RawLimitEntry {
  market?: string;
  symbol?: string;
  marketSymbol?: string;
  orderId?: number;
  sideUi?: string;
  side?: string;
  limitPrice?: number;
  limitPriceUi?: number;
  entryPriceUi?: number;
  reserveAmount?: number;
  reserveAmountUi?: string;
  sizeAmount?: number;
  sizeUsdUi?: number;
  collateralUsdUi?: number;
  collateralAmountUsdUi?: number;
  leverageUi?: number;
}

interface RawTriggerEntry {
  market?: string;
  symbol?: string;
  marketSymbol?: string;
  orderId?: number;
  sideUi?: string;
  side?: string;
  triggerPrice?: number;
  triggerPriceUi?: number;
  isStopLoss?: boolean;
  sizeUsdUi?: number;
}

interface ParsedOrder {
  market: string;
  side: "LONG" | "SHORT";
  order_id: number;
  type: "limit" | "take_profit" | "stop_loss";
  price: number;
  size_usd: number;
  collateral_usd: number;
  leverage: number;
}

// ---- Helpers ----

function safeFloat(val: unknown, fallback = 0): number {
  if (typeof val === "number" && Number.isFinite(val)) return val;
  if (typeof val === "string") {
    const n = parseFloat(val);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

const FLASH_API_URL = process.env.NEXT_PUBLIC_FLASH_API_URL || "https://flashapi.trade";
const TIMEOUT_MS = 15_000;

async function flashGet<T>(path: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${FLASH_API_URL}${path}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Flash API ${res.status}: ${res.statusText}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

async function flashPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${FLASH_API_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    // Flash API returns JSON error bodies even on 404 for "not found" cases
    const text = await res.text();
    let parsed: T;
    try {
      parsed = JSON.parse(text) as T;
    } catch {
      throw new Error(`Flash API ${res.status}: ${text}`);
    }
    // Check for err field in response (Flash pattern)
    const maybeErr = parsed as Record<string, unknown>;
    if (maybeErr.err && typeof maybeErr.err === "string") {
      throw new Error(maybeErr.err);
    }
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch and parse all open orders for a wallet.
 * The /orders/owner/ endpoint returns a flat array or order-account objects
 * with nested limitOrders/triggerOrders arrays. We normalize both formats.
 */
async function fetchOrders(wallet: string): Promise<ParsedOrder[]> {
  const raw = await flashGet<unknown[]>(`/orders/owner/${encodeURIComponent(wallet)}`);
  if (!Array.isArray(raw)) return [];

  const orders: ParsedOrder[] = [];

  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as RawOrder;
    const market = String(o.marketSymbol || o.market || "");
    const sideRaw = String(o.sideUi || o.side || "").toUpperCase();
    const side: "LONG" | "SHORT" = sideRaw === "SHORT" ? "SHORT" : "LONG";

    // Flat order object (has orderType/type directly)
    const orderType = String(o.orderType || o.type || "").toLowerCase();
    if (orderType === "limit" || orderType === "take_profit" || orderType === "stop_loss") {
      const price =
        orderType === "limit"
          ? safeFloat(o.limitPriceUi ?? o.limitPrice)
          : safeFloat(o.triggerPriceUi ?? o.triggerPrice);
      orders.push({
        market,
        side,
        order_id: safeFloat(o.orderId ?? o.orderIndex),
        type: orderType as ParsedOrder["type"],
        price,
        size_usd: safeFloat(o.sizeUsdUi ?? o.sizeUsd),
        collateral_usd: safeFloat(o.collateralUsdUi ?? o.collateralUsd),
        leverage: safeFloat(o.leverageUi ?? o.leverage),
      });
      continue;
    }

    // Order account object with nested arrays (from /orders/owner/{wallet})
    if (Array.isArray(o.limitOrders)) {
      for (let i = 0; i < o.limitOrders.length; i++) {
        const lo = o.limitOrders[i];
        if (!lo) continue;
        // Skip empty orders (zero reserve + zero size)
        if (safeFloat(lo.reserveAmountUi ?? lo.reserveAmount) === 0 && safeFloat(lo.sizeUsdUi) === 0) continue;
        const loMarket = String(lo.symbol || lo.marketSymbol || market || "");
        const loSideRaw = String(lo.sideUi || lo.side || "").toUpperCase();
        const loSide: "LONG" | "SHORT" = loSideRaw === "SHORT" ? "SHORT" : "LONG";
        orders.push({
          market: loMarket,
          side: loSide,
          order_id: safeFloat(lo.orderId ?? i),
          type: "limit",
          price: safeFloat(lo.entryPriceUi ?? lo.limitPriceUi ?? lo.limitPrice),
          size_usd: safeFloat(lo.sizeUsdUi),
          collateral_usd: safeFloat(lo.collateralAmountUsdUi ?? lo.collateralUsdUi),
          leverage: safeFloat(lo.leverageUi),
        });
      }
    }

    // Parse TP orders
    const tpOrders = Array.isArray(o.takeProfitOrders) ? o.takeProfitOrders : [];
    for (let i = 0; i < tpOrders.length; i++) {
      const tp = tpOrders[i];
      if (!tp) continue;
      if (safeFloat(tp.triggerPriceUi ?? tp.triggerPrice) === 0) continue;
      const tpMarket = String(tp.symbol || tp.marketSymbol || market || "");
      const tpSideRaw = String(tp.sideUi || tp.side || "").toUpperCase();
      orders.push({
        market: tpMarket,
        side: tpSideRaw === "SHORT" ? "SHORT" : "LONG",
        order_id: safeFloat(tp.orderId ?? i),
        type: "take_profit",
        price: safeFloat(tp.triggerPriceUi ?? tp.triggerPrice),
        size_usd: safeFloat(tp.sizeUsdUi),
        collateral_usd: 0,
        leverage: 0,
      });
    }

    // Parse SL orders
    const slOrders = Array.isArray(o.stopLossOrders) ? o.stopLossOrders : [];
    for (let i = 0; i < slOrders.length; i++) {
      const sl = slOrders[i];
      if (!sl) continue;
      if (safeFloat(sl.triggerPriceUi ?? sl.triggerPrice) === 0) continue;
      const slMarket = String(sl.symbol || sl.marketSymbol || market || "");
      const slSideRaw = String(sl.sideUi || sl.side || "").toUpperCase();
      orders.push({
        market: slMarket,
        side: slSideRaw === "SHORT" ? "SHORT" : "LONG",
        order_id: safeFloat(sl.orderId ?? i),
        type: "stop_loss",
        price: safeFloat(sl.triggerPriceUi ?? sl.triggerPrice),
        size_usd: safeFloat(sl.sizeUsdUi),
        collateral_usd: 0,
        leverage: 0,
      });
    }

    // Also check old triggerOrders format
    if (Array.isArray(o.triggerOrders)) {
      for (let i = 0; i < o.triggerOrders.length; i++) {
        const to = o.triggerOrders[i];
        if (!to) continue;
        if (safeFloat(to.triggerPriceUi ?? to.triggerPrice) === 0) continue;
        const toMarket = String(to.symbol || to.marketSymbol || market || "");
        const toSideRaw = String(to.sideUi || to.side || "").toUpperCase();
        orders.push({
          market: toMarket,
          side: toSideRaw === "SHORT" ? "SHORT" : "LONG",
          order_id: safeFloat(to.orderId ?? i),
          type: to.isStopLoss ? "stop_loss" : "take_profit",
          price: safeFloat(to.triggerPriceUi ?? to.triggerPrice),
          size_usd: safeFloat(to.sizeUsdUi),
          collateral_usd: 0,
          leverage: 0,
        });
      }
    }
  }

  return orders.filter((o) => o.market && o.price > 0);
}

// ============================================
// Tool: get_orders
// ============================================

export function createGetOrdersTool(wallet: string) {
  return tool({
    description:
      "List all open orders (limit orders and trigger orders like TP/SL) for the connected wallet. " +
      "Use when user asks: 'show my orders', 'open orders', 'pending orders', 'limit orders', 'my orders'.",
    inputSchema: z.object({}).strict(),
    execute: async (): Promise<ToolResponse<unknown>> => {
      const requestId = `orders_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const start = Date.now();
      logToolCall("get_orders", requestId, wallet);

      const guardErr = runReadGuards(requestId, wallet);
      if (guardErr) return guardErr;

      if (!wallet) {
        return { status: "error", data: null, error: "No wallet connected", request_id: requestId, latency_ms: 0 };
      }

      try {
        const orders = await fetchOrders(wallet);
        logToolResult("get_orders", requestId, wallet, Date.now() - start, "success", {
          count: orders.length,
        });

        const limitOrders = orders.filter((o) => o.type === "limit");
        const triggerOrders = orders.filter((o) => o.type === "take_profit" || o.type === "stop_loss");

        return {
          status: "success",
          data: {
            type: "orders_list",
            total: orders.length,
            limit_orders: limitOrders,
            trigger_orders: triggerOrders,
          },
          request_id: requestId,
          latency_ms: Date.now() - start,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to fetch orders";
        return { status: "error", data: null, error: msg, request_id: requestId, latency_ms: Date.now() - start };
      }
    },
  });
}

// ============================================
// Tool: cancel_limit_order
// ============================================

export function createCancelLimitOrderTool(wallet: string) {
  return tool({
    description:
      "Cancel an open limit order. Requires the order ID (index), market, and side. " +
      "Use get_orders first to find the order ID if the user doesn't provide it. " +
      "Trigger: 'cancel my SOL limit order', 'remove limit order #0', 'cancel order'.",
    inputSchema: z
      .object({
        market: z.string().describe("Market symbol (SOL, BTC, ETH, etc.)"),
        side: z.enum(["LONG", "SHORT"]).describe("Order side"),
        order_id: z.number().int().min(0).max(255).describe("Order index (0-based, u8). Use get_orders to find it."),
      })
      .strict(),
    execute: async ({ market, side, order_id }): Promise<ToolResponse<unknown>> => {
      const requestId = `cancel_limit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const start = Date.now();
      logToolCall("cancel_limit_order", requestId, wallet, { market, side, order_id });

      const guardErr = runTradeGuards(requestId, wallet);
      if (guardErr) return guardErr;

      const resolved = resolveMarket(market);
      if (!resolved) {
        return {
          status: "error",
          data: null,
          error: `Unknown market: ${market}`,
          request_id: requestId,
          latency_ms: Date.now() - start,
        };
      }

      try {
        const result = await flashPost<{ transactionBase64?: string; err: string | null }>(
          "/transaction-builder/cancel-limit-order",
          {
            owner: wallet,
            marketSymbol: resolved,
            side,
            orderId: order_id,
          },
        );

        if (!result.transactionBase64) {
          return {
            status: "error",
            data: null,
            error: "No transaction returned from API",
            request_id: requestId,
            latency_ms: Date.now() - start,
          };
        }

        logToolResult("cancel_limit_order", requestId, wallet, Date.now() - start, "success");

        return {
          status: "success",
          data: {
            type: "cancel_limit_order_preview",
            market: resolved,
            side,
            order_id,
            label: `Cancel limit order #${order_id} on ${resolved} ${side}`,
            transaction: result.transactionBase64,
          },
          request_id: requestId,
          latency_ms: Date.now() - start,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to cancel limit order";
        return { status: "error", data: null, error: msg, request_id: requestId, latency_ms: Date.now() - start };
      }
    },
  });
}

// ============================================
// Tool: edit_limit_order
// ============================================
// Flash API does not have an edit-limit-order endpoint.
// Strategy: build a cancel transaction and instruct the AI to follow up
// with build_trade(order_type:"LIMIT") at the new price.

export function createEditLimitOrderTool(wallet: string) {
  return tool({
    description:
      "Edit a limit order by cancelling it and preparing to re-place at a new price. " +
      "This returns a cancel transaction. After the user signs it, follow up by calling " +
      "build_trade with order_type:'LIMIT' and the new limit_price to place the replacement order. " +
      "Trigger: 'change my SOL limit to $140', 'edit limit order price', 'move my limit order'.",
    inputSchema: z
      .object({
        market: z.string().describe("Market symbol (SOL, BTC, ETH, etc.)"),
        side: z.enum(["LONG", "SHORT"]).describe("Order side"),
        order_id: z.number().int().min(0).max(255).describe("Order index (0-based, u8). Use get_orders to find it."),
        new_limit_price: z.number().positive().describe("New limit price to place after cancellation"),
      })
      .strict(),
    execute: async ({ market, side, order_id, new_limit_price }): Promise<ToolResponse<unknown>> => {
      const requestId = `edit_limit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const start = Date.now();
      logToolCall("edit_limit_order", requestId, wallet, { market, side, order_id, new_limit_price });

      const guardErr = runTradeGuards(requestId, wallet);
      if (guardErr) return guardErr;

      const resolved = resolveMarket(market);
      if (!resolved) {
        return {
          status: "error",
          data: null,
          error: `Unknown market: ${market}`,
          request_id: requestId,
          latency_ms: Date.now() - start,
        };
      }

      try {
        // Step 1: Fetch current order details so we can re-place with same params
        let existingOrder: ParsedOrder | undefined;
        try {
          const orders = await fetchOrders(wallet);
          existingOrder = orders.find(
            (o) => o.market === resolved && o.side === side && o.order_id === order_id && o.type === "limit",
          );
        } catch {
          // Non-fatal: we can still cancel, just won't have original params
        }

        if (!existingOrder) {
          return {
            status: "error",
            data: null,
            error: `Limit order #${order_id} not found on ${resolved} ${side}. Use get_orders to check active orders.`,
            request_id: requestId,
            latency_ms: Date.now() - start,
          };
        }

        // Step 2: Build the cancel transaction
        const result = await flashPost<{ transactionBase64?: string; err: string | null }>(
          "/transaction-builder/cancel-limit-order",
          {
            owner: wallet,
            marketSymbol: resolved,
            side,
            orderId: order_id,
          },
        );

        if (!result.transactionBase64) {
          return {
            status: "error",
            data: null,
            error: "No cancel transaction returned from API",
            request_id: requestId,
            latency_ms: Date.now() - start,
          };
        }

        // Step 3: Also build the NEW limit order transaction (so card can sign both)
        let newOrderTx: string | null = null;
        try {
          const collateral = existingOrder.collateral_usd > 0 ? existingOrder.collateral_usd : 10;
          const leverage = existingOrder.leverage > 0 ? existingOrder.leverage : 2;
          const newResult = await flashPost<{ transactionBase64?: string; err: string | null }>(
            "/transaction-builder/open-position",
            {
              inputTokenSymbol: "USDC",
              outputTokenSymbol: resolved,
              inputAmountUi: String(collateral),
              leverage,
              tradeType: side,
              owner: wallet,
              slippageBps: 80,
              orderType: "LIMIT",
              limitPrice: String(new_limit_price),
            },
          );
          if (newResult.transactionBase64) {
            newOrderTx = newResult.transactionBase64;
          }
        } catch {
          // Non-fatal: user can place manually
        }

        logToolResult("edit_limit_order", requestId, wallet, Date.now() - start, "success");

        return {
          status: "success",
          data: {
            type: "edit_limit_order_preview",
            action: "edit",
            market: resolved,
            side,
            order_id,
            old_price: existingOrder.price,
            new_limit_price,
            size_usd: existingOrder.size_usd,
            collateral_usd: existingOrder.collateral_usd,
            leverage: existingOrder.leverage,
            label: `Edit limit: $${existingOrder.price} → $${new_limit_price}`,
            cancel_transaction: result.transactionBase64,
            new_order_transaction: newOrderTx,
          },
          request_id: requestId,
          latency_ms: Date.now() - start,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to edit limit order";
        return { status: "error", data: null, error: msg, request_id: requestId, latency_ms: Date.now() - start };
      }
    },
  });
}
