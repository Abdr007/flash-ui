// ============================================
// Flash UI — Trade Slice
// ============================================
//
// Owns: trade execution pipeline — setTriggers, confirmTrade,
// executeTrade, completeExecution, failExecution, cancelTrade,
// closePosition, and the updateLastTradeCard helper.

import type { ChatMessage, TradeObject, Side } from "@/lib/types";
import { enrichTradeWithQuote, validateTradeObject } from "@/lib/api";
import { logTrace, logSystemEvent, genExecutionId, withLatency } from "@/lib/execution-log";
import { checkCircuit, recordSuccess, recordFailure, getCircuitState } from "@/lib/circuit-breaker";
import { evaluateCertification } from "@/lib/certification";
import { checkWalletExecLimit } from "@/lib/rate-limiter";
import { validateTrade } from "@/lib/trade-firewall";
import { logInfo, logError } from "@/lib/logger";
import { acquireCrossTabLock, releaseCrossTabLock, isOtherTabTrading } from "@/lib/cross-tab-lock";
import { validatePrice, isVolatilitySpike, trackVolatility } from "@/lib/price-validator";
import { transitionTo, resetExecution } from "@/lib/execution-state";
import type { FlashStore, StoreSet, StoreGet } from "./types";
import {
  TRADE_EXPIRY_MS,
  MAX_EXECUTION_DRIFT_PCT,
  msgId,
  tradeLock,
  setTradeLock,
  closeLock,
  setCloseLock,
  getStateVersion,
  bumpStateVersion,
} from "./types";

let _collapseTimer: ReturnType<typeof setTimeout> | null = null;
let _refreshTimer: ReturnType<typeof setTimeout> | null = null;

const MAX_MESSAGES = 200;
function capMessages(msgs: ChatMessage[]): ChatMessage[] {
  if (msgs.length > MAX_MESSAGES) msgs.splice(0, msgs.length - MAX_MESSAGES);
  return msgs;
}

// ---- Helper: update the last trade card in chat messages ----
function updateLastTradeCard(get: StoreGet, set: StoreSet, updatedTrade: TradeObject) {
  const msgs = [...get().messages];
  const idx = msgs.findLastIndex((m) => m.trade_card);
  if (idx !== -1) {
    msgs[idx] = { ...msgs[idx], trade_card: updatedTrade };
  }
  set({ messages: msgs });
}

// ---- The subset of FlashStore that this slice provides ----
export type TradeSlice = Pick<
  FlashStore,
  | "activeTrade"
  | "isExecuting"
  | "tradeCreatedAt"
  | "setTriggers"
  | "confirmTrade"
  | "executeTrade"
  | "completeExecution"
  | "failExecution"
  | "cancelTrade"
  | "closePosition"
>;

export function createTradeSlice(set: StoreSet, get: StoreGet): TradeSlice {
  return {
    // ---- State ----
    activeTrade: null,
    isExecuting: false,
    tradeCreatedAt: null,

    // ---- Set TP/SL on active trade (keystroke-driven) ----
    // Mutates the active trade's take_profit_price / stop_loss_price and
    // re-runs enrichTradeWithQuote — the canonical validator handles
    // direction checks (LONG TP > entry, etc.), distance bounds, and
    // NaN/Infinity guards. The card's existing error branch renders
    // enrich errors automatically.
    setTriggers: async (tradeId, triggers) => {
      const current = get().activeTrade;
      if (!current || current.id !== tradeId) return;
      if (current.status !== "READY" && current.status !== "INCOMPLETE" && current.status !== "ERROR") return;

      const versionBefore = bumpStateVersion();

      const next: TradeObject = {
        ...current,
        take_profit_price: "tp" in triggers ? (triggers.tp ?? null) : (current.take_profit_price ?? null),
        stop_loss_price: "sl" in triggers ? (triggers.sl ?? null) : (current.stop_loss_price ?? null),
        status: "INCOMPLETE",
        error: undefined,
      };

      updateLastTradeCard(get, set, next);
      set({ activeTrade: next });

      const enriched = await enrichTradeWithQuote(next);

      // Race guard: discard if a newer update landed during the async gap
      if (getStateVersion() !== versionBefore) return;
      if (get().activeTrade?.id !== tradeId) return;

      updateLastTradeCard(get, set, enriched);
      set({ activeTrade: enriched });
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
      const initialTrade = get().activeTrade;

      // STRICT state gate: only from CONFIRMING
      if (!initialTrade || initialTrade.status !== "CONFIRMING") return;
      let trade: TradeObject = initialTrade;

      const wallet = get().walletAddress;
      if (!wallet) return;

      // EXECUTION LOCK: prevent double-click (separate from close lock)
      if (tradeLock) return;

      // CROSS-TAB LOCK: prevent concurrent trades from multiple tabs
      if (isOtherTabTrading()) {
        const errorTrade: TradeObject = {
          ...trade,
          status: "ERROR",
          error: "Another tab is currently executing a trade. Complete or cancel it first.",
        };
        set({ activeTrade: errorTrade });
        return;
      }
      if (!acquireCrossTabLock()) {
        const errorTrade: TradeObject = {
          ...trade,
          status: "ERROR",
          error: "Could not acquire trade lock. Try again.",
        };
        set({ activeTrade: errorTrade });
        return;
      }

      setTradeLock(true);
      set({ isExecuting: true });

      // CERTIFICATION GATE: block if system is not certified
      const cert = evaluateCertification(get().streamStatus);
      if (!cert.execution_enabled) {
        logSystemEvent("circuit_open", { wallet, market: trade.market, reason: cert.reason, status: cert.status });
        const errorTrade: TradeObject = { ...trade, status: "ERROR", error: cert.reason };
        updateLastTradeCard(get, set, errorTrade);
        set({ activeTrade: errorTrade, isExecuting: false });
        releaseCrossTabLock();
        setTradeLock(false);
        return;
      }

      // WALLET RATE LIMIT: max 5 executions/min per wallet
      const walletLimit = checkWalletExecLimit(wallet);
      if (!walletLimit.allowed) {
        logSystemEvent("rate_limited", { wallet, market: trade.market, remaining: 0 });
        const errorTrade: TradeObject = {
          ...trade,
          status: "ERROR",
          error: "Rate limit: max 5 trades per minute. Wait and retry.",
        };
        updateLastTradeCard(get, set, errorTrade);
        set({ activeTrade: errorTrade, isExecuting: false });
        releaseCrossTabLock();
        setTradeLock(false);
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
        releaseCrossTabLock();
        setTradeLock(false);
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
        // SKIP for limit orders — the entry price is intentionally different from market price.
        const isLimitOrder = trade.order_type?.toUpperCase() === "LIMIT" || !!trade.limit_price;

        const livePrice = get().prices[trade.market];
        const previewPrice = trade.entry_price;

        if (!isLimitOrder && livePrice && previewPrice && Number.isFinite(livePrice.price) && livePrice.price > 0) {
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
            setTradeLock(false);
            return;
          }

          // Check for excessive drift since preview was built
          const drift = (Math.abs(livePrice.price - previewPrice) / previewPrice) * 100;
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
            setTradeLock(false);
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
            data: {
              action: "volatility_circuit_breaker",
              market: trade.market,
              range_pct: volCheck.range_pct.toFixed(1),
            },
          });
          transitionTo("failed", { error: `Volatility spike: ${volCheck.range_pct.toFixed(1)}%` });
          const errorTrade: TradeObject = {
            ...trade,
            status: "ERROR",
            error: `${trade.market} volatility spike (${volCheck.range_pct.toFixed(1)}% range) — trading paused. Retry shortly.`,
          };
          updateLastTradeCard(get, set, errorTrade);
          set({ activeTrade: errorTrade, isExecuting: false });
          setTradeLock(false);
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
          setTradeLock(false);
          return;
        }

        // ---- TOCTOU COMPLETE — proceed to API call ----

        // Defense-in-depth enrich fence: user may have edited TP/SL inside the
        // debounce window, or a background price tick may have invalidated
        // bounds/direction since the last enrich. Re-run the canonical validator
        // against the current trade and bail on ERROR before sending to the API.
        const fenced = await enrichTradeWithQuote(trade);
        if (fenced.status === "ERROR") {
          const errorTrade: TradeObject = { ...trade, status: "ERROR", error: fenced.error ?? "Validation failed" };
          updateLastTradeCard(get, set, errorTrade);
          set({ activeTrade: errorTrade, isExecuting: false });
          setTradeLock(false);
          return;
        }
        trade = fenced;

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

        // Note: For limit orders, TP/SL are passed to the API but only get
        // bundled for market orders. For limit orders, Flash API previews
        // TP/SL quotes but doesn't include them in the tx. TP/SL on limit
        // orders must be set after the limit triggers and position opens.
        const { result, latencyMs } = await withLatency(() =>
          buildOpenPosition({
            market: trade.market,
            side: trade.action,
            collateral,
            leverage,
            owner: wallet,
            takeProfitPrice: trade.take_profit_price ?? undefined,
            stopLossPrice: trade.stop_loss_price ?? undefined,
            orderType: trade.order_type?.toUpperCase() === "LIMIT" ? "LIMIT" : "MARKET",
            limitPrice: trade.limit_price ?? undefined,
          }),
        );

        // VERIFY: API didn't return a zero/invalid entry price
        if (!result.newEntryPrice || !Number.isFinite(result.newEntryPrice) || result.newEntryPrice <= 0) {
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
          !Number.isFinite(apiLeverage) ||
          apiLeverage < 1 ||
          !Number.isFinite(apiLiqPrice) ||
          apiLiqPrice <= 0 ||
          !Number.isFinite(apiFee) ||
          apiFee < 0
        ) {
          throw new Error("API returned invalid numeric fields");
        }

        // Transaction built — move to SIGNING state.
        // TP/SL trigger orders built AFTER position confirms (in useWalletSign)
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
        const failureType = errorMsg.includes("API")
          ? "api"
          : errorMsg.includes("RPC")
            ? "rpc"
            : errorMsg.includes("timeout") || errorMsg.includes("abort")
              ? "timeout"
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
        setTradeLock(false);
        set({ isExecuting: false });
      }
    },

    // ---- Complete Execution (called by UI after wallet signs + tx confirmed) ----
    completeExecution: (txSignature: string) => {
      releaseCrossTabLock();
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
      _collapseTimer = setTimeout(() => {
        _collapseTimer = null;
        const msgs = [...get().messages];
        if (msgs.length === 0) return;
        const last = [...msgs].reverse().find((m) => m.trade_card);
        if (last && last.trade_card?.status === "SUCCESS") {
          last.collapsed_trade = collapseData;
          last.trade_card = undefined;
          set({ messages: msgs });
        }
        const cur = get().activeTrade;
        if (cur?.tx_signature === txSignature) {
          set({ activeTrade: null });
        }
      }, 8000);

      // Record trade action for user pattern learning (fire-and-forget)
      try {
        import("@/lib/user-patterns")
          .then(({ recordTradeAction }) => {
            const entry = trade.entry_price ?? 0;
            recordTradeAction({
              market: trade.market,
              side: trade.action,
              leverage: trade.leverage ?? 0,
              collateral: trade.collateral_usd ?? 0,
              timestamp: Date.now(),
              hasTp: !!trade.take_profit_price,
              hasSl: !!trade.stop_loss_price,
              tpDistancePct:
                trade.take_profit_price && entry > 0
                  ? (Math.abs(trade.take_profit_price - entry) / entry) * 100
                  : undefined,
              slDistancePct:
                trade.stop_loss_price && entry > 0
                  ? (Math.abs(trade.stop_loss_price - entry) / entry) * 100
                  : undefined,
            });
          })
          .catch(() => {});
      } catch {}

      // Set activeTrade to the SUCCESS state (NOT null) so TradePreviewCard
      // can observe the tx_signature and flip to the success UI. Prior code
      // immediately nulled activeTrade, which meant the card never saw the
      // signature — it just saw activeTrade go from SIGNING to null, which
      // is indistinguishable from a cancel.
      set({ activeTrade: successTrade, isExecuting: false });
      setTradeLock(false);
      resetExecution(); // Clear persisted execution state
      _refreshTimer = setTimeout(() => {
        _refreshTimer = null;
        try {
          get().refreshPositions();
        } catch {}
      }, 1000);
    },

    // ---- Fail Execution (called by UI if wallet rejects or tx fails) ----
    failExecution: (error: string) => {
      releaseCrossTabLock();
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
      setTradeLock(false);
    },

    // ---- Cancel Trade ----
    cancelTrade: () => {
      const trade = get().activeTrade;

      // SAFETY: Cannot cancel during SIGNING or EXECUTING — tx may be signed/in flight
      if (trade && (trade.status === "SIGNING" || trade.status === "EXECUTING")) return;

      releaseCrossTabLock();

      if (_collapseTimer) {
        clearTimeout(_collapseTimer);
        _collapseTimer = null;
      }
      if (_refreshTimer) {
        clearTimeout(_refreshTimer);
        _refreshTimer = null;
      }

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
      bumpStateVersion();

      set({
        messages: capMessages([...msgs, sysMsg]),
        activeTrade: null,
      });
    },

    // ---- Close Position (separate lock from trade execution) ----
    closePosition: async (market: string, side: Side) => {
      const wallet = get().walletAddress;
      if (!wallet) return;

      if (closeLock) return;
      setCloseLock(true);

      try {
        // Find position key from current positions
        const position = get().positions.find((p) => p.market === market && p.side === side);
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
        const cleanData = await cleanResp.json().catch(() => {
          throw new Error("Invalid clean-tx response");
        });
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
        set({ messages: capMessages([...get().messages, sysMsg]) });
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : "Close failed";
        const sysMsg: ChatMessage = {
          id: msgId(),
          role: "system",
          content: `Error: ${errorMsg}`,
          timestamp: Date.now(),
        };
        set({ messages: capMessages([...get().messages, sysMsg]) });
      } finally {
        setCloseLock(false);
      }
    },
  };
}
