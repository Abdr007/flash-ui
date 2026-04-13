"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useFlashStore } from "@/store";

export default function InputBar() {
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const sendMessage = useFlashStore((s) => s.sendMessage);
  const isProcessing = useFlashStore((s) => s.isProcessing);
  const activeTrade = useFlashStore((s) => s.activeTrade);

  const isLocked =
    isProcessing ||
    activeTrade?.status === "EXECUTING" ||
    activeTrade?.status === "CONFIRMING" ||
    activeTrade?.status === "SIGNING";

  useEffect(() => {
    if (!isLocked) inputRef.current?.focus();
  }, [isLocked]);

  const handleSubmit = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || isLocked) return;
    setHistory((h) => [trimmed, ...h.slice(0, 49)]);
    setHistoryIdx(-1);
    sendMessage(trimmed);
    setInput("");
  }, [input, isLocked, sendMessage]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
    // Command history: up/down arrows
    if (e.key === "ArrowUp" && history.length > 0) {
      e.preventDefault();
      const nextIdx = Math.min(historyIdx + 1, history.length - 1);
      setHistoryIdx(nextIdx);
      setInput(history[nextIdx]);
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIdx <= 0) {
        setHistoryIdx(-1);
        setInput("");
      } else {
        const nextIdx = historyIdx - 1;
        setHistoryIdx(nextIdx);
        setInput(history[nextIdx]);
      }
    }
  };

  return (
    <div className="flex items-center h-11 px-4 bg-bg-root border-t border-border-subtle shrink-0 gap-2">
      <span className="text-text-tertiary text-[11px] font-mono select-none">{">"}</span>
      <input
        ref={inputRef}
        type="text"
        value={input}
        onChange={(e) => {
          setInput(e.target.value);
          setHistoryIdx(-1);
        }}
        onKeyDown={handleKeyDown}
        placeholder={isLocked ? "waiting..." : "command"}
        className="flex-1 bg-transparent border-none outline-none text-[13px] text-text-primary placeholder:text-text-tertiary font-mono"
        style={{ caretColor: "var(--color-accent-blue)" }}
        disabled={isLocked}
        autoComplete="off"
        spellCheck={false}
      />
      {isLocked && (
        <span
          className="w-2 h-2 border border-text-tertiary border-t-transparent rounded-full"
          style={{ animation: "spin 0.8s linear infinite" }}
        />
      )}
    </div>
  );
}
