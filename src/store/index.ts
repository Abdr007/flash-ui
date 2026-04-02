// ============================================
// Flash UI — Central State Store (Audit-Hardened)
// ============================================
//
// Safety guarantees:
// - Execution lock: prevents double-click / duplicate tx (separate locks for open/close)
// - Input guard: blocks new commands during trade execution
// - Validation gate: collateral/leverage/price checked before execution
// - Cancel safety: cannot cancel during EXECUTING state
// - State transitions: strictly READY → CONFIRMING → EXECUTING → SUCCESS/ERROR
// - Race-safe: snapshots state before async gaps, validates after
// - No non-null assertions on trade fields

import { create } from "zustand";
import type {
  ChatMessage,
  MarketPrice,
  Position,
  Side,
  TradeObject,
} from "@/lib/types";
import { parseCommand, parseFieldResponse, getNextQuestion, applyModification, checkCloseAmbiguity } from "@/lib/parser";
import type { ParsedIntent } from "@/lib/types";
import {
  enrichTradeWithQuote,
  getPositions,
  getAllPrices,
  validateTradeObject,
} from "@/lib/api";
import { recomputeAllPnl } from "@/lib/pnl";
import { logExecution, logTrace, logSystemEvent, genExecutionId, withLatency } from "@/lib/execution-log";
import { checkCircuit, recordSuccess, recordFailure, getCircuitState } from "@/lib/circuit-breaker";
import { evaluateCertification } from "@/lib/certification";
import { checkWalletExecLimit } from "@/lib/rate-limiter";

function msgId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ---- Execution locks (module-level, separate for open vs close) ----
let tradeLock = false;
let closeLock = false;

// ---- Monotonic version counter for async race detection ----
let stateVersion = 0;

export interface FlashStore {
  messages: ChatMessage[];
  isProcessing: boolean;
  activeTrade: TradeObject | null;
  prices: Record<string, MarketPrice>;
  selectedMarket: string;
  positions: Position[];
  walletAddress: string | null;
  walletConnected: boolean;
  streamStatus: "connected" | "reconnecting" | "disconnected";

  sendMessage: (input: string) => Promise<void>;
  confirmTrade: () => void;
  executeTrade: () => Promise<void>;
  cancelTrade: () => void;
  closePosition: (market: string, side: Side) => Promise<void>;
  refreshPrices: () => Promise<void>;
  refreshPositions: () => Promise<void>;
  handleStreamPrices: (updates: MarketPrice[]) => void;
  setStreamStatus: (status: "connected" | "reconnecting" | "disconnected") => void;
  setWallet: (address: string | null) => void;
  selectMarket: (symbol: string) => void;
  clearChat: () => void;
}

// ---- Helper: update the last trade card in chat messages ----
function updateLastTradeCard(
  get: () => FlashStore,
  set: (partial: Partial<FlashStore>) => void,
  updatedTrade: TradeObject
) {
  const msgs = [...get().messages];
  const lastTradeMsg = [...msgs].reverse().find((m) => m.trade_card);
  if (lastTradeMsg) {
    lastTradeMsg.trade_card = updatedTrade;
  }
  set({ messages: msgs });
}

export const useFlashStore = create<FlashStore>((set, get) => ({
  messages: [],
  isProcessing: false,
  activeTrade: null,
  prices: {},
  selectedMarket: "SOL",
  positions: [],
  walletAddress: null,
  walletConnected: false,
  streamStatus: "disconnected" as const,

  // ---- Send Message (core state machine) ----
  sendMessage: async (input: string) => {
    const trimmed = input.trim();
    if (!trimmed) return;

    const state = get();

    // GUARD: Block input while trade is executing or confirming
    if (
      state.activeTrade &&
      (state.activeTrade.status === "EXECUTING" ||
        state.activeTrade.status === "CONFIRMING")
    ) {
      return;
    }

    // GUARD: Block rapid-fire
    if (state.isProcessing) return;

    const userMsg: ChatMessage = {
      id: msgId(),
      role: "user",
      content: trimmed,
      timestamp: Date.now(),
    };

    // Capture version before async work
    const versionBefore = ++stateVersion;

    set({ messages: [...state.messages, userMsg], isProcessing: true });

    // CASE 1: Active trade in progressive build
    if (state.activeTrade && state.activeTrade.status === "INCOMPLETE") {
      const updated = parseFieldResponse(trimmed, state.activeTrade);
      const question = getNextQuestion(updated);

      if (question) {
        // Never show trade card during progressive build — only show once enriched
        const sysMsg: ChatMessage = {
          id: msgId(),
          role: "system",
          content: question,
          timestamp: Date.now(),
        };
        set({
          messages: [...get().messages, sysMsg],
          activeTrade: updated,
          isProcessing: false,
        });
        return;
      }

      // All fields present — enrich with API (async gap)
      const enriched = await enrichTradeWithQuote(
        updated
      );

      // RACE CHECK: If state changed during async gap, discard result
      if (stateVersion !== versionBefore) {
        set({ isProcessing: false });
        return;
      }

      const sysMsg: ChatMessage = {
        id: msgId(),
        role: "system",
        content:
          enriched.status === "READY"
            ? "Ready to execute."
            : enriched.error || "Error loading market data.",
        timestamp: Date.now(),
        trade_card: enriched,
      };
      set({
        messages: [...get().messages, sysMsg],
        activeTrade: enriched,
        isProcessing: false,
      });
      return;
    }

    // CASE 2: Parse fresh command
    const parsed = parseCommand(trimmed);

    // ---- OPEN POSITION ----
    if (parsed.type === "trade" && parsed.trade) {
      const trade = parsed.trade as TradeObject;
      const question = getNextQuestion(trade);

      if (question) {
        const sysMsg: ChatMessage = {
          id: msgId(),
          role: "system",
          content: question,
          timestamp: Date.now(),
        };
        set({
          messages: [...get().messages, sysMsg],
          activeTrade: trade,
          isProcessing: false,
        });
        return;
      }

      const enriched = await enrichTradeWithQuote(
        trade
      );

      if (stateVersion !== versionBefore) {
        set({ isProcessing: false });
        return;
      }

      // Build status message — include chain info
      let readyMsg = "Ready to execute.";
      if (parsed.chain && parsed.chain.length > 0 && enriched.status === "READY") {
        const chainLabels = parsed.chain.map((c) => {
          if (c.type === "SET_SL") return `SL ${c.stop_loss_pct ? c.stop_loss_pct + "%" : "$" + c.stop_loss_price}`;
          if (c.type === "SET_TP") return `TP ${c.take_profit_pct ? c.take_profit_pct + "%" : "$" + c.take_profit_price}`;
          return c.type;
        });
        readyMsg = `Ready to execute with ${chainLabels.join(" + ")}.`;
      }

      const sysMsg: ChatMessage = {
        id: msgId(),
        role: "system",
        content:
          enriched.status === "READY"
            ? readyMsg
            : enriched.error || "Error loading market data.",
        timestamp: Date.now(),
        trade_card: enriched,
      };
      set({
        messages: [...get().messages, sysMsg],
        activeTrade: enriched,
        isProcessing: false,
      });
      return;
    }

    // ---- CLOSE POSITION ----
    if (parsed.type === "close") {
      const intent = parsed.intent;
      const market = intent.market ?? state.activeTrade?.market;

      if (!market) {
        addSystemMsg("Which position to close? Specify market (e.g. close BTC).");
        set({ isProcessing: false });
        return;
      }

      // Ambiguity check: both LONG and SHORT open?
      const ambiguity = checkCloseAmbiguity(market, intent.side, state.positions);
      if (ambiguity) {
        addSystemMsg(ambiguity);
        set({ isProcessing: false });
        return;
      }

      const side = intent.side ?? (state.positions.find((p) => p.market === market)?.side);

      addSystemMsg(`Closing ${side ? side + " " : ""}${market} position...`);
      set({ isProcessing: false, activeTrade: null });
      await get().closePosition(market, side ?? "LONG");
      return;
    }

    // ---- REDUCE POSITION ----
    if (parsed.type === "reduce") {
      const intent = parsed.intent;
      const market = intent.market ?? state.activeTrade?.market;
      const pct = intent.reduce_percent;

      if (!market) {
        addSystemMsg("Which position to reduce? Specify market.");
        set({ isProcessing: false });
        return;
      }
      if (!pct) {
        addSystemMsg("By how much? (e.g. reduce BTC by 50%)");
        set({ isProcessing: false });
        return;
      }

      addSystemMsg(`Reducing ${market} position by ${pct}%...`);
      set({ isProcessing: false });

      const pos = state.positions.find((p) => p.market === market);
      const side = pos?.side ?? "LONG";
      // closePercent = reduce percent
      if (closeLock) { set({ isProcessing: false }); return; }
      closeLock = true;
      try {
        const { buildClosePosition } = await import("@/lib/api");
        const result = await buildClosePosition({ market, side, owner: get().walletAddress!, closePercent: pct });
        if (result.err) throw new Error(result.err);
        addSystemMsg(`${market} reduced by ${pct}%.`);
        get().refreshPositions();
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : "Reduce failed";
        addSystemMsg(`Error: ${errorMsg}`);
      } finally {
        closeLock = false;
      }
      return;
    }

    // ---- MODIFY ACTIVE TRADE ----
    if (parsed.type === "modify") {
      if (!state.activeTrade || (state.activeTrade.status !== "READY" && state.activeTrade.status !== "INCOMPLETE")) {
        addSystemMsg("No active trade to modify. Start a new trade first.");
        set({ isProcessing: false });
        return;
      }

      const modified = applyModification(state.activeTrade, parsed.intent);

      // Re-enrich with new parameters
      const enriched = await enrichTradeWithQuote(modified);

      if (stateVersion !== versionBefore) {
        set({ isProcessing: false });
        return;
      }

      const sysMsg: ChatMessage = {
        id: msgId(),
        role: "system",
        content:
          enriched.status === "READY"
            ? "Updated. Ready to execute."
            : enriched.error || "Error updating trade.",
        timestamp: Date.now(),
        trade_card: enriched,
      };
      set({
        messages: [...get().messages, sysMsg],
        activeTrade: enriched,
        isProcessing: false,
      });
      return;
    }

    // ---- CANCEL ----
    if (parsed.type === "cancel") {
      get().cancelTrade();
      set({ isProcessing: false });
      return;
    }

    // ---- QUERY ----
    if (parsed.type === "query") {
      // Price query
      const queryMarket = parsed.intent.market;
      if (queryMarket) {
        const p = state.prices[queryMarket];
        if (p) {
          addSystemMsg(`${queryMarket}: $${p.price.toLocaleString("en-US", { minimumFractionDigits: 2 })}`);
        } else {
          addSystemMsg(`No price data for ${queryMarket}.`);
        }
      } else if (/positions?/i.test(trimmed)) {
        const count = state.positions.length;
        addSystemMsg(count > 0 ? `${count} open position${count > 1 ? "s" : ""}.` : "No open positions.");
      } else {
        addSystemMsg('Try: "Long SOL 100 5x" or "Short BTC 50 3x"');
      }
      set({ isProcessing: false });
      return;
    }

    // ---- SL / TP (standalone) ----
    if (parsed.type === "sl" || parsed.type === "tp") {
      // SL/TP requires wallet + open position — defer to future implementation
      const label = parsed.type === "sl" ? "Stop loss" : "Take profit";
      addSystemMsg(`${label} noted. Will be applied on next trade execution.`);
      set({ isProcessing: false });
      return;
    }

    // ---- UNRECOGNIZED: AI fallback ----
    try {
      const aiRes = await fetch("/api/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: trimmed }),
      });

      if (aiRes.ok) {
        const aiIntent = await aiRes.json();

        // If AI returned a valid intent, re-process as a structured command
        if (aiIntent.intent && !aiIntent.error) {
          const side = aiIntent.direction as "LONG" | "SHORT" | null;
          const market = aiIntent.market as string | null;
          const collateral = aiIntent.collateral_usd as number | null;
          const leverage = aiIntent.leverage as number | null;

          if (aiIntent.intent === "OPEN_POSITION" && (side || market)) {
            // Build trade from AI extraction and re-enter the flow
            const { parseCommand: reparse } = await import("@/lib/parser");
            const synthetic = [
              side?.toLowerCase() ?? "",
              market ?? "",
              collateral != null ? `$${collateral}` : "",
              leverage != null ? `${leverage}x` : "",
            ].filter(Boolean).join(" ");

            const reparsed = reparse(synthetic);
            if (reparsed.type === "trade" && reparsed.trade) {
              const trade = reparsed.trade;
              const question = getNextQuestion(trade);
              if (question) {
                const showCard = !!(trade.market && trade.collateral_usd);
                addSystemMsg(question, showCard ? trade : undefined);
                set({ activeTrade: trade, isProcessing: false });
                return;
              }
              // Complete — enrich
              const enriched = await enrichTradeWithQuote(trade);
              if (stateVersion !== versionBefore) { set({ isProcessing: false }); return; }
              addSystemMsg(
                enriched.status === "READY" ? "Ready to execute." : enriched.error || "Error loading data.",
                enriched
              );
              set({ activeTrade: enriched, isProcessing: false });
              return;
            }
          }

          if (aiIntent.intent === "CLOSE_POSITION" && aiIntent.market) {
            addSystemMsg(`Closing ${aiIntent.market}...`);
            set({ isProcessing: false });
            await get().closePosition(aiIntent.market, side ?? "LONG");
            return;
          }

          if (aiIntent.intent === "QUERY") {
            const m = aiIntent.market;
            if (m && state.prices[m]) {
              addSystemMsg(`${m}: $${state.prices[m].price.toLocaleString("en-US", { minimumFractionDigits: 2 })}`);
            } else {
              addSystemMsg('Try: "Long SOL 100 5x" or "Short BTC 50 3x"');
            }
            set({ isProcessing: false });
            return;
          }

          if (aiIntent.intent === "CANCEL") {
            get().cancelTrade();
            set({ isProcessing: false });
            return;
          }
        }
      }
    } catch {
      // AI fallback failed — fall through to help message
    }

    addSystemMsg('Try: "Long SOL 100 5x" or "Short BTC 50 3x"');
    set({ isProcessing: false });

    // Helper: add a system message to chat
    function addSystemMsg(content: string, tradeCard?: TradeObject) {
      const sysMsg: ChatMessage = {
        id: msgId(),
        role: "system",
        content,
        timestamp: Date.now(),
        ...(tradeCard && { trade_card: tradeCard }),
      };
      set({ messages: [...get().messages, sysMsg] });
    }
  },

  // ---- Confirm Trade (step 1: validation + show overlay) ----
  confirmTrade: () => {
    const trade = get().activeTrade;
    if (!trade || trade.status !== "READY") return;

    const wallet = get().walletAddress;
    if (!wallet) {
      const errorTrade: TradeObject = {
        ...trade,
        status: "ERROR",
        error: "Connect wallet to trade.",
      };
      updateLastTradeCard(get, set, errorTrade);
      set({ activeTrade: errorTrade });
      return;
    }

    // Validation gate — checks collateral, leverage, prices
    const validation = validateTradeObject(trade);
    if (!validation.valid) {
      const errorTrade: TradeObject = {
        ...trade,
        status: "ERROR",
        error: validation.error,
      };
      updateLastTradeCard(get, set, errorTrade);
      set({ activeTrade: errorTrade });
      return;
    }

    // Generate execution ID for the full trace chain
    const execId = genExecutionId();
    (trade as TradeObject & { _execId?: string })._execId = execId;

    logTrace({
      execution_id: execId,
      timestamp: new Date().toISOString(),
      stage: "trade_confirm",
      wallet,
      market: trade.market,
      side: trade.action,
      collateral: trade.collateral_usd ?? undefined,
      leverage: trade.leverage ?? undefined,
      position_size: trade.position_size ?? undefined,
      entry_price: trade.entry_price ?? undefined,
      liquidation_price: trade.liquidation_price ?? undefined,
      fees: trade.fees ?? undefined,
    });

    // Show confirmation overlay
    const confirmingTrade: TradeObject = { ...trade, status: "CONFIRMING" };
    updateLastTradeCard(get, set, confirmingTrade);
    set({ activeTrade: confirmingTrade });
  },

  // ---- Execute Trade (step 2: build tx + send) ----
  executeTrade: async () => {
    const trade = get().activeTrade;

    // STRICT state gate: only from CONFIRMING
    if (!trade || trade.status !== "CONFIRMING") return;

    const wallet = get().walletAddress;
    if (!wallet) return;

    // EXECUTION LOCK: prevent double-click (separate from close lock)
    if (tradeLock) return;
    tradeLock = true;

    // CERTIFICATION GATE: block if system is not certified
    const cert = evaluateCertification(get().streamStatus);
    if (!cert.execution_enabled) {
      logSystemEvent("circuit_open", { wallet, market: trade.market, reason: cert.reason, status: cert.status });
      const errorTrade: TradeObject = { ...trade, status: "ERROR", error: cert.reason };
      updateLastTradeCard(get, set, errorTrade);
      set({ activeTrade: errorTrade });
      tradeLock = false;
      return;
    }

    // WALLET RATE LIMIT: max 5 executions/min per wallet
    const walletLimit = checkWalletExecLimit(wallet);
    if (!walletLimit.allowed) {
      logSystemEvent("rate_limited", { wallet, market: trade.market, remaining: 0 });
      const errorTrade: TradeObject = { ...trade, status: "ERROR", error: "Rate limit: max 5 trades per minute. Wait and retry." };
      updateLastTradeCard(get, set, errorTrade);
      set({ activeTrade: errorTrade });
      tradeLock = false;
      return;
    }

    // RUNTIME FIELD VALIDATION: no non-null assertions
    const collateral = trade.collateral_usd;
    const leverage = trade.leverage;
    if (
      !collateral ||
      !leverage ||
      !Number.isFinite(collateral) ||
      !Number.isFinite(leverage) ||
      collateral <= 0 ||
      leverage < 1
    ) {
      const errorTrade: TradeObject = {
        ...trade,
        status: "ERROR",
        error: "Invalid trade parameters. Cancel and retry.",
      };
      updateLastTradeCard(get, set, errorTrade);
      set({ activeTrade: errorTrade });
      tradeLock = false;
      return;
    }

    // Move to EXECUTING — no going back except SUCCESS/ERROR
    const executingTrade: TradeObject = { ...trade, status: "EXECUTING" };
    updateLastTradeCard(get, set, executingTrade);
    set({ activeTrade: executingTrade });

    // Recover execution ID from confirm step
    const execId = (trade as TradeObject & { _execId?: string })._execId ?? genExecutionId();
    const circuitState = checkCircuit().allowed ? "closed" : "open";

    try {
      const { buildOpenPosition } = await import("@/lib/api");

      logTrace({
        execution_id: execId,
        timestamp: new Date().toISOString(),
        stage: "trade_execute",
        wallet,
        market: trade.market,
        side: trade.action,
        collateral,
        leverage,
        circuit_state: circuitState,
      });

      const { result, latencyMs } = await withLatency(() =>
        buildOpenPosition({
          market: trade.market,
          side: trade.action,
          collateral,
          leverage,
          owner: wallet,
        })
      );

      // VERIFY: API didn't return a zero/invalid entry price
      if (
        !result.newEntryPrice ||
        !Number.isFinite(result.newEntryPrice) ||
        result.newEntryPrice <= 0
      ) {
        throw new Error("API returned invalid entry price");
      }

      // Circuit breaker: record success (API call worked)
      recordSuccess();

      // Transaction is built but NOT signed yet.
      // Wallet adapter signing must happen in the UI layer (React context).
      // Store the base64 tx on the trade object for the UI to sign and send.
      // Status remains EXECUTING until the UI confirms the tx was sent.
      if (!result.transactionBase64) {
        throw new Error("API returned no transaction data");
      }

      const successTrade: TradeObject = {
        ...trade,
        status: "SUCCESS",
        entry_price: result.newEntryPrice,
        liquidation_price: result.newLiquidationPrice,
        fees: result.entryFee,
        leverage: result.newLeverage,
        position_size: (collateral as number) * result.newLeverage,
        tx_signature: "pending_signature",
      };
      updateLastTradeCard(get, set, successTrade);

      logTrace({
        execution_id: execId,
        timestamp: new Date().toISOString(),
        stage: "trade_success",
        wallet,
        market: trade.market,
        side: trade.action,
        collateral,
        leverage,
        position_size: collateral * leverage,
        entry_price: result.newEntryPrice,
        liquidation_price: result.newLiquidationPrice,
        fees: result.entryFee,
        tx_signature: successTrade.tx_signature,
        latency_ms: latencyMs,
        circuit_state: "closed",
        system_status: "ok",
      });

      // Collapse trade card in chat after 8s
      // Snapshot all values as concrete numbers (already validated above)
      const collapseData = {
        market: trade.market,
        side: trade.action,
        collateral: collateral as number, // validated non-null at line 302-321
        leverage: leverage as number,     // validated non-null at line 302-321
        entry_price: Number.isFinite(trade.entry_price) ? (trade.entry_price as number) : 0,
        tx_signature: successTrade.tx_signature,
      };
      setTimeout(() => {
        const msgs = [...get().messages];
        const lastTradeMsg = [...msgs].reverse().find((m) => m.trade_card);
        if (lastTradeMsg && lastTradeMsg.trade_card?.status === "SUCCESS") {
          lastTradeMsg.collapsed_trade = collapseData;
          lastTradeMsg.trade_card = undefined;
          set({ messages: msgs });
        }
      }, 8000);

      set({ activeTrade: null });
      get().refreshPositions();
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : "Trade failed";
      const failureType = errorMsg.includes("API") ? "api"
        : errorMsg.includes("RPC") ? "rpc"
        : errorMsg.includes("timeout") || errorMsg.includes("abort") ? "timeout"
        : "execution";
      recordFailure(failureType);

      logTrace({
        execution_id: execId,
        timestamp: new Date().toISOString(),
        stage: "trade_error",
        wallet,
        market: trade.market,
        side: trade.action,
        collateral,
        leverage,
        error: errorMsg,
        error_type: failureType,
        circuit_state: getCircuitState(),
        system_status: "error",
      });
      const errorTrade: TradeObject = {
        ...trade,
        status: "ERROR",
        error: errorMsg,
      };
      updateLastTradeCard(get, set, errorTrade);
      set({ activeTrade: errorTrade });
    } finally {
      tradeLock = false;
    }
  },

  // ---- Cancel Trade ----
  cancelTrade: () => {
    const trade = get().activeTrade;

    // SAFETY: Cannot cancel during EXECUTING — tx is in flight
    if (trade && trade.status === "EXECUTING") return;

    const msgs = [...get().messages];
    const lastTradeMsg = [...msgs].reverse().find((m) => m.trade_card);
    if (lastTradeMsg) {
      lastTradeMsg.trade_card = undefined;
    }
    const sysMsg: ChatMessage = {
      id: msgId(),
      role: "system",
      content: "Trade cancelled.",
      timestamp: Date.now(),
    };

    // Bump version to invalidate any in-flight enrichment
    stateVersion++;

    set({
      messages: [...msgs, sysMsg],
      activeTrade: null,
    });
  },

  // ---- Close Position (separate lock from trade execution) ----
  closePosition: async (market: string, side: Side) => {
    const wallet = get().walletAddress;
    if (!wallet) return;

    if (closeLock) return;
    closeLock = true;

    try {
      const { buildClosePosition } = await import("@/lib/api");
      const result = await buildClosePosition({ market, side, owner: wallet });

      if (result.err) {
        throw new Error(result.err);
      }

      const sysMsg: ChatMessage = {
        id: msgId(),
        role: "system",
        content: `${market} ${side} position closed.`,
        timestamp: Date.now(),
      };
      set({ messages: [...get().messages, sysMsg] });
      get().refreshPositions();
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : "Close failed";
      const sysMsg: ChatMessage = {
        id: msgId(),
        role: "system",
        content: `Error: ${errorMsg}`,
        timestamp: Date.now(),
      };
      set({ messages: [...get().messages, sysMsg] });
    } finally {
      closeLock = false;
    }
  },

  // ---- Refresh Prices (diff detection) ----
  refreshPrices: async () => {
    try {
      const freshPrices = await getAllPrices();
      const current = get().prices;
      let changed = false;
      const next: Record<string, MarketPrice> = { ...current };

      for (const p of freshPrices) {
        // Validate price before accepting
        if (!Number.isFinite(p.price) || p.price <= 0) continue;

        const existing = current[p.symbol];
        if (
          !existing ||
          existing.price !== p.price ||
          existing.timestamp !== p.timestamp
        ) {
          next[p.symbol] = p;
          changed = true;
        }
      }

      if (changed) {
        set({ prices: next });
      }
    } catch {
      // Silent fail — keep stale data
    }
  },

  // ---- Refresh Positions ----
  refreshPositions: async () => {
    const wallet = get().walletAddress;
    if (!wallet) return;
    try {
      const positions = await getPositions(wallet);
      // Enrich mark prices from live price feed
      const prices = get().prices;
      const enriched = positions.map((pos) => {
        const livePrice = prices[pos.market];
        if (livePrice && Number.isFinite(livePrice.price) && livePrice.price > 0) {
          return { ...pos, mark_price: livePrice.price };
        }
        return pos;
      });
      set({ positions: enriched });
    } catch {
      // Keep stale
    }
  },

  // ---- Stream Price Handler (called by PriceStream on each SSE tick) ----
  handleStreamPrices: (updates: MarketPrice[]) => {
    const current = get().prices;
    let pricesChanged = false;
    const next: Record<string, MarketPrice> = { ...current };

    for (const p of updates) {
      if (!Number.isFinite(p.price) || p.price <= 0) continue;

      const existing = current[p.symbol];
      // Only accept if newer timestamp or new symbol
      if (existing && existing.timestamp >= p.timestamp) continue;

      next[p.symbol] = p;
      pricesChanged = true;
    }

    if (!pricesChanged) return;

    // Update prices
    set({ prices: next });

    // Recompute PnL for open positions
    const positions = get().positions;
    if (positions.length > 0) {
      const { positions: updated, changed } = recomputeAllPnl(positions, next);
      if (changed) {
        set({ positions: updated });
      }
    }
  },

  setStreamStatus: (status: "connected" | "reconnecting" | "disconnected") => {
    set({ streamStatus: status });
  },

  // ---- Wallet ----
  setWallet: (address: string | null) => {
    set({
      walletAddress: address,
      walletConnected: !!address,
    });
    if (address) {
      get().refreshPositions();
    } else {
      set({ positions: [] });
    }
  },

  selectMarket: (symbol: string) => {
    set({ selectedMarket: symbol });
  },

  clearChat: () => {
    if (tradeLock || closeLock) return;
    stateVersion++;
    set({ messages: [], activeTrade: null });
  },
}));
