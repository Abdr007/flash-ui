"use client";

// ============================================
// Flash AI — Chat Panel (Galileo-Style)
// ============================================
// Single centered column. Portfolio hero shows when no messages.
// Once user sends first message, hero collapses and chat takes over.

import { useEffect, useRef, useState, useCallback, useMemo, memo } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useFlashStore } from "@/store";
import ToolResultCard from "./ToolResultCard";
import PortfolioHero from "@/components/portfolio/PortfolioHero";
import {
  getSuggestedActions,
  getSuggestedActionGroups,
  getAutocompleteSuggestions,
  type SuggestedAction,
  type ActionGroup,
} from "@/lib/predictive-actions";
import { feedPrices } from "@/lib/market-awareness";

interface ChatPanelProps {
  heroCollapsed: boolean;
  onChatStart: () => void;
}

export default function ChatPanel({ heroCollapsed, onChatStart }: ChatPanelProps) {
  const [input, setInput] = useState("");
  const [autocomplete, setAutocomplete] = useState<string[]>([]);
  const [selectedAC, setSelectedAC] = useState(-1);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const autoScroll = useRef(true);

  const walletAddress = useFlashStore((s) => s.walletAddress);
  const walletConnected = useFlashStore((s) => s.walletConnected);
  const positions = useFlashStore((s) => s.positions);
  const prices = useFlashStore((s) => s.prices);
  const lastTradeDraft = useFlashStore((s) => s.lastTradeDraft);
  const recentMarkets = useFlashStore((s) => s.contextMemory.recentMarkets);
  const isExecuting = useFlashStore((s) => s.isExecuting);
  const activeTrade = useFlashStore((s) => s.activeTrade);
  const setStreaming = useFlashStore((s) => s.setStreaming);

  const transportRef = useRef(new DefaultChatTransport({
    api: "/api/chat",
    fetch: async (url, init) => {
      try {
        const state = useFlashStore.getState();
        let body: Record<string, unknown> = {};
        try { body = JSON.parse((init?.body as string) ?? "{}"); } catch {}
        body.wallet_address = state.walletAddress ?? "";
        body.context = state.getContextForAPI();
        return fetch(url, { ...init, body: JSON.stringify(body) });
      } catch (e) {
        console.error("[ChatTransport]", e);
        return fetch(url, init);
      }
    },
  }));

  const { messages, sendMessage, status } = useChat({ transport: transportRef.current });
  const isStreaming = status === "streaming";
  const hasMessages = messages.length > 0;

  useEffect(() => { setStreaming(isStreaming); }, [isStreaming, setStreaming]);

  useEffect(() => {
    if (Object.keys(prices).length > 0) feedPrices(prices);
  }, [prices]);

  // Collapse hero once we have messages
  useEffect(() => {
    if (hasMessages && !heroCollapsed) onChatStart();
  }, [hasMessages, heroCollapsed, onChatStart]);

  // Auto-scroll
  useEffect(() => {
    if (autoScroll.current && scrollRef.current) {
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
      });
    }
  }, [messages, isStreaming]);

  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    autoScroll.current = scrollHeight - scrollTop - clientHeight < 80;
  }, []);

  // Predictions
  const predictionState = useMemo(() => ({
    positions, lastTradeDraft, recentMarkets, prices,
    walletConnected, hasActiveTrade: !!activeTrade, isExecuting,
  }), [positions, lastTradeDraft, recentMarkets, prices, walletConnected, activeTrade, isExecuting]);

  const actionGroups = useMemo(() => getSuggestedActionGroups(predictionState), [predictionState]);
  const flatSuggestions = useMemo(() => getSuggestedActions(predictionState), [predictionState]);

  // Input handlers
  const handleInputChange = useCallback((value: string) => {
    setInput(value);
    setSelectedAC(-1);
    setAutocomplete(value.trim().length >= 2 ? getAutocompleteSuggestions(value) : []);
  }, []);

  // Optimistic: show instant placeholder the moment user sends
  const [optimisticPending, setOptimisticPending] = useState(false);

  const handleSubmit = useCallback((text?: string) => {
    const msg = (text ?? input).trim();
    if (!msg || isStreaming || isExecuting) return;

    // Optimistic: show typing indicator BEFORE server responds
    setOptimisticPending(true);

    // Haptic feedback on mobile (noop on desktop/iOS)
    try { navigator?.vibrate?.(10); } catch {}

    sendMessage({ text: msg });
    setInput("");
    setAutocomplete([]);
    setSelectedAC(-1);
  }, [input, isStreaming, isExecuting, sendMessage]);

  // Clear optimistic state once real streaming starts or messages update
  useEffect(() => {
    if (isStreaming || messages.length > 0) {
      setOptimisticPending(false);
    }
  }, [isStreaming, messages.length]);

  const handleChipClick = useCallback((action: SuggestedAction) => {
    handleSubmit(action.intent);
  }, [handleSubmit]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (autocomplete.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setSelectedAC(p => p < autocomplete.length - 1 ? p + 1 : 0); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setSelectedAC(p => p > 0 ? p - 1 : autocomplete.length - 1); return; }
      if (e.key === "Tab" && selectedAC >= 0) { e.preventDefault(); setInput(autocomplete[selectedAC]); setAutocomplete([]); return; }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      selectedAC >= 0 && autocomplete.length > 0 ? handleSubmit(autocomplete[selectedAC]) : handleSubmit();
    }
    if (e.key === "Escape") { setAutocomplete([]); setSelectedAC(-1); }
  }, [autocomplete, selectedAC, handleSubmit]);

  // Auto-resize textarea
  const handleTextareaInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    handleInputChange(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  }, [handleInputChange]);

  return (
    <div className="flex flex-col h-full">
      {/* ---- Scrollable area ---- */}
      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto scroll-smooth">
        {!hasMessages ? (
          /* ---- Hero state: Portfolio + Suggestions (Galileo layout) ---- */
          <div className="flex flex-col items-center min-h-full dot-grid">
            <PortfolioHero onAction={handleSubmit} onFillInput={(text) => {
              setInput(text);
              inputRef.current?.focus();
            }} />

            {/* Suggestions */}
            {flatSuggestions.length > 0 && (
              <div className="flex flex-wrap gap-2.5 justify-center max-w-[520px] px-6 pb-8">
                {flatSuggestions.map((action, i) => (
                  <button
                    key={i}
                    onClick={() => handleChipClick(action)}
                    className="chip chip-stagger text-[13px] px-4 py-2.5
                      text-text-secondary hover:text-text-primary cursor-pointer"
                    style={{ background: "rgba(20,26,34,0.8)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "9999px" }}
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          /* ---- Chat messages ---- */
          <div className="max-w-[720px] mx-auto px-5 py-6 flex flex-col gap-3">
            {messages.map((message) => (
              <div key={message.id} className="msg-anim">
                {message.role === "user" ? (
                  <UserMessage text={
                    message.parts?.filter((p): p is { type: "text"; text: string } => p.type === "text").map((p) => p.text).join(" ") ?? ""
                  } />
                ) : (
                  <AssistantMessage parts={(message.parts ?? []) as Record<string, unknown>[]} />
                )}
              </div>
            ))}
            {(isStreaming || optimisticPending) && <StreamingDot />}
          </div>
        )}
      </div>

      {/* ---- Grouped Chips (above input when chat active) ---- */}
      {hasMessages && actionGroups.length > 0 && !isStreaming && !isExecuting && (
        <div className="px-5 pb-2 pt-1">
          <div className="max-w-[720px] mx-auto flex flex-wrap gap-2">
            {actionGroups.flatMap((g) => g.actions).slice(0, 5).map((action, i) => (
              <button
                key={i}
                onClick={() => handleChipClick(action)}
                className="chip chip-stagger text-[12px] px-3.5 py-1.5
                  text-text-secondary hover:text-text-primary cursor-pointer"
                style={{ background: "rgba(20,26,34,0.8)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "9999px" }}
              >
                {action.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ---- Input (Galileo-style: full-width rounded box, bottom-pinned) ---- */}
      <div className="px-5 pb-5 pt-2 relative safe-bottom">
        {/* Autocomplete */}
        {autocomplete.length > 0 && (
          <div className="absolute bottom-full left-5 right-5 mb-2 max-w-[720px] mx-auto overflow-hidden"
            style={{ borderRadius: "16px", background: "var(--color-bg-card)", border: "1px solid rgba(255,255,255,0.06)", animation: "fadeIn 100ms ease-out" }}>
            {autocomplete.map((s, i) => (
              <button
                key={i}
                onClick={() => handleSubmit(s)}
                className={`autocomplete-item w-full text-left px-5 py-2.5 text-[14px] cursor-pointer
                  ${i === selectedAC ? "bg-bg-card-hover text-text-primary" : "text-text-secondary hover:bg-bg-card-hover hover:text-text-primary"}`}
              >
                {s}
              </button>
            ))}
          </div>
        )}

        <div className="max-w-[720px] mx-auto">
          <div className="input-glow relative rounded-2xl overflow-hidden transition-all duration-200"
            style={{ background: "var(--color-bg-card)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={handleTextareaInput}
              onKeyDown={handleKeyDown}
              placeholder={isExecuting ? "Executing trade..." : isStreaming ? "Thinking..." : "Long SOL 5x $50..."}
              disabled={isExecuting}
              rows={1}
              className="w-full bg-transparent text-[15px] text-text-primary px-5 pt-4 pb-12
                placeholder:text-text-tertiary outline-none border-none resize-none"
              style={{ minHeight: "60px", maxHeight: "120px" }}
              autoFocus
            />
            <div className="absolute bottom-3 right-3 flex items-center gap-3">
              {isStreaming && <StreamingDot inline />}
              <button
                onClick={() => {
                  handleSubmit();
                  // Micro-interaction: pulse the button
                  const btn = document.activeElement as HTMLElement;
                  btn?.classList.add("send-pulse");
                  setTimeout(() => btn?.classList.remove("send-pulse"), 200);
                }}
                disabled={!input.trim() || isStreaming || isExecuting}
                className="w-10 h-10 rounded-full flex items-center justify-center cursor-pointer shrink-0
                  transition-all duration-150 disabled:opacity-20 disabled:cursor-default
                  hover:scale-105 active:scale-95"
                style={{ background: input.trim() ? "var(--color-accent-lime)" : "rgba(200,245,71,0.3)" }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0A0E13" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="19" x2="12" y2="5" />
                  <polyline points="5 12 12 5 19 12" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- Sub-Components ----

const StreamingDot = memo(function StreamingDot({ inline }: { inline?: boolean }) {
  if (inline) {
    return <div className="w-2.5 h-2.5 rounded-full bg-accent-blue shrink-0" style={{ animation: "pulseDot 1s infinite" }} />;
  }
  return (
    <div className="flex items-center gap-3 py-2 msg-anim">
      <div className="w-8 h-8 rounded-xl shrink-0 flex items-center justify-center"
        style={{ background: "linear-gradient(135deg, #3B82F6, #8B5CF6)" }}>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <path d="M3 12L8 3L13 12H3Z" fill="white" fillOpacity="0.9" />
        </svg>
      </div>
      <div className="flex items-center gap-2">
        <span className="typing-dot" />
        <span className="typing-dot" />
        <span className="typing-dot" />
      </div>
    </div>
  );
});

const UserMessage = memo(function UserMessage({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] rounded-2xl rounded-tr-md px-5 py-3"
        style={{ background: "rgba(59,130,246,0.1)", border: "1px solid rgba(59,130,246,0.15)" }}>
        <span className="text-[15px] text-text-primary leading-relaxed">{text}</span>
      </div>
    </div>
  );
});

const AssistantMessage = memo(function AssistantMessage({ parts }: { parts: Record<string, unknown>[] }) {
  // Guard: parts could be undefined/null/not-array from bad API response
  const safeParts = Array.isArray(parts) ? parts : [];

  // Detect fast-path response and extract trade summary for intelligence signal
  let fastPathSummary = "";
  const isFastPath = safeParts.some((p) => {
    try {
      const toolInput = p?.input as Record<string, unknown> | undefined;
      const toolOutput = p?.output as Record<string, unknown> | undefined;
      const reqId = toolOutput?.request_id ?? (toolOutput?.output as Record<string, unknown> | undefined)?.request_id;
      if (typeof reqId === "string" && reqId.startsWith("fast_")) {
        // Build summary from tool input
        if (toolInput) {
          const parts: string[] = [];
          if (toolInput.side) parts.push(String(toolInput.side));
          if (toolInput.market) parts.push(String(toolInput.market));
          if (toolInput.leverage) parts.push(`${toolInput.leverage}x`);
          if (toolInput.collateral_usd) parts.push(`$${toolInput.collateral_usd}`);
          fastPathSummary = parts.join(" · ");
        }
        return true;
      }
    } catch {}
    return false;
  });

  return (
    <div className="flex items-start gap-3">
      <div className="w-8 h-8 rounded-xl shrink-0 flex items-center justify-center mt-0.5"
        style={{ background: "linear-gradient(135deg, #3B82F6, #8B5CF6)" }}>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <path d="M3 12L8 3L13 12H3Z" fill="white" fillOpacity="0.9" />
        </svg>
      </div>

      <div className="flex flex-col gap-3 min-w-0 flex-1">
        {isFastPath && (
          <div className="flex items-center gap-2 -mb-1.5">
            <span className="text-[10px] font-semibold tracking-wider" style={{ color: "var(--color-accent-lime)" }}>⚡ INSTANT</span>
            {fastPathSummary && <span className="text-[10px] text-text-tertiary">{fastPathSummary}</span>}
          </div>
        )}
        {safeParts.map((part, i) => {
          try {
            if (!part || typeof part !== "object") return null;

            if (part.type === "text") {
              const text = String(part.text ?? "");
              if (!text.trim()) return null;
              return (
                <div key={i} className="text-[15px] text-text-secondary leading-relaxed">{text}</div>
              );
            }

            if (part.type === "dynamic-tool" || (typeof part.type === "string" && (part.type as string).startsWith("tool-"))) {
              const toolName = part.type === "dynamic-tool"
                ? String(part.toolName ?? "unknown")
                : (part.type as string).replace("tool-", "");

              return (
                <div key={String(part.toolCallId ?? i)} className="card-anim">
                  <ToolResultCard
                    part={{
                      type: String(part.type),
                      toolName,
                      toolCallId: String(part.toolCallId ?? `tc_${i}`),
                      state: (part.state as "input-streaming" | "input-available" | "output-available") ?? "input-available",
                      input: part.input as Record<string, unknown> | undefined,
                      output: part.output as {
                        status: "success" | "error" | "degraded";
                        data: unknown;
                        error?: string;
                        request_id?: string;
                        latency_ms?: number;
                        warnings?: string[];
                      } | undefined,
                    }}
                  />
                </div>
              );
            }

            return null;
          } catch {
            // Silently skip malformed parts — never crash the whole chat
            return null;
          }
        })}
      </div>
    </div>
  );
});
