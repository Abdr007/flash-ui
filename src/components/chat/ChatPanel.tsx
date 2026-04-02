"use client";

import { useEffect, useRef } from "react";
import { useFlashStore } from "@/store";
import ChatMessage from "./ChatMessage";

export default function ChatPanel() {
  const messages = useFlashStore((s) => s.messages);
  const isProcessing = useFlashStore((s) => s.isProcessing);
  const scrollRef = useRef<HTMLDivElement>(null);
  const shouldAutoScroll = useRef(true);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (shouldAutoScroll.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Detect manual scroll
  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    shouldAutoScroll.current = scrollHeight - scrollTop - clientHeight < 100;
  };

  if (messages.length === 0) {
    return <EmptyState />;
  }

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto"
    >
      <div className="max-w-[680px] mx-auto px-6 py-8 flex flex-col gap-4">
        {messages.map((msg) => (
          <ChatMessage key={msg.id} message={msg} />
        ))}

        {/* Typing indicator */}
        {isProcessing && <TypingIndicator />}
      </div>
    </div>
  );
}

function EmptyState() {
  const sendMessage = useFlashStore((s) => s.sendMessage);

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4">
      <span className="text-[32px] text-accent-blue select-none">◆</span>
      <h2 className="text-xl font-medium text-text-primary">
        What would you like to trade?
      </h2>
      <button
        onClick={() => sendMessage("Long SOL 100 5x")}
        className="px-4 py-2 rounded-full text-sm text-text-tertiary border border-accent-blue/10 bg-accent-blue/5 hover:bg-accent-blue/10 hover:text-text-secondary transition-colors cursor-pointer"
      >
        Try: &quot;Long SOL 100 5x&quot;
      </button>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-bg-card w-fit">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-1.5 h-1.5 rounded-full bg-text-tertiary"
          style={{
            animation: `pulseDot 1.2s ease-in-out ${i * 0.15}s infinite`,
          }}
        />
      ))}
    </div>
  );
}
