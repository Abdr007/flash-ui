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
import QuickReply from "./QuickReply";
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
        // Pass transfer history for insights tool (lightweight, last 50 only)
        try {
          const hist = localStorage.getItem("flash_transfer_history");
          if (hist) body.transfer_history = hist;
        } catch {}
        return fetch(url, { ...init, body: JSON.stringify(body) });
      } catch (e) {
        console.error("[ChatTransport]", e);
        return fetch(url, init);
      }
    },
  }));

  let chatHook: ReturnType<typeof useChat>;
  try {
    chatHook = useChat({ transport: transportRef.current });
  } catch (e) {
    console.error("[ChatPanel] useChat crashed:", e);
    // Return a minimal safe state
    chatHook = { messages: [], sendMessage: () => {}, status: "ready" } as unknown as ReturnType<typeof useChat>;
  }
  const { messages, sendMessage, status } = chatHook;
  const isStreaming = status === "streaming";
  const isError = status === "error";
  const hasMessages = messages.length > 0;
  const lastUserMsg = useRef<string>("");

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

  // Rotating placeholder prompts
  const PROMPTS = useMemo(() => [
    "Long SOL 5x $100...",
    "What's the price of ETH?",
    "Show my positions...",
    "Stake 500 FAF...",
    "Send 2 SOL to...",
    "Close my BTC position...",
    "Show all market prices...",
  ], []);
  const [promptIdx, setPromptIdx] = useState(0);
  useEffect(() => {
    if (hasMessages) return;
    const iv = setInterval(() => setPromptIdx((i) => (i + 1) % PROMPTS.length), 5000);
    return () => clearInterval(iv);
  }, [hasMessages, PROMPTS.length]);

  const handleSubmit = useCallback((text?: string) => {
    const msg = (text ?? input).trim();
    if (!msg || isStreaming || isExecuting) return;

    // Optimistic: show typing indicator BEFORE server responds
    setOptimisticPending(true);

    // Haptic feedback on mobile (noop on desktop/iOS)
    try { navigator?.vibrate?.(10); } catch {}

    lastUserMsg.current = msg;
    sendMessage({ text: msg });
    setInput("");
    setAutocomplete([]);
    setSelectedAC(-1);
  }, [input, isStreaming, isExecuting, sendMessage]);

  // Clear optimistic state once real streaming starts
  useEffect(() => {
    if (isStreaming) setOptimisticPending(false);
  }, [isStreaming]);

  // Safety net: clear optimistic state if streaming never starts (3s max)
  useEffect(() => {
    if (!optimisticPending) return;
    const t = setTimeout(() => setOptimisticPending(false), 3000);
    return () => clearTimeout(t);
  }, [optimisticPending]);

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
      <div ref={scrollRef} onScroll={handleScroll} className="no-scrollbar flex-1 overflow-y-auto scroll-smooth">
        {!hasMessages ? (
          /* ---- Hero state: compact, pushes input close ---- */
          <div className="flex flex-col items-center dot-grid">
            <PortfolioHero onAction={handleSubmit} />
          </div>
        ) : (
          /* ---- Chat messages (Neur-style spacing) ---- */
          <div className="max-w-3xl mx-auto w-full px-4 pb-36 pt-4">
            {messages.map((message, idx) => {
              const prev = idx > 0 ? messages[idx - 1] : null;
              const next = idx < messages.length - 1 ? messages[idx + 1] : null;
              const sameRole = prev?.role === message.role;
              const mt = idx === 0 ? "" : sameRole ? "mt-2" : "mt-6";
              const userText = message.role === "user"
                ? message.parts?.filter((p): p is { type: "text"; text: string } => p.type === "text").map((p) => p.text).join(" ") ?? ""
                : "";

              // Show quick replies only on the FIRST user message (button intent),
              // not on follow-up messages from quick reply clicks (prevents loops)
              const showQuickReply = message.role === "user"
                && idx === 0
                && messages.length === 1
                && !isStreaming
                && !isExecuting;

              return (
                <div key={message.id} className={`${message.role === "user" ? "msg-anim-instant" : "msg-anim"} ${mt}`}>
                  {message.role === "user" ? (
                    <>
                      <UserMessage text={userText} />
                      {showQuickReply && (
                        <QuickReply
                          userMessage={userText}
                          onSelect={handleSubmit}
                          disabled={isStreaming || isExecuting}
                        />
                      )}
                    </>
                  ) : (
                    <AssistantMessage parts={(message.parts ?? []) as Record<string, unknown>[]} onAction={handleSubmit} />
                  )}
                </div>
              );
            })}
            {(isStreaming || optimisticPending) && <StreamingDot />}
            <ErrorRetry
              show={isError && !isStreaming}
              messages={messages}
              onRetry={() => lastUserMsg.current && handleSubmit(lastUserMsg.current)}
            />
          </div>
        )}
      </div>

      {/* ---- Gradient fade (Neur: h-40, pointer-events-none) ---- */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[5] h-40"
        style={{ background: "linear-gradient(to top, var(--color-bg-root), var(--color-bg-root) 20%, transparent)" }} />

      {/* ---- Input (sticky bottom, Neur layout) ---- */}
      <div className="sticky bottom-0 z-10 safe-bottom">
        <div className="relative mx-auto w-full max-w-3xl px-4 py-4">
          {/* Autocomplete */}
          {autocomplete.length > 0 && (
            <div className="absolute bottom-full left-4 right-4 mb-2 overflow-hidden rounded-xl"
              style={{ background: "var(--color-bg-card)", border: "1px solid rgba(255,255,255,0.06)", animation: "fadeIn 100ms ease-out" }}>
              {autocomplete.map((s, i) => (
                <button
                  key={i}
                  onClick={() => handleSubmit(s)}
                  className={`autocomplete-item w-full text-left px-4 py-2.5 text-[14px] cursor-pointer
                    ${i === selectedAC ? "bg-bg-card-hover text-text-primary" : "text-text-secondary hover:bg-bg-card-hover hover:text-text-primary"}`}
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          {/* Suggestion chips (above input when chat active, hidden during wizard flows) */}
          {hasMessages && actionGroups.length > 0 && !isStreaming && !isExecuting && !optimisticPending && messages.length > 2 && (
            <div className="flex flex-wrap gap-2 mb-3">
              {actionGroups.flatMap((g) => g.actions).slice(0, 4).map((action, i) => (
                <button
                  key={i}
                  onClick={() => handleChipClick(action)}
                  className="chip chip-stagger text-[12px] px-3 py-1.5
                    text-text-secondary hover:text-text-primary cursor-pointer"
                  style={{ background: "rgba(20,26,34,0.8)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "9999px" }}
                >
                  {action.label}
                </button>
              ))}
            </div>
          )}

          {/* Input box (Galileo-style glass card) */}
          <div className="relative overflow-hidden glass-card input-glow"
            style={{ borderRadius: "16px" }}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={handleTextareaInput}
              onKeyDown={handleKeyDown}
              placeholder={isExecuting ? "Executing trade..." : isStreaming ? "Thinking..." : hasMessages ? "Ask anything..." : PROMPTS[promptIdx]}
              disabled={isExecuting}
              rows={1}
              className="w-full bg-transparent text-[15px] text-text-primary px-5 pt-4 pb-14
                placeholder:text-text-tertiary outline-none border-none resize-none no-scrollbar"
              style={{ minHeight: "90px", maxHeight: "200px" }}
              autoFocus
            />
            <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between px-5 py-3">
              <div className="flex items-center gap-2">
                {isStreaming && <StreamingDot inline />}
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => {
                    handleSubmit();
                    try { navigator?.vibrate?.(10); } catch {}
                  }}
                  disabled={!input.trim() || isStreaming || isExecuting}
                  className="w-9 h-9 rounded-xl flex items-center justify-center cursor-pointer shrink-0
                    transition-all duration-150 disabled:opacity-20 disabled:cursor-default
                    active:scale-90"
                  style={{
                    background: input.trim() && !isStreaming && !isExecuting
                      ? "var(--color-accent-lime)"
                      : "rgba(255,255,255,0.06)",
                    color: input.trim() && !isStreaming && !isExecuting
                      ? "#070A0F"
                      : "var(--color-text-tertiary)",
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="19" x2="12" y2="5" />
                    <polyline points="5 12 12 5 19 12" />
                  </svg>
                </button>
              </div>
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
    return <div className="w-2 h-2 rounded-full shrink-0" style={{ background: "var(--color-text-tertiary)", animation: "pulseDot 1s infinite" }} />;
  }
  return (
    <div className="flex items-center gap-3 py-2 mt-6 msg-anim">
      <div className="w-8 h-8 rounded-full shrink-0 flex items-center justify-center"
        style={{ background: "var(--color-bg-card)", border: "1px solid rgba(255,255,255,0.06)" }}>
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
          <path d="M3 12L8 3L13 12H3Z" fill="var(--color-accent-blue)" fillOpacity="0.9" />
        </svg>
      </div>
      <div className="flex items-center gap-1.5">
        <div className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--color-text-tertiary)", animation: "typingBounce 1.2s ease-in-out infinite -0.3s" }} />
        <div className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--color-text-tertiary)", animation: "typingBounce 1.2s ease-in-out infinite -0.15s" }} />
        <div className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--color-text-tertiary)", animation: "typingBounce 1.2s ease-in-out infinite 0s" }} />
      </div>
    </div>
  );
});

const ErrorRetry = memo(function ErrorRetry({ show, messages, onRetry }: { show: boolean; messages: { role: string; parts?: unknown[] }[]; onRetry: () => void }) {
  if (!show) return null;
  // Don't show error if the last assistant message has content (fast-path false positive)
  const lastMsg = messages[messages.length - 1];
  if (lastMsg?.role === "assistant" && lastMsg.parts && lastMsg.parts.length > 0) return null;
  return (
    <div className="flex items-center gap-3 py-2 mt-4 msg-anim">
      <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px]"
        style={{ background: "rgba(255,77,77,0.06)", border: "1px solid rgba(255,77,77,0.12)" }}>
        <span className="text-text-secondary">Something went wrong.</span>
        <button onClick={onRetry} className="font-semibold cursor-pointer hover:underline"
          style={{ color: "var(--color-accent-lime)" }}>Retry</button>
      </div>
    </div>
  );
});

// Markdown renderer — bold, clickable code commands, newlines
const SimpleMarkdown = memo(function SimpleMarkdown({ text, onAction }: { text: string; onAction?: (cmd: string) => void }) {
  const lines = text.split("\n");
  return (
    <>
      {lines.map((line, i) => {
        if (!line.trim() && i > 0) return <div key={i} className="h-2" />;

        const parts: React.ReactNode[] = [];
        let remaining = line;
        let key = 0;

        while (remaining.length > 0) {
          const boldMatch = remaining.match(/\*\*(.+?)\*\*/);
          const codeMatch = remaining.match(/`(.+?)`/);

          const firstMatch = [boldMatch, codeMatch]
            .filter(Boolean)
            .sort((a, b) => (a!.index ?? 999) - (b!.index ?? 999))[0];

          if (!firstMatch || firstMatch.index === undefined) {
            parts.push(<span key={key++}>{remaining}</span>);
            break;
          }

          if (firstMatch.index > 0) {
            parts.push(<span key={key++}>{remaining.slice(0, firstMatch.index)}</span>);
          }

          if (firstMatch === boldMatch) {
            parts.push(<strong key={key++} className="font-semibold text-text-primary">{firstMatch[1]}</strong>);
          } else {
            // Code blocks are CLICKABLE — sends the command to chat
            const cmd = firstMatch[1];
            parts.push(
              <button
                key={key++}
                onClick={() => onAction?.(cmd)}
                className="inline-flex px-2 py-1 rounded-md text-[12px] font-mono cursor-pointer
                  transition-all duration-100 hover:scale-[1.02] active:scale-[0.98]"
                style={{
                  background: "rgba(200,245,71,0.1)",
                  border: "1px solid rgba(200,245,71,0.15)",
                  color: "var(--color-accent-lime)",
                }}
              >
                {cmd}
              </button>
            );
          }

          remaining = remaining.slice(firstMatch.index + firstMatch[0].length);
        }

        return <div key={i} className="flex items-center gap-1 flex-wrap">{parts}</div>;
      })}
    </>
  );
});

const UserMessage = memo(function UserMessage({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-lg px-3.5 py-2.5"
        style={{ background: "rgba(200,245,71,0.12)", border: "1px solid rgba(200,245,71,0.15)" }}>
        <span className="text-[13px] text-text-primary leading-relaxed">{text}</span>
      </div>
    </div>
  );
});

const AssistantMessage = memo(function AssistantMessage({ parts, onAction }: { parts: Record<string, unknown>[]; onAction?: (cmd: string) => void }) {
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
      <div className="w-8 h-8 rounded-full shrink-0 flex items-center justify-center mt-0.5"
        style={{ background: "var(--color-bg-card)", border: "1px solid rgba(255,255,255,0.06)" }}>
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
          <path d="M3 12L8 3L13 12H3Z" fill="var(--color-accent-blue)" fillOpacity="0.9" />
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
                <div key={i} className="text-[14px] text-text-secondary leading-relaxed">
                  <SimpleMarkdown text={text} onAction={onAction} />
                </div>
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
                    onAction={onAction}
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
