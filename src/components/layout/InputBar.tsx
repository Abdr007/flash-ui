"use client";

import { useState, useRef, useEffect } from "react";
import { useFlashStore } from "@/store";

export default function InputBar() {
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const sendMessage = useFlashStore((s) => s.sendMessage);
  const isProcessing = useFlashStore((s) => s.isProcessing);
  const activeTrade = useFlashStore((s) => s.activeTrade);

  // Input is blocked during execution or confirmation
  const isLocked =
    isProcessing ||
    activeTrade?.status === "EXECUTING" ||
    activeTrade?.status === "CONFIRMING";

  useEffect(() => {
    if (!isLocked) {
      inputRef.current?.focus();
    }
  }, [isLocked]);

  const handleSubmit = () => {
    const trimmed = input.trim();
    if (!trimmed || isLocked) return;
    sendMessage(trimmed);
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const hasInput = input.trim().length > 0;

  return (
    <div
      className="flex items-center h-14 px-5 bg-bg-input shrink-0 gap-3"
      style={{
        borderTop: hasInput && !isLocked
          ? "1px solid rgba(74, 158, 255, 0.4)"
          : "1px solid var(--color-border-subtle)",
        transition: "border-color 150ms",
      }}
    >
      <span className="text-text-tertiary text-base select-none">⌘</span>

      <input
        ref={inputRef}
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={
          isLocked ? "Trade in progress..." : "Trade, ask, or command..."
        }
        className="flex-1 bg-transparent border-none outline-none text-[15px] text-text-primary placeholder:text-text-tertiary"
        style={{ caretColor: "var(--color-accent-blue)" }}
        disabled={isLocked}
      />

      <button
        onClick={handleSubmit}
        disabled={!hasInput || isLocked}
        className={`flex items-center justify-center w-8 h-8 rounded-lg text-white text-base font-semibold transition-all ${
          hasInput && !isLocked
            ? "bg-accent-blue hover:brightness-110 cursor-pointer"
            : "bg-accent-blue/30 cursor-default"
        }`}
      >
        ↵
      </button>
    </div>
  );
}
