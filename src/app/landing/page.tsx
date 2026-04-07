"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";

// ---- Fake demo responses ----
const DEMO_TRADES: Record<string, { side: string; market: string; lev: string; entry: string; liq: string; size: string; fees: string }> = {
  "long sol": { side: "LONG", market: "SOL", lev: "5x", entry: "$82.15", liq: "$65.72", size: "$500", fees: "$0.40" },
  "long btc": { side: "LONG", market: "BTC", lev: "5x", entry: "$65,420", liq: "$52,336", size: "$500", fees: "$0.40" },
  "short eth": { side: "SHORT", market: "ETH", lev: "3x", entry: "$3,210", liq: "$4,280", size: "$300", fees: "$0.24" },
  "long sol 5x": { side: "LONG", market: "SOL", lev: "5x", entry: "$82.15", liq: "$65.72", size: "$500", fees: "$0.40" },
  "short btc 10x": { side: "SHORT", market: "BTC", lev: "10x", entry: "$65,420", liq: "$71,962", size: "$1,000", fees: "$0.80" },
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

      {/* ======== HERO: Full-screen immersive ======== */}
      <section className="relative h-screen flex flex-col items-center justify-center px-6 overflow-hidden">
        {/* Animated grid background */}
        <div className="absolute inset-0 dot-grid" style={{ opacity: 0.5 * heroOpacity }} />
        <div className="absolute inset-0" style={{
          background: "radial-gradient(ellipse 60% 50% at 50% 40%, rgba(59,130,246,0.08) 0%, transparent 70%)",
          opacity: heroOpacity,
        }} />

        <div className="relative z-10 flex flex-col items-center max-w-2xl text-center" style={{ opacity: heroOpacity, transform: `translate3d(0, ${scrollY * 0.15}px, 0)` }}>
          {/* Badge */}
          <div className="flex items-center gap-2 px-4 py-1.5 rounded-full mb-8"
            style={{ background: "rgba(200,245,71,0.06)", border: "1px solid rgba(200,245,71,0.15)" }}>
            <span className="w-1.5 h-1.5 rounded-full bg-accent-lime" />
            <span className="text-[12px] font-medium" style={{ color: "var(--color-accent-lime)" }}>Built on Flash Trade · Solana</span>
          </div>

          {/* Headline */}
          <h1 className="text-[48px] md:text-[64px] font-bold tracking-tight leading-[1.05] mb-6">
            Type a trade.
            <br />
            <span style={{ color: "var(--color-accent-lime)" }}>It executes.</span>
          </h1>

          <p className="text-[18px] text-text-secondary leading-relaxed mb-10 max-w-lg">
            The first AI trading terminal for Solana perpetuals. No dashboards. No complexity. Just type what you want.
          </p>

          {/* Interactive demo input */}
          <div className="w-full max-w-md">
            <div className="relative rounded-xl overflow-hidden"
              style={{ background: "var(--color-bg-card)", border: "1px solid rgba(255,255,255,0.08)" }}>
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
                  transition-all duration-100 disabled:opacity-20 cursor-pointer hover:scale-110 active:scale-95"
                style={{ background: matchDemo(demoInput) ? "var(--color-accent-lime)" : "rgba(255,255,255,0.06)" }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={matchDemo(demoInput) ? "#0A0E13" : "var(--color-text-tertiary)"} strokeWidth="2.5" strokeLinecap="round">
                  <line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" />
                </svg>
              </button>
            </div>

            {/* Demo response */}
            {demoState === "typing" && (
              <div className="mt-4 flex items-center gap-2 px-2" style={{ animation: "fadeIn 150ms ease-out" }}>
                <div className="w-6 h-6 rounded-full flex items-center justify-center" style={{ background: "var(--color-bg-card)" }}>
                  <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M3 12L8 3L13 12H3Z" fill="var(--color-accent-blue)" /></svg>
                </div>
                <div className="flex gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-text-tertiary" style={{ animation: "typingBounce 1.2s ease-in-out infinite -0.3s" }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-text-tertiary" style={{ animation: "typingBounce 1.2s ease-in-out infinite -0.15s" }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-text-tertiary" style={{ animation: "typingBounce 1.2s ease-in-out infinite 0s" }} />
                </div>
              </div>
            )}

            {demoState === "card" && demoTrade && (
              <div className="mt-4 glass-card overflow-hidden" style={{ animation: "cardIn 150ms cubic-bezier(0.2, 0, 0, 1) both" }}>
                <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full" style={{ background: demoTrade.side === "LONG" ? "var(--color-accent-long)" : "var(--color-accent-short)" }} />
                    <span className="text-[15px] font-bold">{demoTrade.market}-PERP</span>
                    <span className="text-[11px] font-bold px-2 py-0.5 rounded-full"
                      style={{ color: demoTrade.side === "LONG" ? "var(--color-accent-long)" : "var(--color-accent-short)",
                        background: demoTrade.side === "LONG" ? "rgba(16,185,129,0.12)" : "rgba(239,68,68,0.12)" }}>
                      {demoTrade.side}
                    </span>
                  </div>
                  <span className="text-[11px] font-semibold" style={{ color: "var(--color-accent-long)" }}>✓ Verified</span>
                </div>
                <div className="grid grid-cols-2 text-[13px]">
                  <div className="px-4 py-2.5 border-b border-r border-border-subtle">
                    <div className="text-[10px] text-text-tertiary">Entry</div>
                    <div className="num font-semibold">{demoTrade.entry}</div>
                  </div>
                  <div className="px-4 py-2.5 border-b border-border-subtle">
                    <div className="text-[10px] text-text-tertiary">Liquidation</div>
                    <div className="num font-semibold" style={{ color: "var(--color-accent-warn)" }}>{demoTrade.liq}</div>
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
                    className="flex-1 py-3 text-center text-[13px] font-bold cursor-pointer hover:brightness-110 active:scale-[0.98] transition-all"
                    style={{ color: "#000", background: "var(--color-accent-lime)", borderRadius: "0 0 0 16px" }}>
                    Open Flash →
                  </Link>
                </div>
              </div>
            )}
          </div>

          {/* CTAs */}
          <div className="flex items-center gap-4 mt-8">
            <Link href="/"
              className="px-8 py-3.5 rounded-xl text-[15px] font-bold cursor-pointer transition-all hover:scale-105 active:scale-95"
              style={{ background: "var(--color-accent-lime)", color: "#0A0E13" }}>
              Start Trading
            </Link>
            <Link href="https://docs.flash.trade" target="_blank"
              className="px-8 py-3.5 rounded-xl text-[15px] font-medium cursor-pointer transition-all hover:scale-105 active:scale-95"
              style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)", color: "var(--color-text-secondary)" }}>
              View Docs
            </Link>
          </div>
        </div>

        {/* Scroll hint */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2" style={{ opacity: heroOpacity }}>
          <div className="w-6 h-10 rounded-full border-2 border-text-tertiary flex items-start justify-center pt-2">
            <div className="w-1 h-2 rounded-full bg-text-tertiary" style={{ animation: "typingBounce 2s ease-in-out infinite" }} />
          </div>
        </div>
      </section>

      {/* ======== SECTION: Speed ======== */}
      <section className="py-24 px-6">
        <div className="max-w-3xl mx-auto text-center">
          <div className="text-[11px] font-bold tracking-[0.2em] uppercase mb-4" style={{ color: "var(--color-accent-lime)" }}>SPEED</div>
          <h2 className="text-[36px] md:text-[44px] font-bold tracking-tight mb-6">Execution in milliseconds</h2>
          <p className="text-[16px] text-text-secondary mb-12">Common commands execute in under 5ms. No AI needed. Deterministic parsing, cached prices, instant preview.</p>

          {/* Timeline */}
          <div className="flex items-center justify-center gap-0 max-w-lg mx-auto">
            {[
              { t: "0ms", label: "Parse", color: "var(--color-accent-lime)" },
              { t: "1ms", label: "Validate", color: "var(--color-accent-blue)" },
              { t: "3ms", label: "Preview", color: "var(--color-accent-long)" },
              { t: "5ms", label: "Ready", color: "var(--color-accent-lime)" },
            ].map((step, i) => (
              <div key={i} className="flex-1 flex flex-col items-center">
                <div className="w-3 h-3 rounded-full mb-2" style={{ background: step.color }} />
                <div className="text-[13px] num font-bold" style={{ color: step.color }}>{step.t}</div>
                <div className="text-[11px] text-text-tertiary mt-1">{step.label}</div>
                {i < 3 && <div className="absolute" />}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ======== SECTION: Safety ======== */}
      <section className="py-24 px-6" style={{ background: "rgba(255,255,255,0.01)" }}>
        <div className="max-w-3xl mx-auto text-center">
          <div className="text-[11px] font-bold tracking-[0.2em] uppercase mb-4" style={{ color: "var(--color-accent-blue)" }}>SAFETY</div>
          <h2 className="text-[36px] md:text-[44px] font-bold tracking-tight mb-6">Every trade is verified</h2>
          <p className="text-[16px] text-text-secondary mb-12">3-layer validation. Simulation before signing. Your wallet never signs a doomed transaction.</p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-left">
            {[
              { icon: "🎯", title: "Deterministic Parser", desc: "Regex-based compiler. No AI guessing on critical paths." },
              { icon: "🛡️", title: "Pre-Sign Simulation", desc: "Every transaction simulated on-chain before your wallet sees it." },
              { icon: "🔒", title: "Firewall Validation", desc: "Zod schema + direction rules + dynamic range checks." },
            ].map((item, i) => (
              <div key={i} className="glass-card px-5 py-5">
                <div className="text-[20px] mb-3">{item.icon}</div>
                <div className="text-[15px] font-semibold mb-1">{item.title}</div>
                <div className="text-[13px] text-text-tertiary leading-relaxed">{item.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ======== SECTION: Simplicity ======== */}
      <section className="py-24 px-6">
        <div className="max-w-3xl mx-auto text-center">
          <div className="text-[11px] font-bold tracking-[0.2em] uppercase mb-4" style={{ color: "var(--color-accent-long)" }}>SIMPLICITY</div>
          <h2 className="text-[36px] md:text-[44px] font-bold tracking-tight mb-6">No dashboards. No complexity.</h2>
          <p className="text-[16px] text-text-secondary mb-12">Just type what you want. The AI handles the rest.</p>

          <div className="flex flex-col gap-3 max-w-sm mx-auto text-left">
            {[
              { cmd: "long SOL 5x $100", desc: "Open a leveraged long" },
              { cmd: "close SOL", desc: "Close your position" },
              { cmd: "deposit $50 to crypto", desc: "Earn yield from trading fees" },
              { cmd: "show portfolio", desc: "See all your positions" },
            ].map((ex, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-3 rounded-xl"
                style={{ background: "var(--color-bg-card)", border: "1px solid rgba(255,255,255,0.04)" }}>
                <code className="text-[13px] num text-accent-lime flex-1">{ex.cmd}</code>
                <span className="text-[12px] text-text-tertiary">{ex.desc}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ======== FINAL CTA ======== */}
      <section className="py-32 px-6 text-center">
        <h2 className="text-[36px] md:text-[48px] font-bold tracking-tight mb-4">
          Start typing your first trade
        </h2>
        <p className="text-[16px] text-text-secondary mb-10">No signup. Connect wallet. Trade.</p>
        <div className="flex items-center justify-center gap-4">
          <Link href="/"
            className="px-10 py-4 rounded-xl text-[16px] font-bold cursor-pointer transition-all hover:scale-105 active:scale-95"
            style={{ background: "var(--color-accent-lime)", color: "#0A0E13" }}>
            Open Flash
          </Link>
          <Link href="https://docs.flash.trade" target="_blank"
            className="px-10 py-4 rounded-xl text-[16px] font-medium cursor-pointer transition-all hover:scale-105 active:scale-95"
            style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)" }}>
            View Docs
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 px-6 text-center border-t" style={{ borderColor: "rgba(255,255,255,0.04)" }}>
        <div className="text-[12px] text-text-tertiary">
          Built on <a href="https://flash.trade" target="_blank" rel="noopener" className="text-text-secondary hover:text-text-primary">Flash Trade</a> · Powered by <a href="https://solana.com" target="_blank" rel="noopener" className="text-text-secondary hover:text-text-primary">Solana</a>
        </div>
      </footer>
    </div>
  );
}
