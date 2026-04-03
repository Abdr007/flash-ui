"use client";

import { useEffect, useRef } from "react";
import { useFlashStore } from "@/store";
import ChatMessage from "./ChatMessage";

export default function ChatPanel() {
  const messages = useFlashStore((s) => s.messages);
  const isProcessing = useFlashStore((s) => s.isProcessing);
  const scrollRef = useRef<HTMLDivElement>(null);
  const shouldAutoScroll = useRef(true);

  useEffect(() => {
    if (shouldAutoScroll.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    shouldAutoScroll.current = scrollHeight - scrollTop - clientHeight < 80;
  };

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 opacity-40">
        <span className="text-[11px] text-text-tertiary font-mono tracking-widest uppercase">
          flash perps engine
        </span>
        <span className="text-[11px] text-text-tertiary font-mono">
          type a command to begin
        </span>
      </div>
    );
  }

  return (
    <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto">
      <div className="max-w-[640px] mx-auto px-4 py-4 flex flex-col gap-2.5">
        {messages.map((msg) => (
          <ChatMessage key={msg.id} message={msg} />
        ))}
        {isProcessing && (
          <div className="flex items-center gap-1.5 text-[11px] text-text-tertiary font-mono">
            <span className="w-1.5 h-1.5 rounded-full bg-accent-blue" style={{ animation: "pulseDot 1s infinite" }} />
            processing
          </div>
        )}
      </div>
    </div>
  );
}
