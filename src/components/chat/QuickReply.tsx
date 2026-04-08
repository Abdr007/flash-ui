"use client";

// ============================================
// Flash AI — Quick Reply Options
// ============================================
// Renders Galileo-style contextual option buttons.
// Shows ONCE after the initial button-triggered message.
// Options are specific enough to not re-trigger themselves.

import { memo, useMemo } from "react";

interface QuickOption {
  label: string;
  intent: string;
  description?: string;
}

interface QuickReplyProps {
  userMessage: string;
  onSelect: (intent: string) => void;
  disabled?: boolean;
}

const INTENT_OPTIONS: {
  patterns: RegExp[];
  title: string;
  options: QuickOption[];
}[] = [
  {
    patterns: [/^I want to trade$/i, /^i want to trade$/i],
    title: "What would you like to trade?",
    options: [
      { label: "Long SOL", intent: "long SOL 5x $25", description: "5x leverage" },
      { label: "Short SOL", intent: "short SOL 3x $25", description: "3x leverage" },
      { label: "Long BTC", intent: "long BTC 5x $50", description: "5x leverage" },
      { label: "Long ETH", intent: "long ETH 5x $25", description: "5x leverage" },
      { label: "Show all markets", intent: "show all prices" },
    ],
  },
  {
    patterns: [/^I want to earn yield$/i],
    title: "What would you like to do with earning?",
    options: [
      { label: "See available pools", intent: "what earn pools are available and their APY?", description: "View pool APYs" },
      { label: "Deposit USDC to Crypto pool", intent: "deposit 50 USDC into crypto pool", description: "Crypto.1 pool" },
      { label: "Deposit USDC to DeFi pool", intent: "deposit 50 USDC into defi pool", description: "Governance pool" },
      { label: "My earn positions", intent: "show my earn positions" },
    ],
  },
  // "faf" → dashboard card handles action buttons directly (no duplicate QuickReply)
  {
    patterns: [/^I want to transfer tokens$/i],
    title: "What would you like to transfer?",
    options: [
      { label: "Send SOL", intent: "I want to send SOL to another wallet", description: "Transfer SOL" },
      { label: "Send USDC", intent: "I want to send USDC to another wallet", description: "Transfer USDC" },
      { label: "Send other token", intent: "I want to send a token to another wallet", description: "Any SPL token" },
    ],
  },
  {
    patterns: [/^show my portfolio$/i],
    title: "Portfolio overview",
    options: [
      { label: "My positions", intent: "show my positions", description: "Open trades" },
      { label: "Wallet balances", intent: "what are my token balances?" },
      { label: "Portfolio risk", intent: "analyze my portfolio risk and exposure" },
    ],
  },
];

function detectIntent(message: string): (typeof INTENT_OPTIONS)[number] | null {
  const trimmed = message.trim();
  for (const entry of INTENT_OPTIONS) {
    for (const pattern of entry.patterns) {
      if (pattern.test(trimmed)) return entry;
    }
  }
  return null;
}

const QuickReply = memo(function QuickReply({ userMessage, onSelect, disabled }: QuickReplyProps) {
  const intent = useMemo(() => detectIntent(userMessage), [userMessage]);

  if (!intent) return null;

  return (
    <div className="mt-5 mb-2 max-w-xl" style={{ animation: "slideUp 200ms ease-out" }}>
      <div className="text-[15px] text-text-secondary mb-3.5">{intent.title}</div>
      <div className="flex flex-col gap-2">
        {intent.options.map((opt, i) => (
          <button
            key={i}
            onClick={() => !disabled && onSelect(opt.intent)}
            disabled={disabled}
            className="quick-option group flex items-center justify-between w-full text-left
              px-4 py-3.5 rounded-xl cursor-pointer transition-all
              disabled:opacity-40 disabled:cursor-default"
            style={{
              background: "transparent",
              border: "1px solid var(--color-border-subtle)",
              animationDelay: `${i * 60}ms`,
            }}
          >
            <div className="flex flex-col">
              <span className="text-[14px] font-medium text-text-primary group-hover:text-accent-lime transition-colors">
                {opt.label}
              </span>
              {opt.description && (
                <span className="text-[12px] mt-0.5" style={{ color: "var(--color-text-tertiary)" }}>
                  {opt.description}
                </span>
              )}
            </div>
            <svg
              width="14" height="14" viewBox="0 0 24 24" fill="none"
              stroke="var(--color-text-tertiary)" strokeWidth="2" strokeLinecap="round"
              className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
            >
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </button>
        ))}
      </div>
    </div>
  );
});

export default QuickReply;
