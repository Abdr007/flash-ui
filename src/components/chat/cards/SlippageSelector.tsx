"use client";

// ============================================
// Flash AI — Slippage Tolerance Selector
// Compact inline component for trade cards
// ============================================

import { memo, useState, useRef, useEffect } from "react";

const PRESETS = [
  { label: "0.5%", bps: 50 },
  { label: "0.8%", bps: 80 },
  { label: "1.0%", bps: 100 },
  { label: "2.0%", bps: 200 },
];

interface SlippageSelectorProps {
  /** Current slippage in basis points */
  valueBps: number;
  /** Called with new slippage in basis points */
  onChange: (bps: number) => void;
  /** Disable interaction (e.g. while submitting) */
  disabled?: boolean;
}

export const SlippageSelector = memo(function SlippageSelector({
  valueBps,
  onChange,
  disabled = false,
}: SlippageSelectorProps) {
  const [open, setOpen] = useState(false);
  const [customDraft, setCustomDraft] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const isPreset = PRESETS.some((p) => p.bps === valueBps);
  const displayPct = (valueBps / 100).toFixed(valueBps % 100 === 0 ? 1 : 2).replace(/\.?0+$/, "") + "%";

  // Collapsed view
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          if (!disabled) {
            setOpen(true);
            if (!isPreset) setCustomDraft((valueBps / 100).toString());
          }
        }}
        disabled={disabled}
        className="text-[12px] flex items-center gap-1.5 cursor-pointer disabled:cursor-default transition-colors"
        style={{ color: "var(--color-text-tertiary)" }}
      >
        <span>Slippage:</span>
        <span className="num font-medium" style={{ color: "var(--color-accent-teal, #33c9a1)" }}>
          {displayPct}
        </span>
        <svg width="8" height="5" viewBox="0 0 8 5" fill="none" style={{ opacity: disabled ? 0.3 : 0.5 }}>
          <path d="M1 1L4 4L7 1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    );
  }

  // Expanded view
  function applyCustom() {
    const val = parseFloat(customDraft);
    if (!Number.isFinite(val) || val <= 0 || val > 5) return;
    const bps = Math.round(val * 100);
    onChange(bps);
    setOpen(false);
    setCustomDraft("");
  }

  return (
    <div ref={containerRef} className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-text-tertiary font-medium">Slippage Tolerance</span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-[10px] text-text-tertiary cursor-pointer hover:text-text-secondary"
          aria-label="Close slippage selector"
        >
          Done
        </button>
      </div>
      <div className="flex items-center gap-1.5">
        {PRESETS.map((p) => (
          <button
            key={p.bps}
            type="button"
            onClick={() => {
              onChange(p.bps);
              setOpen(false);
              setCustomDraft("");
            }}
            className="px-2.5 py-1 text-[11px] num font-medium rounded-md cursor-pointer transition-all"
            style={{
              background: valueBps === p.bps ? "rgba(51,201,161,0.15)" : "rgba(255,255,255,0.04)",
              color: valueBps === p.bps ? "var(--color-accent-teal, #33c9a1)" : "var(--color-text-tertiary)",
              border: valueBps === p.bps ? "1px solid rgba(51,201,161,0.3)" : "1px solid rgba(255,255,255,0.06)",
            }}
          >
            {p.label}
          </button>
        ))}
        <div
          className="flex items-center gap-0.5 px-2 py-1 rounded-md"
          style={{
            background: !isPreset ? "rgba(51,201,161,0.15)" : "rgba(255,255,255,0.04)",
            border: !isPreset ? "1px solid rgba(51,201,161,0.3)" : "1px solid rgba(255,255,255,0.06)",
          }}
        >
          <input
            ref={inputRef}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            placeholder="Custom"
            value={customDraft}
            onChange={(e) => setCustomDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") applyCustom();
            }}
            className="num text-[11px] font-medium bg-transparent outline-none w-[3.5rem] text-text-primary placeholder:text-text-tertiary"
            aria-label="Custom slippage percentage"
          />
          <span className="text-[10px] text-text-tertiary">%</span>
        </div>
      </div>
      {valueBps > 200 && (
        <div className="text-[10px]" style={{ color: "var(--color-accent-warn)" }}>
          High slippage may result in unfavorable execution
        </div>
      )}
    </div>
  );
});

export default SlippageSelector;
