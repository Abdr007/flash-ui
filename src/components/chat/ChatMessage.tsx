"use client";

import type { ChatMessage as ChatMessageType } from "@/lib/types";
import TradeCard from "@/components/trade/TradeCard";
import { formatTime, formatUsd, formatLeverage, formatPrice, truncateTx } from "@/lib/format";

interface ChatMessageProps {
  message: ChatMessageType;
}

export default function ChatMessage({ message }: ChatMessageProps) {
  if (message.role === "user") {
    return <UserBubble message={message} />;
  }

  return <SystemMessage message={message} />;
}

// ---- User Bubble (right-aligned) ----
function UserBubble({ message }: { message: ChatMessageType }) {
  return (
    <div className="flex justify-end" style={{ animation: "fadeIn 150ms ease-out" }}>
      <div
        className="max-w-[420px] px-4 py-3 border"
        style={{
          background: "rgba(74, 158, 255, 0.08)",
          borderColor: "rgba(74, 158, 255, 0.12)",
          borderRadius: "16px 16px 4px 16px",
        }}
      >
        <p className="text-[15px] text-text-primary leading-relaxed">
          {message.content}
        </p>
        <span className="block text-[11px] text-text-tertiary mt-1">
          {formatTime(message.timestamp)}
        </span>
      </div>
    </div>
  );
}

// ---- System Message ----
function SystemMessage({ message }: { message: ChatMessageType }) {
  // Collapsed trade
  if (message.collapsed_trade) {
    const ct = message.collapsed_trade;
    const isLong = ct.side === "LONG";
    return (
      <div
        className="flex items-center gap-2 px-3 py-2 rounded-lg w-fit"
        style={{
          background: isLong
            ? "rgba(0, 208, 132, 0.06)"
            : "rgba(255, 77, 106, 0.06)",
          animation: "fadeIn 150ms ease-out",
        }}
      >
        <span
          className="text-[13px] font-medium"
          style={{ color: isLong ? "var(--color-accent-long)" : "var(--color-accent-short)" }}
        >
          ✓
        </span>
        <span className="text-[13px] text-text-secondary">
          Opened {ct.market} {ct.side} · {formatUsd(ct.collateral)} ·{" "}
          {formatLeverage(ct.leverage)} · Entry {formatPrice(ct.entry_price)}
        </span>
        <span className="text-[11px] text-text-tertiary">
          {formatTime(message.timestamp)}
        </span>
      </div>
    );
  }

  // Determine icon color
  const isReady = message.trade_card?.status === "READY";
  const isError = message.trade_card?.status === "ERROR";
  const iconColor = isError
    ? "var(--color-accent-short)"
    : isReady
    ? "var(--color-accent-long)"
    : "var(--color-accent-blue)";

  return (
    <div className="flex flex-col gap-3" style={{ animation: "fadeIn 150ms ease-out" }}>
      {/* Text content */}
      {message.content && (
        <div className="flex items-start gap-2.5">
          <span className="text-sm mt-0.5" style={{ color: iconColor }}>
            ◆
          </span>
          <span
            className={`text-sm ${
              isReady ? "font-medium text-text-primary" : "text-text-secondary"
            }`}
          >
            {message.content}
          </span>
        </div>
      )}

      {/* Trade card */}
      {message.trade_card && <TradeCard trade={message.trade_card} />}
    </div>
  );
}
