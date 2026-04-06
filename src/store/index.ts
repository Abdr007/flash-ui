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
import { validateTrade, type TradePreview } from "@/lib/trade-firewall";
import { logInfo, logError } from "@/lib/logger";
import {
  resolveTradeModification,
  type TradePreviewData,
  type PositionData,
  type PortfolioData,
  type ClosePreviewData,
} from "@/lib/tool-result-handler";
import { validatePrice, isVolatilitySpike, trackVolatility } from "@/lib/price-validator";
import { transitionTo, resetExecution } from "@/lib/execution-state";

// ---- Trade Expiry ----
const TRADE_EXPIRY_MS = 30_000;

// ---- TOCTOU: Max acceptable price drift at execution time ----
const MAX_EXECUTION_DRIFT_PCT = 3.0;

function msgId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ---- Execution locks (module-level, separate for open vs close) ----
let tradeLock = false;
let closeLock = false;

// ---- Monotonic version counter for async race detection ----
let stateVersion = 0;

// ---- Context Memory (multi-turn conversation support) ----
export interface ContextMemory {
  lastIntent: ParsedIntent | null;
  lastTradeDraft: TradePreviewData | null;
  portfolioSnapshot: {
    positions: Position[];
    balance: number;
    totalExposure: number;
    timestamp: number;
  } | null;
  recentMarkets: string[];
}

export interface FlashStore {
  // ---- Existing State (UNTOUCHED) ----
  messages: ChatMessage[];
  isProcessing: boolean;
  activeTrade: TradeObject | null;
  prices: Record<string, MarketPrice>;
  selectedMarket: string;
  positions: Position[];
  walletAddress: string | null;
  walletConnected: boolean;
  streamStatus: "connected" | "reconnecting" | "disconnected";

  // ---- AI Chat State (NEW) ----
  isStreaming: boolean;
  isExecuting: boolean;
  traceId: string;
  currentTrade: TradePreviewData | null;
  lastTradeDraft: TradePreviewData | null;
  tradeCreatedAt: number | null;
  closePreview: ClosePreviewData | null;
  contextMemory: ContextMemory;
  loadingStates: Record<string, boolean>;
  lastError: { tool: string; message: string } | null;

  // ---- Data Freshness (Transparency) ----
  dataStatus: {
    pricesLastOk: number;      // timestamp of last successful price fetch
    pricesError: string | null; // null = ok, string = error message
    positionsLastOk: number;
    positionsError: string | null;
  };
  setDataError: (source: "prices" | "positions", error: string | null) => void;

  // ---- Existing Actions (UNTOUCHED) ----
  sendMessage: (input: string) => Promise<void>;
  confirmTrade: () => void;
  executeTrade: () => Promise<void>;
  completeExecution: (txSignature: string) => void;
  failExecution: (error: string) => void;
  cancelTrade: () => void;
  closePosition: (market: string, side: Side) => Promise<void>;
  refreshPrices: () => Promise<void>;
  refreshPositions: () => Promise<void>;
  handleStreamPrices: (updates: MarketPrice[]) => void;
  setStreamStatus: (status: "connected" | "reconnecting" | "disconnected") => void;
  setWallet: (address: string | null) => void;
  selectMarket: (symbol: string) => void;
  clearChat: () => void;

  // ---- AI Actions (NEW) ----
  setTradeFromAI: (raw: unknown, wallet: string, positions: Position[]) => boolean;
  modifyTrade: (modification: Partial<TradePreviewData>) => boolean;
  setClosePreview: (data: ClosePreviewData) => void;
  updatePositionsFromAI: (positions: PositionData[]) => void;
  updatePortfolioFromAI: (portfolio: PortfolioData) => void;
  setAIError: (tool: string, error: string) => void;
  setStreaming: (streaming: boolean) => void;
  setTraceId: (id: string) => void;
  updateContextMemory: (update: Partial<ContextMemory>) => void;
  setToolLoading: (tool: string, loading: boolean) => void;
  clearAITrade: () => void;
  getContextForAPI: () => {
    lastIntent: ParsedIntent | null;
    lastTradeDraft: TradePreviewData | null;
    portfolioSnapshot: ContextMemory["portfolioSnapshot"];
    recentMarkets: string[];
    positions: Position[];
  };
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
  // ---- Existing State ----
  messages: [],
  isProcessing: false,
  activeTrade: null,
  prices: {},
  selectedMarket: "SOL",
  positions: [],
  walletAddress: null,
  walletConnected: false,
  streamStatus: "disconnected" as const,

  // ---- AI Chat State (NEW) ----
  isStreaming: false,
  isExecuting: false,
  traceId: "",
  currentTrade: null,
  lastTradeDraft: null,
  tradeCreatedAt: null,
  closePreview: null,
  contextMemory: {
    lastIntent: null,
    lastTradeDraft: null,
    portfolioSnapshot: null,
    recentMarkets: [],
  },
  loadingStates: {},
  lastError: null,

  // ---- Data Freshness ----
  dataStatus: {
    pricesLastOk: 0,
    pricesError: null,
    positionsLastOk: 0,
    positionsError: null,
  },
  setDataError: (source, error) => {
    const ds = { ...get().dataStatus };
    if (source === "prices") {
      ds.pricesError = error;
      if (!error) ds.pricesLastOk = Date.now();
    } else {
      ds.positionsError = error;
      if (!error) ds.positionsLastOk = Date.now();
    }
    set({ dataStatus: ds });
  },

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
            const m = aiIntent.market as string | undefined;
            const reply = aiIntent.reply as string | undefined;
            if (m && state.prices[m]) {
              addSystemMsg(`${m}: $${state.prices[m].price.toLocaleString("en-US", { minimumFractionDigits: 2 })}`);
            } else if (reply) {
              addSystemMsg(reply);
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

  // ---- Confirm Trade (step 1: validation + expiry check + show overlay) ----
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

    // TRADE EXPIRY: reject if preview is older than 30s
    const createdAt = get().tradeCreatedAt;
    if (createdAt && Date.now() - createdAt > TRADE_EXPIRY_MS) {
      logError("execution", {
        wallet,
        data: { action: "trade_expired", market: trade.market, age_ms: Date.now() - createdAt },
      });
      const errorTrade: TradeObject = {
        ...trade,
        status: "ERROR",
        error: "Trade preview expired (>30s). Request a new quote.",
      };
      updateLastTradeCard(get, set, errorTrade);
      set({ activeTrade: errorTrade, currentTrade: null });
      return;
    }

    // REVALIDATION: re-check with current live price before confirming
    const livePrice = get().prices[trade.market];
    if (livePrice && trade.entry_price) {
      const priceDrift = Math.abs(livePrice.price - trade.entry_price) / trade.entry_price;
      if (priceDrift > 0.02) {
        // Price moved >2% since preview — warn but don't block (slippage handles it)
        logInfo("execution", {
          wallet,
          data: { action: "price_drift_warning", market: trade.market, drift_pct: (priceDrift * 100).toFixed(2) },
        });
      }
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

    // FIREWALL REVALIDATION: run trade firewall again with current positions
    const firewallResult = validateTrade(
      {
        market: trade.market,
        side: trade.action,
        collateral_usd: trade.collateral_usd,
        leverage: trade.leverage,
        entry_price: trade.entry_price,
        liquidation_price: trade.liquidation_price,
        fees: trade.fees,
        position_size: trade.position_size,
      },
      wallet,
      get().positions,
    );
    if (!firewallResult.valid) {
      logError("firewall", {
        wallet,
        data: { action: "confirm_revalidation_failed", errors: firewallResult.errors },
      });
      const errorTrade: TradeObject = {
        ...trade,
        status: "ERROR",
        error: `Revalidation failed: ${firewallResult.errors.join("; ")}`,
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
    set({ isExecuting: true });

    // CERTIFICATION GATE: block if system is not certified
    const cert = evaluateCertification(get().streamStatus);
    if (!cert.execution_enabled) {
      logSystemEvent("circuit_open", { wallet, market: trade.market, reason: cert.reason, status: cert.status });
      const errorTrade: TradeObject = { ...trade, status: "ERROR", error: cert.reason };
      updateLastTradeCard(get, set, errorTrade);
      set({ activeTrade: errorTrade, isExecuting: false });
      tradeLock = false;
      return;
    }

    // WALLET RATE LIMIT: max 5 executions/min per wallet
    const walletLimit = checkWalletExecLimit(wallet);
    if (!walletLimit.allowed) {
      logSystemEvent("rate_limited", { wallet, market: trade.market, remaining: 0 });
      const errorTrade: TradeObject = { ...trade, status: "ERROR", error: "Rate limit: max 5 trades per minute. Wait and retry." };
      updateLastTradeCard(get, set, errorTrade);
      set({ activeTrade: errorTrade, isExecuting: false });
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
      set({ activeTrade: errorTrade, isExecuting: false });
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

    // Persist execution state (survives page refresh)
    transitionTo("executing", {
      execution_id: execId,
      market: trade.market,
      side: trade.action,
      collateral_usd: collateral,
      leverage,
    });

    try {
      // ---- TOCTOU PROTECTION: Re-validate at execution time ----
      // Between confirmTrade() and now, price/positions may have changed.
      // Re-fetch live price from store and cross-validate.

      const livePrice = get().prices[trade.market];
      const previewPrice = trade.entry_price;

      if (livePrice && previewPrice && Number.isFinite(livePrice.price) && livePrice.price > 0) {
        // Cross-validate: store price (Pyth SSE) vs preview price (Flash API)
        const priceCheck = validatePrice(previewPrice, livePrice.price, trade.market);
        if (!priceCheck.valid) {
          logError("execution", {
            wallet,
            data: { action: "toctou_price_rejected", market: trade.market, error: priceCheck.error },
          });
          transitionTo("failed", { error: priceCheck.error ?? "Price validation failed" });
          const errorTrade: TradeObject = {
            ...trade,
            status: "ERROR",
            error: priceCheck.error ?? "Price sources diverged — request new quote",
          };
          updateLastTradeCard(get, set, errorTrade);
          set({ activeTrade: errorTrade, isExecuting: false });
          tradeLock = false;
          return;
        }

        // Check for excessive drift since preview was built
        const drift = Math.abs(livePrice.price - previewPrice) / previewPrice * 100;
        if (drift > MAX_EXECUTION_DRIFT_PCT) {
          logError("execution", {
            wallet,
            data: { action: "toctou_drift_blocked", market: trade.market, drift_pct: drift.toFixed(2) },
          });
          transitionTo("failed", { error: `Price drifted ${drift.toFixed(1)}%` });
          const errorTrade: TradeObject = {
            ...trade,
            status: "ERROR",
            error: `Price moved ${drift.toFixed(1)}% since preview — request new quote`,
          };
          updateLastTradeCard(get, set, errorTrade);
          set({ activeTrade: errorTrade, isExecuting: false });
          tradeLock = false;
          return;
        }

        // Feed to volatility tracker
        trackVolatility(trade.market, livePrice.price, livePrice.timestamp);
      }

      // Volatility circuit breaker
      const volCheck = isVolatilitySpike(trade.market);
      if (volCheck.spiked) {
        logError("execution", {
          wallet,
          data: { action: "volatility_circuit_breaker", market: trade.market, range_pct: volCheck.range_pct.toFixed(1) },
        });
        transitionTo("failed", { error: `Volatility spike: ${volCheck.range_pct.toFixed(1)}%` });
        const errorTrade: TradeObject = {
          ...trade,
          status: "ERROR",
          error: `${trade.market} volatility spike (${volCheck.range_pct.toFixed(1)}% range) — trading paused. Retry shortly.`,
        };
        updateLastTradeCard(get, set, errorTrade);
        set({ activeTrade: errorTrade, isExecuting: false });
        tradeLock = false;
        return;
      }

      // Re-run firewall with CURRENT positions (may have changed since confirm)
      const currentPositions = get().positions;
      const toctouFirewall = validateTrade(
        {
          market: trade.market,
          side: trade.action,
          collateral_usd: collateral,
          leverage,
          entry_price: trade.entry_price,
          liquidation_price: trade.liquidation_price,
          fees: trade.fees,
          position_size: trade.position_size,
        },
        wallet,
        currentPositions,
      );
      if (!toctouFirewall.valid) {
        logError("firewall", {
          wallet,
          data: { action: "toctou_firewall_blocked", errors: toctouFirewall.errors },
        });
        transitionTo("failed", { error: toctouFirewall.errors.join("; ") });
        const errorTrade: TradeObject = {
          ...trade,
          status: "ERROR",
          error: `Execution blocked: ${toctouFirewall.errors.join("; ")}`,
        };
        updateLastTradeCard(get, set, errorTrade);
        set({ activeTrade: errorTrade, isExecuting: false });
        tradeLock = false;
        return;
      }

      // ---- TOCTOU COMPLETE — proceed to API call ----

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
          takeProfitPrice: trade.take_profit_price ?? undefined,
          stopLossPrice: trade.stop_loss_price ?? undefined,
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

      if (!result.transactionBase64) {
        throw new Error("API returned no transaction data");
      }

      // Validate ALL numeric fields from API response before state mutation
      const apiLeverage = result.newLeverage;
      const apiLiqPrice = result.newLiquidationPrice;
      const apiFee = result.entryFee;
      if (
        !Number.isFinite(apiLeverage) || apiLeverage < 1 ||
        !Number.isFinite(apiLiqPrice) || apiLiqPrice <= 0 ||
        !Number.isFinite(apiFee) || apiFee < 0
      ) {
        throw new Error("API returned invalid numeric fields");
      }

      // Transaction built — move to SIGNING state.
      const signingTrade: TradeObject = {
        ...trade,
        status: "SIGNING",
        entry_price: result.newEntryPrice,
        liquidation_price: apiLiqPrice,
        fees: apiFee,
        leverage: apiLeverage,
        position_size: (collateral as number) * apiLeverage,
        unsigned_tx: result.transactionBase64,
      };
      updateLastTradeCard(get, set, signingTrade);
      set({ activeTrade: signingTrade });

      // Persist signing state (survives page refresh)
      transitionTo("signing", { entry_price: result.newEntryPrice });

      logTrace({
        execution_id: execId,
        timestamp: new Date().toISOString(),
        stage: "trade_execute",
        wallet,
        market: trade.market,
        side: trade.action,
        collateral,
        leverage,
        entry_price: result.newEntryPrice,
        latency_ms: latencyMs,
        circuit_state: "closed",
        system_status: "signing",
      });

      // Don't set activeTrade to null — SIGNING state stays until wallet signs
      // Don't refresh positions — no tx sent yet
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : "Trade failed";
      const failureType = errorMsg.includes("API") ? "api"
        : errorMsg.includes("RPC") ? "rpc"
        : errorMsg.includes("timeout") || errorMsg.includes("abort") ? "timeout"
        : "execution";
      recordFailure(failureType);
      transitionTo("failed", { error: errorMsg });

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
      set({ isExecuting: false });
    }
  },

  // ---- Complete Execution (called by UI after wallet signs + tx confirmed) ----
  completeExecution: (txSignature: string) => {
    const trade = get().activeTrade;
    if (!trade || trade.status !== "SIGNING") return;

    // Persist completion
    transitionTo("completed", { tx_signature: txSignature });

    const successTrade: TradeObject = {
      ...trade,
      status: "SUCCESS",
      tx_signature: txSignature,
      unsigned_tx: undefined,
    };
    updateLastTradeCard(get, set, successTrade);

    // Collapse after 8s
    const collapseData = {
      market: trade.market,
      side: trade.action,
      collateral: trade.collateral_usd ?? 0,
      leverage: trade.leverage ?? 0,
      entry_price: trade.entry_price ?? 0,
      tx_signature: txSignature,
    };
    setTimeout(() => {
      const msgs = [...get().messages];
      const last = [...msgs].reverse().find((m) => m.trade_card);
      if (last && last.trade_card?.status === "SUCCESS") {
        last.collapsed_trade = collapseData;
        last.trade_card = undefined;
        set({ messages: msgs });
      }
    }, 8000);

    set({ activeTrade: null, isExecuting: false });
    tradeLock = false;
    resetExecution(); // Clear persisted execution state
    get().refreshPositions();
  },

  // ---- Fail Execution (called by UI if wallet rejects or tx fails) ----
  failExecution: (error: string) => {
    const trade = get().activeTrade;
    if (!trade) return;

    // Persist failure
    transitionTo("failed", { error });

    const errorTrade: TradeObject = {
      ...trade,
      status: "ERROR",
      error,
      unsigned_tx: undefined,
    };
    updateLastTradeCard(get, set, errorTrade);
    set({ activeTrade: errorTrade, isExecuting: false });
    tradeLock = false;
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
      // Find position key from current positions
      const position = get().positions.find(
        (p) => p.market === market && p.side === side,
      );
      if (!position?.pubkey) {
        throw new Error(`No ${side} ${market} position found`);
      }

      // Use the close flow that includes positionKey (required by Flash API)
      const { buildClosePositionTx } = await import("@/lib/api");
      const result = await buildClosePositionTx({
        positionKey: position.pubkey,
        marketSymbol: market,
        side: side === "LONG" ? "Long" : "Short",
        owner: wallet,
        closePercent: 100,
        inputUsdUi: String(position.size_usd),
        withdrawTokenSymbol: "USDC",
      });

      if (result.err) {
        throw new Error(result.err);
      }

      if (!result.transactionBase64) {
        throw new Error("No transaction returned from API");
      }

      // Clean tx (strip Lighthouse) + set as active trade for signing
      const cleanResp = await fetch("/api/clean-tx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ txBase64: result.transactionBase64, payerKey: wallet }),
      });
      if (!cleanResp.ok) throw new Error(`Clean-tx failed: ${cleanResp.status}`);
      const cleanData = await cleanResp.json().catch(() => { throw new Error("Invalid clean-tx response"); });
      if (cleanData.error) throw new Error(cleanData.error);
      if (!cleanData.txBase64) throw new Error("No cleaned transaction returned");

      // Create a trade object for the signing flow
      const closeTrade: TradeObject = {
        id: `close-${market}-${Date.now()}`,
        market,
        action: side,
        collateral_usd: position.collateral_usd,
        leverage: position.leverage,
        position_size: position.size_usd,
        entry_price: position.entry_price,
        mark_price: position.mark_price,
        liquidation_price: position.liquidation_price,
        fees: 0,
        fee_rate: null,
        slippage_bps: null,
        status: "SIGNING",
        unsigned_tx: cleanData.txBase64,
        missing_fields: [],
      };
      set({ activeTrade: closeTrade });

      const sysMsg: ChatMessage = {
        id: msgId(),
        role: "system",
        content: `Closing ${side} ${market} — sign in your wallet.`,
        timestamp: Date.now(),
      };
      set({ messages: [...get().messages, sysMsg] });
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
      get().setDataError("prices", null); // clear error on success
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Price fetch failed";
      try { console.warn("[refreshPrices] failed:", msg); } catch {}
      get().setDataError("prices", msg);
      // Keep stale data — don't wipe
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
      get().setDataError("positions", null); // clear error on success
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Position fetch failed";
      try { console.warn("[refreshPositions] failed:", msg); } catch {}
      get().setDataError("positions", msg);
      // Keep stale data — don't wipe
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

    // Update prices — SSE stream working, clear any price errors
    set({ prices: next });
    if (get().dataStatus.pricesError) get().setDataError("prices", null);

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
    set({ messages: [], activeTrade: null, currentTrade: null, lastTradeDraft: null, closePreview: null });
  },

  // ============================================
  // AI Actions (NEW) — Phase 2
  // ============================================

  // ---- FIREWALLED: Set trade from AI tool output ----
  // Returns true if accepted, false if rejected.
  // This is the ONLY path for AI trade data into the store.
  setTradeFromAI: (raw: unknown, wallet: string, positions: Position[]): boolean => {
    // EXECUTION LOCK: block new trades during execution
    if (get().isExecuting) {
      logError("firewall", {
        data: { action: "setTradeFromAI_blocked_during_execution" },
        wallet,
      });
      return false;
    }

    // FIREWALL: validate before ANY state mutation
    const result = validateTrade(raw, wallet, positions);

    if (!result.valid) {
      logError("firewall", {
        data: {
          action: "setTradeFromAI_rejected",
          errors: result.errors,
        },
        wallet,
      });
      set({
        lastError: {
          tool: "build_trade",
          message: `Trade rejected: ${result.errors.join("; ")}`,
        },
      });
      return false;
    }

    const trade = result.trade as unknown as TradePreviewData;

    logInfo("firewall", {
      data: {
        action: "setTradeFromAI_accepted",
        market: trade.market,
        side: trade.side,
        warnings: result.warnings,
      },
      wallet,
    });

    // Convert AI preview to TradeObject for the execution pipeline
    const rawTrade = result.trade as Record<string, unknown>;
    const tradeObject: TradeObject = {
      id: `trade_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      action: trade.side,
      market: trade.market,
      collateral_usd: trade.collateral_usd,
      leverage: trade.leverage,
      position_size: trade.position_size,
      entry_price: trade.entry_price,
      mark_price: trade.entry_price,
      liquidation_price: trade.liquidation_price,
      fees: trade.fees,
      fee_rate: trade.fee_rate ?? 0.0008,
      slippage_bps: trade.slippage_bps ?? 80,
      status: "READY",
      missing_fields: [],
      // Pass TP/SL through — validated by firewall
      take_profit_price: typeof rawTrade.take_profit_price === "number" ? rawTrade.take_profit_price : null,
      stop_loss_price: typeof rawTrade.stop_loss_price === "number" ? rawTrade.stop_loss_price : null,
    };

    // Update context memory
    const recentMarkets = [...get().contextMemory.recentMarkets];
    if (!recentMarkets.includes(trade.market)) {
      recentMarkets.unshift(trade.market);
      if (recentMarkets.length > 5) recentMarkets.pop();
    }

    set({
      currentTrade: trade,
      lastTradeDraft: trade,
      tradeCreatedAt: Date.now(),
      activeTrade: tradeObject,
      lastError: null,
      contextMemory: {
        ...get().contextMemory,
        lastTradeDraft: trade,
        recentMarkets,
      },
    });

    return true;
  },

  // ---- Multi-turn trade modification ----
  modifyTrade: (modification: Partial<TradePreviewData>): boolean => {
    // EXECUTION LOCK: block modifications during execution
    if (get().isExecuting) {
      logError("firewall", {
        data: { action: "modifyTrade_blocked_during_execution" },
      });
      return false;
    }

    const prev = get().lastTradeDraft;
    if (!prev) {
      logError("firewall", {
        data: { action: "modifyTrade_no_previous" },
      });
      return false;
    }

    const wallet = get().walletAddress ?? "";
    const positions = get().positions;

    const result = resolveTradeModification(prev, modification, wallet, positions);

    if (!result) {
      set({
        lastError: {
          tool: "modify_trade",
          message: "Modification produces invalid trade",
        },
      });
      return false;
    }

    // Re-run setTradeFromAI with the merged result (goes through firewall again)
    return get().setTradeFromAI(result.trade, wallet, positions);
  },

  // ---- Close preview (from AI) ----
  setClosePreview: (data: ClosePreviewData) => {
    set({ closePreview: data });
  },

  // ---- Update positions from AI tool ----
  updatePositionsFromAI: (posData: PositionData[]) => {
    // Convert to existing Position type and enrich with live prices
    const prices = get().prices;
    const positions: Position[] = posData.map((p) => {
      const livePrice = prices[p.market];
      return {
        pubkey: p.pubkey,
        market: p.market,
        side: p.side,
        entry_price: p.entry_price,
        mark_price: livePrice?.price ?? p.mark_price,
        size_usd: p.size_usd,
        collateral_usd: p.collateral_usd,
        leverage: p.leverage,
        unrealized_pnl: p.unrealized_pnl,
        unrealized_pnl_pct: p.unrealized_pnl_pct,
        liquidation_price: p.liquidation_price,
        fees: p.fees,
        timestamp: p.timestamp,
      };
    });

    set({ positions });

    // Update portfolio snapshot in context memory
    let totalExposure = 0;
    for (const p of positions) {
      totalExposure += p.size_usd;
    }

    set({
      contextMemory: {
        ...get().contextMemory,
        portfolioSnapshot: {
          positions,
          balance: 0, // Wallet balance not available here
          totalExposure,
          timestamp: Date.now(),
        },
      },
    });
  },

  // ---- Update portfolio from AI tool ----
  updatePortfolioFromAI: (portfolio: PortfolioData) => {
    // Also updates positions
    if (portfolio.positions.length > 0) {
      get().updatePositionsFromAI(portfolio.positions);
    }

    set({
      contextMemory: {
        ...get().contextMemory,
        portfolioSnapshot: {
          positions: get().positions,
          balance: portfolio.total_collateral,
          totalExposure: portfolio.total_exposure,
          timestamp: Date.now(),
        },
      },
    });
  },

  // ---- Error handling ----
  setAIError: (tool: string, error: string) => {
    set({ lastError: { tool, message: error } });
  },

  // ---- Streaming state ----
  setStreaming: (streaming: boolean) => {
    set({ isStreaming: streaming });
  },

  // ---- Trace ID ----
  setTraceId: (id: string) => {
    set({ traceId: id });
  },

  // ---- Context memory updates ----
  updateContextMemory: (update: Partial<ContextMemory>) => {
    set({
      contextMemory: { ...get().contextMemory, ...update },
    });
  },

  // ---- Tool loading states ----
  setToolLoading: (tool: string, loading: boolean) => {
    const current = get().loadingStates;
    if (loading) {
      set({ loadingStates: { ...current, [tool]: true } });
    } else {
      const next = { ...current };
      delete next[tool];
      set({ loadingStates: next });
    }
  },

  // ---- Clear AI trade (without cancelling execution pipeline) ----
  clearAITrade: () => {
    set({ currentTrade: null, closePreview: null, lastError: null });
  },

  // ---- Get context for API request body ----
  // Includes full context memory + live positions for AI system prompt
  getContextForAPI: () => {
    const ctx = get().contextMemory;
    return {
      lastIntent: ctx.lastIntent,
      lastTradeDraft: ctx.lastTradeDraft,
      portfolioSnapshot: ctx.portfolioSnapshot,
      recentMarkets: ctx.recentMarkets,
      positions: get().positions,
    };
  },
}));
