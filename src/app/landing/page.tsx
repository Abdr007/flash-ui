"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";

// ---- Demo responses for interactive preview ----
const DEMO_TRADES: Record<string, { side: string; market: string; lev: string; entry: string; liq: string; size: string; fees: string }> = {
  "long sol": { side: "LONG", market: "SOL", lev: "5x", entry: "$148.32", liq: "$118.66", size: "$500", fees: "$0.40" },
  "long btc": { side: "LONG", market: "BTC", lev: "5x", entry: "$104,280", liq: "$83,424", size: "$500", fees: "$0.40" },
  "short eth": { side: "SHORT", market: "ETH", lev: "3x", entry: "$2,510", liq: "$3,347", size: "$300", fees: "$0.24" },
  "long sol 5x": { side: "LONG", market: "SOL", lev: "5x", entry: "$148.32", liq: "$118.66", size: "$500", fees: "$0.40" },
  "short btc 10x": { side: "SHORT", market: "BTC", lev: "10x", entry: "$104,280", liq: "$114,708", size: "$1,000", fees: "$0.80" },
};

function matchDemo(input: string) {
  const lower = input.toLowerCase().trim();
  for (const [key, val] of Object.entries(DEMO_TRADES)) {
    if (lower.includes(key)) return val;
  }
  return null;
}

export default function LandingPage() {
  const [demoInput, setDemoInput] = useState("");
  const [demoState, setDemoState] = useState<"idle" | "typing" | "card">("idle");
  const [demoTrade, setDemoTrade] = useState<typeof DEMO_TRADES["long sol"] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [scrollY, setScrollY] = useState(0);

  useEffect(() => {
    const onScroll = () => setScrollY(window.scrollY);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  function handleDemo() {
    const trade = matchDemo(demoInput);
    if (!trade) return;
    setDemoState("typing");
    setTimeout(() => {
      setDemoTrade(trade);
      setDemoState("card");
    }, 600);
  }

  const heroOpacity = Math.max(0, 1 - scrollY / 600);

  return (
    <div className="bg-bg-root text-text-primary min-h-screen overflow-x-hidden">

      {/* ======== HERO ======== */}
      <section className="relative h-screen flex flex-col items-center justify-center px-6 overflow-hidden">
        {/* Animated grid + brand glows */}
        <div className="absolute inset-0 dot-grid" style={{ opacity: 0.5 * heroOpacity }} />
        <div className="absolute inset-0" style={{
          background: `
            radial-gradient(ellipse 60% 50% at 50% 40%, rgba(51,201,161,0.1) 0%, transparent 70%),
            radial-gradient(ellipse 40% 30% at 60% 50%, rgba(58,255,225,0.06) 0%, transparent 60%)
          `,
          opacity: heroOpacity,
        }} />

        <div className="relative z-10 flex flex-col items-center max-w-2xl text-center"
          style={{ opacity: heroOpacity, transform: `translate3d(0, ${scrollY * 0.15}px, 0)` }}>

          {/* Badge */}
          <div className="flex items-center gap-2 px-4 py-1.5 rounded-full mb-8"
            style={{
              background: "rgba(51,201,161,0.08)",
              border: "1px solid rgba(51,201,161,0.2)",
              animation: "heroReveal 600ms cubic-bezier(0.2, 0, 0, 1) both",
            }}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--color-brand-teal)" }} />
            <span className="text-[12px] font-medium" style={{ color: "var(--color-brand-teal)" }}>Built on Flash Trade · Solana</span>
          </div>

          {/* Headline */}
          <h1 className="text-[48px] md:text-[64px] font-bold tracking-tight leading-[1.05] mb-6"
            style={{ animation: "heroReveal 700ms cubic-bezier(0.2, 0, 0, 1) 100ms both" }}>
            Type a trade.
            <br />
            <span className="text-gradient-brand">It executes.</span>
          </h1>

          <p className="text-[18px] text-text-secondary leading-relaxed mb-10 max-w-lg"
            style={{ animation: "heroReveal 700ms cubic-bezier(0.2, 0, 0, 1) 200ms both" }}>
            The first AI trading terminal for Solana perpetuals. No dashboards. No complexity. Just type what you want.
          </p>

          {/* Interactive demo input */}
          <div className="w-full max-w-md"
            style={{ animation: "heroReveal 700ms cubic-bezier(0.2, 0, 0, 1) 300ms both" }}>
            <div className="relative glass-card overflow-hidden input-glow">
              <input
                ref={inputRef}
                type="text"
                value={demoInput}
                onChange={(e) => { setDemoInput(e.target.value); setDemoState("idle"); setDemoTrade(null); }}
                onKeyDown={(e) => { if (e.key === "Enter") handleDemo(); }}
                placeholder="Try: long SOL 5x $100"
                className="w-full bg-transparent text-[16px] text-text-primary px-5 py-4 outline-none placeholder:text-text-tertiary"
              />
              <button
                onClick={handleDemo}
                disabled={!matchDemo(demoInput)}
                className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-lg flex items-center justify-center
                  transition-all duration-200 disabled:opacity-20 cursor-pointer"
                style={{
                  background: matchDemo(demoInput) ? "var(--color-accent-lime)" : "rgba(255,255,255,0.06)",
                  boxShadow: matchDemo(demoInput) ? "0 0 16px rgba(200,245,71,0.3)" : "none",
                  transform: matchDemo(demoInput) ? "translateY(-50%) scale(1)" : "translateY(-50%) scale(0.95)",
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={matchDemo(demoInput) ? "#0A0E13" : "var(--color-text-tertiary)"} strokeWidth="2.5" strokeLinecap="round">
                  <line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" />
                </svg>
              </button>
            </div>

            {/* Demo response */}
            {demoState === "typing" && (
              <div className="mt-4 flex items-center gap-2 px-2" style={{ animation: "fadeIn 150ms ease-out" }}>
                <div className="w-6 h-6 rounded-full flex items-center justify-center" style={{ background: "rgba(51,201,161,0.1)" }}>
                  <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M3 12L8 3L13 12H3Z" fill="var(--color-brand-teal)" /></svg>
                </div>
                <div className="flex gap-1">
                  <span className="typing-dot" style={{ animationDelay: "-0.3s" }} />
                  <span className="typing-dot" style={{ animationDelay: "-0.15s" }} />
                  <span className="typing-dot" style={{ animationDelay: "0s" }} />
                </div>
              </div>
            )}

            {demoState === "card" && demoTrade && (
              <div className={`mt-4 overflow-hidden ${demoTrade.side === "LONG" ? "trade-card-long" : "trade-card-short"}`}
                style={{ animation: "cardIn 200ms cubic-bezier(0.2, 0, 0, 1) both", borderRadius: "var(--radius-card)" }}>
                <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full" style={{ background: demoTrade.side === "LONG" ? "var(--color-accent-long)" : "var(--color-accent-short)" }} />
                    <span className="text-[15px] font-bold">{demoTrade.market}-PERP</span>
                    <span className="text-[11px] font-bold px-2 py-0.5 rounded-full"
                      style={{ color: demoTrade.side === "LONG" ? "var(--color-accent-long)" : "var(--color-accent-short)",
                        background: demoTrade.side === "LONG" ? "rgba(0,210,106,0.12)" : "rgba(255,77,77,0.12)" }}>
                      {demoTrade.side}
                    </span>
                  </div>
                  <span className="text-[11px] font-semibold" style={{ color: "var(--color-brand-teal)" }}>✓ Verified</span>
                </div>
                <div className="grid grid-cols-2 text-[13px]">
                  <div className="px-4 py-2.5 border-b border-r border-border-subtle">
                    <div className="text-[10px] text-text-tertiary">Entry</div>
                    <div className="num font-semibold text-[16px]">{demoTrade.entry}</div>
                  </div>
                  <div className="px-4 py-2.5 border-b border-border-subtle">
                    <div className="text-[10px] text-text-tertiary">Liquidation</div>
                    <div className="num font-semibold text-[16px]" style={{ color: "var(--color-accent-warn)" }}>{demoTrade.liq}</div>
                  </div>
                  <div className="px-4 py-2.5 border-r border-border-subtle">
                    <div className="text-[10px] text-text-tertiary">Size</div>
                    <div className="num">{demoTrade.size}</div>
                  </div>
                  <div className="px-4 py-2.5">
                    <div className="text-[10px] text-text-tertiary">Leverage</div>
                    <div className="num">{demoTrade.lev}</div>
                  </div>
                </div>
                <div className="flex border-t border-border-subtle">
                  <Link href="/"
                    className="btn-cta flex-1 py-3 text-center text-[13px] font-bold"
                    style={{ borderRadius: "0 0 16px 16px" }}>
                    Open Flash Terminal →
                  </Link>
                </div>
              </div>
            )}
          </div>

          {/* CTAs */}
          <div className="flex items-center gap-4 mt-8"
            style={{ animation: "heroReveal 700ms cubic-bezier(0.2, 0, 0, 1) 400ms both" }}>
            <Link href="/" className="btn-cta px-8 py-3.5 text-[15px] font-bold">
              Start Trading
            </Link>
            <Link href="https://docs.flash.trade" target="_blank"
              className="btn-ghost px-8 py-3.5 text-[15px] font-medium">
              View Docs
            </Link>
          </div>
        </div>

        {/* Scroll hint */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2" style={{ opacity: heroOpacity }}>
          <div className="w-6 h-10 rounded-full flex items-start justify-center pt-2"
            style={{ border: "2px solid rgba(51,201,161,0.2)" }}>
            <div className="w-1 h-2 rounded-full" style={{ background: "var(--color-brand-teal)", animation: "typingBounce 2s ease-in-out infinite" }} />
          </div>
        </div>
      </section>

      {/* ======== SPEED ======== */}
      <section className="py-24 px-6">
        <div className="max-w-3xl mx-auto text-center">
          <div className="text-[11px] font-bold tracking-[0.25em] uppercase mb-4" style={{ color: "var(--color-brand-teal)" }}>SPEED</div>
          <h2 className="text-[36px] md:text-[44px] font-bold tracking-tight mb-6">Execution in milliseconds</h2>
          <p className="text-[16px] text-text-secondary mb-12">Common commands execute in under 5ms. Deterministic parsing, cached prices, instant preview.</p>

          {/* Timeline in glass card */}
          <div className="glass-card px-8 py-6 max-w-lg mx-auto">
            <div className="flex items-center justify-between relative">
              {/* Connecting line */}
              <div className="absolute top-[6px] left-[12px] right-[12px] h-px" style={{ background: "linear-gradient(90deg, var(--color-brand-teal), var(--color-brand-cyan), var(--color-accent-lime))", opacity: 0.3 }} />
              {[
                { t: "0ms", label: "Parse", color: "var(--color-brand-teal)" },
                { t: "1ms", label: "Validate", color: "var(--color-brand-cyan)" },
                { t: "3ms", label: "Preview", color: "var(--color-accent-long)" },
                { t: "5ms", label: "Ready", color: "var(--color-accent-lime)" },
              ].map((step, i) => (
                <div key={i} className="flex flex-col items-center relative z-10">
                  <div className="w-3 h-3 rounded-full mb-3" style={{
                    background: step.color,
                    boxShadow: `0 0 12px ${step.color}40`,
                    animation: `glowPulse 3s ease-in-out infinite ${i * 0.5}s`,
                  }} />
                  <div className="text-[14px] num font-bold" style={{ color: step.color }}>{step.t}</div>
                  <div className="text-[11px] text-text-tertiary mt-1">{step.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ======== SAFETY ======== */}
      <section className="py-24 px-6 relative">
        <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse 80% 60% at 50% 50%, rgba(51,201,161,0.03) 0%, transparent 70%)" }} />
        <div className="max-w-3xl mx-auto text-center relative z-10">
          <div className="text-[11px] font-bold tracking-[0.25em] uppercase mb-4" style={{ color: "var(--color-brand-cyan)" }}>SAFETY</div>
          <h2 className="text-[36px] md:text-[44px] font-bold tracking-tight mb-6">Every trade is verified</h2>
          <p className="text-[16px] text-text-secondary mb-12">6-layer validation. Simulation before signing. Your wallet never signs a doomed transaction.</p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-left">
            {[
              { icon: "🎯", title: "Deterministic Parser", desc: "Regex-based compiler. No AI guessing on critical paths." },
              { icon: "🛡️", title: "Pre-Sign Simulation", desc: "Every transaction simulated on-chain before your wallet sees it." },
              { icon: "🔒", title: "6-Layer Firewall", desc: "Zod schemas, direction rules, leverage caps, wallet auth, and more." },
            ].map((item, i) => (
              <div key={i} className="glass-card px-5 py-5 transition-all duration-200 hover:-translate-y-1"
                style={{ cursor: "default" }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "rgba(51,201,161,0.15)";
                  e.currentTarget.style.boxShadow = "0 12px 40px -8px rgba(0,0,0,0.4), 0 0 20px -4px rgba(51,201,161,0.1)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "rgba(51,201,161,0.06)";
                  e.currentTarget.style.boxShadow = "0 8px 32px -8px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.04)";
                }}>
                <div className="text-[24px] mb-3">{item.icon}</div>
                <div className="text-[15px] font-semibold mb-2">{item.title}</div>
                <div className="text-[13px] text-text-tertiary leading-relaxed">{item.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ======== SIMPLICITY ======== */}
      <section className="py-24 px-6">
        <div className="max-w-3xl mx-auto text-center">
          <div className="text-[11px] font-bold tracking-[0.25em] uppercase mb-4" style={{ color: "var(--color-accent-long)" }}>SIMPLICITY</div>
          <h2 className="text-[36px] md:text-[44px] font-bold tracking-tight mb-6">No dashboards. No complexity.</h2>
          <p className="text-[16px] text-text-secondary mb-12">Just type what you want. The AI handles the rest.</p>

          <div className="flex flex-col gap-3 max-w-sm mx-auto text-left">
            {[
              { cmd: "long SOL 5x $100", desc: "Open a leveraged long" },
              { cmd: "close SOL", desc: "Close your position" },
              { cmd: "deposit $50 to crypto", desc: "Earn yield from trading fees" },
              { cmd: "show portfolio", desc: "See all your positions" },
            ].map((ex, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-3 rounded-xl transition-all duration-200 group"
                style={{ background: "rgba(14,19,28,0.65)", border: "1px solid rgba(51,201,161,0.04)" }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "rgba(51,201,161,0.15)";
                  e.currentTarget.style.borderLeft = "2px solid var(--color-brand-teal)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "rgba(51,201,161,0.04)";
                  e.currentTarget.style.borderLeft = "1px solid rgba(51,201,161,0.04)";
                }}>
                <code className="text-[13px] num text-gradient-brand flex-1 font-medium">{ex.cmd}</code>
                <span className="text-[12px] text-text-tertiary">{ex.desc}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ======== FINAL CTA ======== */}
      <section className="py-32 px-6 text-center relative">
        <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse 80% 60% at 50% 50%, rgba(51,201,161,0.05) 0%, transparent 70%)" }} />
        <div className="relative z-10">
          <h2 className="text-[36px] md:text-[48px] font-bold tracking-tight mb-4">
            Start typing your <span className="text-gradient-brand">first trade</span>
          </h2>
          <p className="text-[16px] text-text-secondary mb-10">No signup. Connect wallet. Trade.</p>
          <div className="flex items-center justify-center gap-4">
            <Link href="/" className="btn-cta px-10 py-4 text-[16px] font-bold">
              Open Flash Terminal
            </Link>
            <Link href="https://docs.flash.trade" target="_blank"
              className="btn-ghost px-10 py-4 text-[16px] font-medium">
              View Docs
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 px-6 text-center relative">
        <div className="absolute top-0 left-1/4 right-1/4 h-px" style={{ background: "linear-gradient(90deg, transparent, rgba(51,201,161,0.2), transparent)" }} />
        <div className="text-[12px] text-text-tertiary">
          Built on <a href="https://flash.trade" target="_blank" rel="noopener" className="text-text-secondary hover:text-brand-teal transition-colors">Flash Trade</a> · Powered by <a href="https://solana.com" target="_blank" rel="noopener" className="text-text-secondary hover:text-brand-cyan transition-colors">Solana</a>
        </div>
      </footer>
    </div>
  );
}
