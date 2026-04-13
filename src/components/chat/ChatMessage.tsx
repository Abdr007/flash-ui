"use client";

import type { ChatMessage as ChatMessageType } from "@/lib/types";
import TradeCard from "@/components/trade/TradeCard";
import { formatTime, formatUsd, formatLeverage, formatPrice } from "@/lib/format";

export default function ChatMessage({ message }: { message: ChatMessageType }) {
  if (message.role === "user") return <UserLine message={message} />;
  return <SystemLine message={message} />;
}

function UserLine({ message }: { message: ChatMessageType }) {
  return (
    <div className="flex items-baseline gap-2 font-mono text-[13px]" style={{ animation: "fadeIn 100ms" }}>
      <span className="text-accent-blue shrink-0">{">"}</span>
      <span className="text-text-primary">{message.content}</span>
      <span className="text-text-tertiary text-[10px] ml-auto shrink-0">{formatTime(message.timestamp)}</span>
    </div>
  );
}

function SystemLine({ message }: { message: ChatMessageType }) {
  // Collapsed trade
  if (message.collapsed_trade) {
    const ct = message.collapsed_trade;
    const color = ct.side === "LONG" ? "var(--color-accent-long)" : "var(--color-accent-short)";
    return (
      <div className="flex items-baseline gap-2 font-mono text-[12px]" style={{ animation: "fadeIn 100ms" }}>
        <span style={{ color }}>✓</span>
        <span className="text-text-secondary">
          {ct.side} {ct.market}
        </span>
        <span className="num text-text-secondary">
          {formatUsd(ct.collateral)} · {formatLeverage(ct.leverage)} · {formatPrice(ct.entry_price)}
        </span>
        <span className="text-text-tertiary text-[10px] ml-auto shrink-0">{formatTime(message.timestamp)}</span>
      </div>
    );
  }

  const isReady = message.trade_card?.status === "READY";
  const isError = message.trade_card?.status === "ERROR";
  const prefix = isError ? "✕" : isReady ? "●" : "·";
  const prefixColor = isError
    ? "var(--color-accent-short)"
    : isReady
      ? "var(--color-accent-long)"
      : "var(--color-text-tertiary)";

  return (
    <div className="flex flex-col gap-2" style={{ animation: "slideUp 150ms ease-out" }}>
      {message.content && (
        <div className="flex items-baseline gap-2 font-mono text-[12px]">
          <span style={{ color: prefixColor }}>{prefix}</span>
          <span className={isReady ? "text-text-primary" : "text-text-secondary"}>{message.content}</span>
        </div>
      )}
      {message.trade_card && <TradeCard trade={message.trade_card} />}
    </div>
  );
}
