"use client";

// ============================================
// Flash AI — Shared UI components for tool result cards
// ============================================

import { memo, useState } from "react";
import { formatPrice } from "@/lib/format";
import type { TradeConfidence } from "@/lib/predictive-actions";
export type { ToolPart, ToolOutput, TxStatus } from "./types";

// ---- Tool Step Definitions ----

export const TOOL_STEPS: Record<string, string[]> = {
  build_trade: ["Fetching price", "Calculating position", "Validating trade"],
  earn_deposit: ["Checking pool", "Building deposit preview"],
  transfer_preview: ["Validating address", "Checking balance", "Building preview"],
  transfer_history: ["Loading history", "Analyzing patterns"],
  faf_dashboard: ["Loading stake data"],
  faf_stake: ["Checking balance", "Building preview"],
  faf_unstake: ["Checking stake", "Building preview"],
  faf_claim: ["Loading rewards"],
  faf_requests: ["Loading requests"],
  faf_cancel_unstake: ["Validating request"],
  faf_tier: ["Loading tiers"],
  close_position_preview: ["Loading position", "Fetching exit price", "Calculating PnL"],
  add_collateral: ["Loading position", "Calculating new leverage"],
  remove_collateral: ["Loading position", "Validating removal", "Calculating new leverage"],
  reverse_position_preview: ["Loading position", "Calculating reversal", "Estimating fees"],
  get_positions: ["Querying positions"],
  get_portfolio: ["Loading portfolio"],
  get_price: ["Fetching price"],
  get_all_prices: ["Loading markets"],
  get_market_info: ["Loading market info"],
};

// ---- Streaming Steps ----

export const StreamingSteps = memo(function StreamingSteps({
  toolName,
  step,
  input,
}: {
  toolName: string;
  step: 1 | 2;
  input?: Record<string, unknown>;
}) {
  const steps = TOOL_STEPS[toolName] ?? ["Processing"];

  // Simple single-line loader for most tools
  if (steps.length <= 2 && toolName !== "build_trade") {
    return (
      <div className="flex items-center gap-2 py-1 text-[12px] text-text-tertiary">
        <span
          className="w-1.5 h-1.5 rounded-full"
          style={{ background: "var(--color-accent-warn)", animation: "pulseDot 1s infinite" }}
        />
        <span>
          {steps[0]}
          {input?.market ? ` ${input.market}` : ""}...
        </span>
      </div>
    );
  }

  // Multi-step loader for trade building
  return (
    <div className="w-full max-w-[420px] glass-card overflow-hidden" style={{ animation: "fadeIn 150ms ease-out" }}>
      <div className="px-3 py-2.5 flex flex-col gap-1.5">
        {steps.map((label, i) => {
          const isDone = i < step;
          const isCurrent = i === step - 1;
          return (
            <div key={i} className="flex items-center gap-2 text-[12px]">
              {isDone ? (
                <span className="text-accent-long w-3 text-center text-[10px]">✓</span>
              ) : isCurrent ? (
                <span
                  className="w-1.5 h-1.5 rounded-full ml-[3px]"
                  style={{ background: "var(--color-accent-warn)", animation: "pulseDot 1s infinite" }}
                />
              ) : (
                <span className="w-3 text-center text-text-tertiary text-[10px]">·</span>
              )}
              <span className={isDone ? "text-text-secondary" : isCurrent ? "text-text-primary" : "text-text-tertiary"}>
                {label}
                {i === 0 && input?.market ? ` ${input.market}` : ""}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
});

// ---- Unified transaction success card ----
// Used by every card that transitions to a "tx broadcast, on-chain" state
// (trade open, position close, collateral add/remove, earn deposit, etc).
// Single source of truth for success styling — one line, inline Solscan link.
export function TxSuccessCard({
  label,
  signature,
  variant = "long",
}: {
  label: string;
  signature: string | null | undefined;
  variant?: "long" | "short";
}) {
  const color = variant === "long" ? "var(--color-accent-long)" : "var(--color-accent-short)";
  const bg = variant === "long" ? "rgba(16,185,129,0.06)" : "rgba(239,68,68,0.06)";
  return (
    <div role="status" aria-live="polite" className="w-full max-w-[460px] glass-card overflow-hidden success-glow">
      <div className="px-5 py-3.5 flex items-center gap-2.5" style={{ background: bg }}>
        <span className="text-[14px]" style={{ color }}>
          ✓
        </span>
        <span className="text-[14px] font-medium" style={{ color }}>
          {label}
        </span>
        {signature && (
          <a
            href={`https://solscan.io/tx/${signature}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[12px] text-text-tertiary ml-auto hover:text-text-primary underline"
          >
            View on Solscan →
          </a>
        )}
      </div>
    </div>
  );
}

// ---- TP/SL validator (mirrors trade-firewall checks so errors surface live) ----
export function validateTpSlAgainstEntry(
  tp: number | null,
  sl: number | null,
  entry: number,
  side: "LONG" | "SHORT",
): string | null {
  if (!Number.isFinite(entry) || entry <= 0) return null;
  if (tp != null) {
    if (!Number.isFinite(tp) || tp <= 0) return "Take profit must be a positive number.";
    const dist = Math.abs(tp - entry) / entry;
    if (dist > 5) return `Take profit $${tp} is >500% from entry $${entry.toFixed(2)} — unrealistic.`;
    if (dist < 0.001) return `Take profit $${tp} is <0.1% from entry $${entry.toFixed(2)} — too tight.`;
    if (side === "LONG" && tp <= entry) return `LONG take profit must be above entry $${entry.toFixed(2)}.`;
    if (side === "SHORT" && tp >= entry) return `SHORT take profit must be below entry $${entry.toFixed(2)}.`;
  }
  if (sl != null) {
    if (!Number.isFinite(sl) || sl <= 0) return "Stop loss must be a positive number.";
    const dist = Math.abs(sl - entry) / entry;
    if (dist > 5) return `Stop loss $${sl} is >500% from entry $${entry.toFixed(2)} — unrealistic.`;
    if (dist < 0.001) return `Stop loss $${sl} is <0.1% from entry $${entry.toFixed(2)} — too tight.`;
    if (side === "LONG" && sl >= entry) return `LONG stop loss must be below entry $${entry.toFixed(2)}.`;
    if (side === "SHORT" && sl <= entry) return `SHORT stop loss must be above entry $${entry.toFixed(2)}.`;
  }
  return null;
}

// ---- Token Icons ----

// Full curated icon registry — covers all Flash Trade markets plus common
// Solana tokens. Sourced from Jupiter lite-api v2, Solana token-list, and
// Wikimedia Commons.
export const TOKEN_ICONS: Record<string, string> = {
  // ---- Crypto majors (Portal-wrapped for non-Solana chains) ----
  SOL: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png",
  BTC: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh/logo.png",
  WBTC: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh/logo.png",
  ETH: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs/logo.png",
  BNB: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/9gP2kCy3wA1ctvYWQk75guqXuHfrEomqydHLtcTCqiLa/logo.png",
  ZEC: "https://arweave.net/QSYqnmB7NYlB7n1R6rz935Y07dlRK0tIuKe2mof5Sho",
  HYPE: "https://arweave.net/QBRdRop8wI4PpScSRTKyibv-fQuYBua-WOvC7tuJyJo",

  // ---- Solana ecosystem ----
  JUP: "https://static.jup.ag/jup/icon.png",
  PYTH: "https://pyth.network/token.svg",
  JTO: "https://metadata.jito.network/token/jto/image",
  RAY: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R/logo.png",
  KMNO: "https://cdn.kamino.finance/kamino.svg",

  // ---- Memes ----
  BONK: "https://arweave.net/hQiPZOsRZXGXBJd_82PhVdlM_hACsT_q6wqwf5cSY7I",
  WIF: "https://bafkreibk3covs5ltyqxa272uodhculbr6kea6betidfwy3ajsav2vjzyum.ipfs.nftstorage.link",
  PENGU: "https://arweave.net/BW67hICaKGd2_wamSB0IQq-x7Xwtmr2oJj1WnWGJRHU",
  FARTCOIN: "https://ipfs.io/ipfs/QmQr3Fz4h1etNsF7oLGMRHiCzhB5y9a7GjyodnF7zLHK1g",
  ORE: "https://ore.supply/assets/icon.png",
  PUMP: "https://ipfs.io/ipfs/bafkreibyb3hcn7gglvdqpmklfev3fut3eqv3kje54l3to3xzxxbgpt5wjm",

  // ---- Stablecoins ----
  USDC: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png",
  USDT: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB/logo.svg",

  // ---- SOL derivatives ----
  WSOL: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png",
  JitoSOL: "https://storage.googleapis.com/token-metadata/JitoSOL-256.png",
  jitoSOL: "https://storage.googleapis.com/token-metadata/JitoSOL-256.png",
  mSOL: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So/logo.png",
  bSOL: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1/logo.png",

  // ---- US equities (Wikimedia Commons SVG — permanent) ----
  AAPL: "https://upload.wikimedia.org/wikipedia/commons/f/fa/Apple_logo_black.svg",
  TSLA: "https://upload.wikimedia.org/wikipedia/commons/b/bb/Tesla_T_symbol.svg",
  NVDA: "https://upload.wikimedia.org/wikipedia/commons/2/21/Nvidia_logo.svg",
  AMD: "https://upload.wikimedia.org/wikipedia/commons/7/7c/AMD_Logo.svg",
  AMZN: "https://upload.wikimedia.org/wikipedia/commons/a/a9/Amazon_logo.svg",

  // ---- FAF — Flash Trade protocol token ----
  FAF: "/ft-logo.svg",
};

// Stable hashed gradient colors so the fallback tile looks intentional and
// different tokens visually distinguish from each other.
export function hashGradient(symbol: string): { from: string; to: string } {
  let h = 0;
  for (let i = 0; i < symbol.length; i++) h = (h * 31 + symbol.charCodeAt(i)) >>> 0;
  const hue1 = h % 360;
  const hue2 = (h * 7 + 40) % 360;
  return {
    from: `hsl(${hue1}, 55%, 42%)`,
    to: `hsl(${hue2}, 60%, 22%)`,
  };
}

export function TokenIcon({ symbol, size = 28, src }: { symbol: string; size?: number; src?: string }) {
  const [failed, setFailed] = useState(false);
  // Prefer explicit override (Helius metadata URI), fall back to curated map
  const url = (src && src.trim()) || TOKEN_ICONS[symbol];

  if (!url || failed) {
    // Full-ticker gradient tile — handles ANY unknown symbol elegantly
    const display = symbol.length > 4 ? symbol.slice(0, 4) : symbol;
    const grad = hashGradient(symbol);
    const fontSize = display.length <= 2 ? size * 0.44 : display.length === 3 ? size * 0.32 : size * 0.26;
    return (
      <div
        className="rounded-full shrink-0 flex items-center justify-center font-bold text-white"
        style={{
          width: size,
          height: size,
          background: `linear-gradient(135deg, ${grad.from}, ${grad.to})`,
          fontSize: Math.round(fontSize),
          letterSpacing: "0.02em",
          boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.08)",
        }}
      >
        {display}
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={symbol}
      width={size}
      height={size}
      className="rounded-full shrink-0"
      style={{ width: size, height: size, objectFit: "cover", background: "rgba(255,255,255,0.04)" }}
      onError={() => setFailed(true)}
    />
  );
}

// ---- Symbol Sets ----

export const CRYPTO_SYMBOLS = new Set([
  "SOL",
  "BTC",
  "ETH",
  "BNB",
  "ZEC",
  "BONK",
  "WIF",
  "JUP",
  "PYTH",
  "JTO",
  "RAY",
  "PENGU",
  "FARTCOIN",
  "ORE",
  "HYPE",
  "KMNO",
  "PUMP",
]);
export const COMMODITY_SYMBOLS = new Set(["XAU", "XAUt"]);

// ---- Section Header & Price Section (used by PriceCard) ----

export function SectionHeader({ label }: { label: string }) {
  return (
    <div
      className="px-5 py-2 text-[10px] text-text-tertiary tracking-wider uppercase"
      style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}
    >
      {label}
    </div>
  );
}

export interface PriceRow {
  symbol: string;
  price: number;
}

export function PriceSection({ rows }: { rows: PriceRow[] }) {
  return (
    <div style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
      {rows.map((r) => (
        <div
          key={r.symbol}
          className="flex items-center gap-3 px-5 py-2.5"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}
        >
          <TokenIcon symbol={r.symbol} size={28} />
          <span className="text-[14px] font-medium text-text-primary flex-1">{r.symbol}</span>
          <span className="text-[14px] num text-text-secondary">{formatPrice(r.price)}</span>
        </div>
      ))}
    </div>
  );
}

// ---- Grid Cell ----

export const Cell = memo(function Cell({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-bg-card px-5 py-3">
      <div className="text-[11px] text-text-tertiary mb-0.5">{label}</div>
      <div className="num text-[15px] font-medium" style={{ color: color ?? "var(--color-text-primary)" }}>
        {value}
      </div>
    </div>
  );
});

// ---- Confidence Badge ----

export const ConfidenceBadge = memo(function ConfidenceBadge({ confidence }: { confidence: TradeConfidence }) {
  const cfg = {
    high: { c: "var(--color-accent-long)", l: "Verified", icon: "✓" },
    medium: { c: "var(--color-accent-warn)", l: "Med", icon: "●" },
    low: { c: "var(--color-accent-short)", l: "Low", icon: "●" },
  }[confidence.level];
  return (
    <div
      className="flex items-center gap-1.5 px-2.5 py-1 rounded-full"
      aria-label={`Trade confidence: ${cfg.l}`}
      style={{ background: `${cfg.c}12` }}
    >
      <span className="text-[10px] font-bold" style={{ color: cfg.c }}>
        {cfg.icon}
      </span>
      <span className="text-[11px] font-semibold" style={{ color: cfg.c }}>
        {cfg.l}
      </span>
    </div>
  );
});

// ---- Tool Error ----

export const ToolError = memo(function ToolError({
  toolName,
  error,
  onRetry,
}: {
  toolName: string;
  error?: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="w-full max-w-[420px] glass-card px-4 py-3 overflow-hidden"
      style={{ borderColor: "rgba(239,68,68,0.2)" }}
    >
      <div className="flex items-center gap-2.5 mb-2">
        <span className="text-[13px] text-accent-short">✕</span>
        <span className="text-[13px] text-text-secondary">{error ?? `${toolName} failed`}</span>
      </div>
      {onRetry ? (
        <button onClick={onRetry} className="btn-secondary text-[12px] text-accent-blue cursor-pointer">
          Retry
        </button>
      ) : (
        <span className="text-[12px] text-text-tertiary">Try again</span>
      )}
    </div>
  );
});

// ---- Generic Card (fallback for unknown tools) ----

export const GenericCard = memo(function GenericCard({
  toolName,
  output,
}: {
  toolName: string;
  output: { status: string; error?: string };
}) {
  return (
    <div className="text-[13px] text-text-secondary py-1.5">
      {toolName}: {output.status === "success" ? "Done" : (output.error ?? "Error")}
    </div>
  );
});
