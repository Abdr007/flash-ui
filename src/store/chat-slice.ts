// ============================================
// Flash UI — Chat + AI Slice
// ============================================
//
// Owns: messages, chat processing, AI trade actions,
// context memory, streaming state, and the sendMessage
// state machine (progressive build + parser + AI fallback).

import type { ChatMessage, Position } from "@/lib/types";
import type { TradeObject } from "@/lib/types";
import {
  parseCommand,
  parseFieldResponse,
  getNextQuestion,
  applyModification,
  checkCloseAmbiguity,
} from "@/lib/parser";
import { enrichTradeWithQuote } from "@/lib/api";
import { validateTrade } from "@/lib/trade-firewall";
import { logInfo, logError } from "@/lib/logger";
import {
  resolveTradeModification,
  type TradePreviewData,
  type PositionData,
  type PortfolioData,
  type ClosePreviewData,
} from "@/lib/tool-result-handler";
import type { FlashStore, StoreSet, StoreGet, ContextMemory } from "./types";
import { msgId, tradeLock, closeLock, setCloseLock, getStateVersion, bumpStateVersion } from "./types";

const MAX_MESSAGES = 200;
function capMessages(msgs: ChatMessage[]): ChatMessage[] {
  if (msgs.length > MAX_MESSAGES) msgs.splice(0, msgs.length - MAX_MESSAGES);
  return msgs;
}

// ---- The subset of FlashStore that this slice provides ----
export type ChatSlice = Pick<
  FlashStore,
  | "messages"
  | "isProcessing"
  | "isStreaming"
  | "traceId"
  | "currentTrade"
  | "lastTradeDraft"
  | "closePreview"
  | "contextMemory"
  | "loadingStates"
  | "lastError"
  | "sendMessage"
  | "clearChat"
  | "setTradeFromAI"
  | "modifyTrade"
  | "setClosePreview"
  | "updatePositionsFromAI"
  | "updatePortfolioFromAI"
  | "setAIError"
  | "setStreaming"
  | "setTraceId"
  | "updateContextMemory"
  | "setToolLoading"
  | "clearAITrade"
  | "getContextForAPI"
>;

export function createChatSlice(set: StoreSet, get: StoreGet): ChatSlice {
  return {
    // ---- State ----
    messages: [],
    isProcessing: false,
    isStreaming: false,
    traceId: "",
    currentTrade: null,
    lastTradeDraft: null,
    closePreview: null,
    contextMemory: {
      lastIntent: null,
      lastTradeDraft: null,
      portfolioSnapshot: null,
      recentMarkets: [],
    },
    loadingStates: {},
    lastError: null,

    // ---- Send Message (core state machine) ----
    sendMessage: async (input: string) => {
      const trimmed = input.trim();
      if (!trimmed) return;

      const state = get();

      // GUARD: Block input while trade is executing or confirming
      if (
        state.activeTrade &&
        (state.activeTrade.status === "EXECUTING" || state.activeTrade.status === "CONFIRMING")
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
      const versionBefore = bumpStateVersion();

      set({ messages: capMessages([...state.messages, userMsg]), isProcessing: true });

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
            messages: capMessages([...get().messages, sysMsg]),
            activeTrade: updated,
            isProcessing: false,
          });
          return;
        }

        // All fields present — enrich with API (async gap)
        const enriched = await enrichTradeWithQuote(updated);

        // RACE CHECK: If state changed during async gap, discard result
        if (getStateVersion() !== versionBefore) {
          set({ isProcessing: false });
          return;
        }

        const sysMsg: ChatMessage = {
          id: msgId(),
          role: "system",
          content: enriched.status === "READY" ? "Ready to execute." : enriched.error || "Error loading market data.",
          timestamp: Date.now(),
          trade_card: enriched,
        };
        set({
          messages: capMessages([...get().messages, sysMsg]),
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
            messages: capMessages([...get().messages, sysMsg]),
            activeTrade: trade,
            isProcessing: false,
          });
          return;
        }

        const enriched = await enrichTradeWithQuote(trade);

        if (getStateVersion() !== versionBefore) {
          set({ isProcessing: false });
          return;
        }

        // Build status message — include chain info
        let readyMsg = "Ready to execute.";
        if (parsed.chain && parsed.chain.length > 0 && enriched.status === "READY") {
          const chainLabels = parsed.chain.map((c) => {
            if (c.type === "SET_SL") return `SL ${c.stop_loss_pct ? c.stop_loss_pct + "%" : "$" + c.stop_loss_price}`;
            if (c.type === "SET_TP")
              return `TP ${c.take_profit_pct ? c.take_profit_pct + "%" : "$" + c.take_profit_price}`;
            return c.type;
          });
          readyMsg = `Ready to execute with ${chainLabels.join(" + ")}.`;
        }

        const sysMsg: ChatMessage = {
          id: msgId(),
          role: "system",
          content: enriched.status === "READY" ? readyMsg : enriched.error || "Error loading market data.",
          timestamp: Date.now(),
          trade_card: enriched,
        };
        set({
          messages: capMessages([...get().messages, sysMsg]),
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

        const side = intent.side ?? state.positions.find((p) => p.market === market)?.side;

        addSystemMsg(`Closing ${side ? side + " " : ""}${market} position...`);
        set({ activeTrade: null });
        await get().closePosition(market, side ?? "LONG");
        set({ isProcessing: false });
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
        if (closeLock) {
          set({ isProcessing: false });
          return;
        }
        setCloseLock(true);
        try {
          const wallet = get().walletAddress;
          if (!wallet) {
            addSystemMsg("Connect wallet to reduce position.");
            return;
          }
          const { buildClosePosition } = await import("@/lib/api");
          const result = await buildClosePosition({ market, side, owner: wallet, closePercent: pct });
          if (result.err) throw new Error(result.err);
          addSystemMsg(`${market} reduced by ${pct}%.`);
          get().refreshPositions();
        } catch (err: unknown) {
          const errorMsg = err instanceof Error ? err.message : "Reduce failed";
          addSystemMsg(`Error: ${errorMsg}`);
        } finally {
          setCloseLock(false);
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

        if (getStateVersion() !== versionBefore) {
          set({ isProcessing: false });
          return;
        }

        const sysMsg: ChatMessage = {
          id: msgId(),
          role: "system",
          content:
            enriched.status === "READY" ? "Updated. Ready to execute." : enriched.error || "Error updating trade.",
          timestamp: Date.now(),
          trade_card: enriched,
        };
        set({
          messages: capMessages([...get().messages, sysMsg]),
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

      // ---- EARN ----
      if (parsed.type === "earn") {
        addSystemMsg("Earn command detected. Use the Earn page (tap Earn button) to deposit or withdraw from pools.");
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
              ]
                .filter(Boolean)
                .join(" ");

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
                if (getStateVersion() !== versionBefore) {
                  set({ isProcessing: false });
                  return;
                }
                addSystemMsg(
                  enriched.status === "READY" ? "Ready to execute." : enriched.error || "Error loading data.",
                  enriched,
                );
                set({ activeTrade: enriched, isProcessing: false });
                return;
              }
            }

            if (aiIntent.intent === "CLOSE_POSITION" && aiIntent.market) {
              addSystemMsg(`Closing ${aiIntent.market}...`);
              set({ activeTrade: null });
              await get().closePosition(aiIntent.market, side ?? "LONG");
              set({ isProcessing: false });
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
        set({ messages: capMessages([...get().messages, sysMsg]) });
      }
    },

    // ---- Clear Chat ----
    clearChat: () => {
      if (tradeLock || closeLock) return;
      bumpStateVersion();
      set({ messages: [], activeTrade: null, currentTrade: null, lastTradeDraft: null, closePreview: null });
    },

    // ============================================
    // AI Actions — Phase 2
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
        // Pass limit order fields through
        order_type: typeof rawTrade.order_type === "string" ? (rawTrade.order_type as "MARKET" | "LIMIT") : undefined,
        limit_price: typeof rawTrade.limit_price === "number" ? rawTrade.limit_price : undefined,
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
  };
}
