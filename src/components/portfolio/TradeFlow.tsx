"use client";

import { useState } from "react";
import { MARKETS } from "@/lib/constants";
import { useFlashStore } from "@/store";
import { formatPrice } from "@/lib/format";

interface TradeFlowProps {
  side: "LONG" | "SHORT";
  onComplete: (command: string) => void;
  onCancel: () => void;
}

const POPULAR_MARKETS = ["SOL", "BTC", "ETH", "JUP", "BONK", "WIF"];
const LEVERAGE_OPTIONS = [2, 3, 5, 10, 20, 50];
const COLLATERAL_OPTIONS = [10, 25, 50, 100, 250, 500];

type Step = "market" | "leverage" | "collateral";

export default function TradeFlow({ side, onComplete, onCancel }: TradeFlowProps) {
  const [step, setStep] = useState<Step>("market");
  const [market, setMarket] = useState("");
  const [leverage, setLeverage] = useState(0);
  const [tpInput, setTpInput] = useState("");
  const [slInput, setSlInput] = useState("");
  const prices = useFlashStore((s) => s.prices);

  const accent = side === "LONG" ? "var(--color-accent-long)" : "var(--color-accent-short)";
  const accentBg = side === "LONG" ? "rgba(16,185,129,0.08)" : "rgba(239,68,68,0.08)";
  const accentBorder = side === "LONG" ? "rgba(16,185,129,0.25)" : "rgba(239,68,68,0.25)";

  function selectMarket(m: string) {
    setMarket(m);
    setStep("leverage");
  }

  function selectLeverage(l: number) {
    setLeverage(l);
    setStep("collateral");
  }

  function selectCollateral(c: number) {
    let cmd = `${side.toLowerCase()} ${market} ${leverage}x $${c}`;
    const tp = parseFloat(tpInput);
    const sl = parseFloat(slInput);
    if (Number.isFinite(tp) && tp > 0) cmd += ` tp ${tp}`;
    if (Number.isFinite(sl) && sl > 0) cmd += ` sl ${sl}`;
    onComplete(cmd);
  }

  function goBack() {
    if (step === "leverage") setStep("market");
    else if (step === "collateral") setStep("leverage");
    else onCancel();
  }

  return (
    <div className="w-full max-w-[480px] mx-auto" style={{ animation: "fadeIn 200ms ease-out" }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <button onClick={goBack} className="text-[12px] text-text-tertiary hover:text-text-secondary cursor-pointer">
          ← Back
        </button>
        <div className="flex items-center gap-2">
          <span className="text-[11px] tracking-wider uppercase" style={{ color: accent }}>
            {side}
          </span>
          {market && <span className="text-[12px] text-text-secondary font-medium">{market}</span>}
          {leverage > 0 && <span className="text-[12px] text-text-tertiary">{leverage}x</span>}
        </div>
        <button onClick={onCancel} className="text-[12px] text-text-tertiary hover:text-text-secondary cursor-pointer">
          Cancel
        </button>
      </div>

      {/* Progress dots */}
      <div className="flex items-center justify-center gap-2 mb-6">
        {(["market", "leverage", "collateral"] as Step[]).map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <div
              className="w-2 h-2 rounded-full transition-all"
              style={{
                background:
                  step === s
                    ? accent
                    : i < ["market", "leverage", "collateral"].indexOf(step)
                      ? accent
                      : "rgba(255,255,255,0.1)",
                boxShadow: step === s ? `0 0 8px ${accent}` : "none",
              }}
            />
            {i < 2 && <div className="w-8 h-px" style={{ background: "rgba(255,255,255,0.06)" }} />}
          </div>
        ))}
      </div>

      {/* Step: Market Selection */}
      {step === "market" && (
        <div style={{ animation: "fadeIn 200ms ease-out" }}>
          <div className="text-[14px] text-text-secondary text-center mb-4">Select Market</div>
          <div className="grid grid-cols-3 gap-2">
            {POPULAR_MARKETS.map((m) => {
              const p = prices[m];
              const dotColor = MARKETS[m]?.dotColor ?? "#555";
              return (
                <button
                  key={m}
                  onClick={() => selectMarket(m)}
                  className="glass-card px-4 py-3.5 flex flex-col items-center gap-1.5 cursor-pointer transition-all hover:scale-[1.03]"
                  style={{ border: `1px solid rgba(255,255,255,0.06)` }}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full" style={{ background: dotColor }} />
                    <span className="text-[14px] font-semibold text-text-primary">{m}</span>
                  </div>
                  {p && <span className="text-[12px] num text-text-tertiary">{formatPrice(p.price)}</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Step: Leverage */}
      {step === "leverage" && (
        <div style={{ animation: "fadeIn 200ms ease-out" }}>
          <div className="text-[14px] text-text-secondary text-center mb-4">Select Leverage</div>
          <div className="grid grid-cols-3 gap-2">
            {LEVERAGE_OPTIONS.map((l) => (
              <button
                key={l}
                onClick={() => selectLeverage(l)}
                className="glass-card px-4 py-4 flex items-center justify-center cursor-pointer transition-all hover:scale-[1.03]"
                style={{ border: `1px solid rgba(255,255,255,0.06)` }}
              >
                <span
                  className="text-[18px] font-bold num"
                  style={{ color: l >= 20 ? "var(--color-accent-warn)" : "var(--color-text-primary)" }}
                >
                  {l}x
                </span>
              </button>
            ))}
          </div>
          {/* Custom input */}
          <div className="mt-3 flex items-center justify-center">
            <input
              type="number"
              min={1}
              max={100}
              placeholder="Custom..."
              className="w-32 text-center text-[14px] num bg-transparent border rounded-lg px-3 py-2 text-text-primary outline-none"
              style={{ borderColor: "rgba(255,255,255,0.1)" }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const v = parseInt((e.target as HTMLInputElement).value);
                  if (v >= 1 && v <= 100) selectLeverage(v);
                }
              }}
            />
          </div>
        </div>
      )}

      {/* Step: Collateral */}
      {step === "collateral" && (
        <div style={{ animation: "fadeIn 200ms ease-out" }}>
          <div className="text-[14px] text-text-secondary text-center mb-1">Collateral (USDC)</div>
          <div className="text-[12px] text-text-tertiary text-center mb-4">
            Position size: collateral × {leverage}x leverage
          </div>
          <div className="grid grid-cols-3 gap-2">
            {COLLATERAL_OPTIONS.map((c) => (
              <button
                key={c}
                onClick={() => selectCollateral(c)}
                className="glass-card px-4 py-4 flex flex-col items-center gap-1 cursor-pointer transition-all hover:scale-[1.03]"
                style={{ border: `1px solid rgba(255,255,255,0.06)` }}
              >
                <span className="text-[16px] font-bold num text-text-primary">${c}</span>
                <span className="text-[11px] num text-text-tertiary">{`$${(c * leverage).toLocaleString()} size`}</span>
              </button>
            ))}
          </div>
          {/* Custom input */}
          <div className="mt-3 flex items-center justify-center">
            <input
              type="number"
              min={10}
              placeholder="Custom $..."
              className="w-32 text-center text-[14px] num bg-transparent border rounded-lg px-3 py-2 text-text-primary outline-none"
              style={{ borderColor: "rgba(255,255,255,0.1)" }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const v = parseInt((e.target as HTMLInputElement).value);
                  if (v >= 10) selectCollateral(v);
                }
              }}
            />
          </div>

          {/* TP/SL inputs (optional) */}
          <div className="mt-4 flex items-center gap-3 justify-center">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-bold tracking-wider" style={{ color: "var(--color-accent-long)" }}>
                TP
              </span>
              <input
                type="number"
                min={0}
                step="any"
                placeholder="—"
                value={tpInput}
                onChange={(e) => setTpInput(e.target.value)}
                className="w-24 text-center text-[13px] num bg-transparent border rounded-lg px-2 py-1.5 text-text-primary outline-none"
                style={{ borderColor: tpInput ? "rgba(16,185,129,0.3)" : "rgba(255,255,255,0.08)" }}
              />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-bold tracking-wider" style={{ color: "var(--color-accent-short)" }}>
                SL
              </span>
              <input
                type="number"
                min={0}
                step="any"
                placeholder="—"
                value={slInput}
                onChange={(e) => setSlInput(e.target.value)}
                className="w-24 text-center text-[13px] num bg-transparent border rounded-lg px-2 py-1.5 text-text-primary outline-none"
                style={{ borderColor: slInput ? "rgba(239,68,68,0.3)" : "rgba(255,255,255,0.08)" }}
              />
            </div>
          </div>
          <div className="text-[11px] text-text-tertiary text-center mt-1.5">Optional — leave blank for none</div>

          {/* Summary */}
          <div
            className="mt-3 px-4 py-3 rounded-xl flex items-center justify-between text-[12px]"
            style={{ background: accentBg, border: `1px solid ${accentBorder}` }}
          >
            <span style={{ color: accent }}>
              {side} {market} {leverage}x
            </span>
            <span className="text-text-tertiary">Select amount to execute</span>
          </div>
        </div>
      )}
    </div>
  );
}
