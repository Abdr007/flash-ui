"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

export default function LandingPage() {
  const [scrollY, setScrollY] = useState(0);

  useEffect(() => {
    const onScroll = () => setScrollY(window.scrollY);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const heroOpacity = Math.max(0, 1 - scrollY / 600);

  return (
    <div className="bg-bg-root text-text-primary min-h-screen overflow-x-hidden" style={{ overflowY: "auto" }}>

      {/* ══════════ HERO ══════════ */}
      <section className="relative min-h-screen flex flex-col items-center justify-center px-6 py-20 overflow-hidden">
        {/* Background */}
        <div className="absolute inset-0 dot-grid" style={{ opacity: 0.4 * heroOpacity }} />
        <div className="absolute inset-0" style={{
          background: `
            radial-gradient(ellipse 70% 50% at 50% 30%, rgba(51,201,161,0.12) 0%, transparent 70%),
            radial-gradient(ellipse 50% 40% at 55% 50%, rgba(58,255,225,0.05) 0%, transparent 60%)
          `,
          opacity: heroOpacity,
        }} />

        <div className="relative z-10 flex flex-col items-center w-full max-w-4xl text-center"
          style={{ opacity: heroOpacity, transform: `translate3d(0, ${scrollY * 0.1}px, 0)` }}>

          {/* Badge */}
          <div className="flex items-center gap-2.5 px-5 py-2 rounded-full mb-12"
            style={{
              background: "rgba(51,201,161,0.08)",
              border: "1px solid rgba(51,201,161,0.2)",
              animation: "heroReveal 600ms cubic-bezier(0.2, 0, 0, 1) both",
            }}>
            <span className="w-2 h-2 rounded-full" style={{ background: "var(--color-brand-teal)", boxShadow: "0 0 8px rgba(51,201,161,0.5)" }} />
            <span className="text-[13px] font-medium tracking-wide" style={{ color: "var(--color-brand-teal)" }}>Built on Flash Trade · Solana</span>
          </div>

          {/* Headline */}
          <h1 className="text-[52px] sm:text-[68px] md:text-[84px] lg:text-[96px] font-bold tracking-[-0.03em] leading-[1] mb-8"
            style={{ animation: "heroReveal 700ms cubic-bezier(0.2, 0, 0, 1) 100ms both" }}>
            Type a trade.
            <br />
            <span className="text-gradient-brand">It executes.</span>
          </h1>

          {/* Subtitle */}
          <p className="text-[18px] sm:text-[20px] text-text-secondary leading-relaxed mb-16 max-w-2xl px-4"
            style={{ animation: "heroReveal 700ms cubic-bezier(0.2, 0, 0, 1) 200ms both" }}>
            The first AI trading terminal for Solana perpetuals.
            <br className="hidden sm:block" />
            No dashboards. No complexity. Just type what you want.
          </p>

          {/* ═══ Terminal Mockup ═══ */}
          <div className="w-full max-w-2xl px-4"
            style={{ animation: "heroReveal 800ms cubic-bezier(0.2, 0, 0, 1) 300ms both" }}>
            <div className="relative rounded-2xl overflow-hidden"
              style={{
                background: "rgba(12, 16, 24, 0.9)",
                border: "1px solid rgba(51, 201, 161, 0.12)",
                boxShadow: `
                  0 0 0 1px rgba(51,201,161,0.05),
                  0 24px 80px -12px rgba(0,0,0,0.6),
                  0 0 60px -20px rgba(51,201,161,0.1)
                `,
              }}>

              {/* Window chrome */}
              <div className="flex items-center gap-2 px-5 py-3" style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                <div className="flex gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: "rgba(255,255,255,0.08)" }} />
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: "rgba(255,255,255,0.08)" }} />
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: "rgba(255,255,255,0.08)" }} />
                </div>
                <span className="text-[11px] text-text-tertiary ml-3 font-mono">Flash Terminal</span>
                <div className="ml-auto flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--color-brand-teal)", boxShadow: "0 0 6px rgba(51,201,161,0.5)" }} />
                  <span className="text-[10px] text-text-tertiary">Connected</span>
                </div>
              </div>

              {/* Chat area */}
              <div className="px-6 py-5 space-y-4 min-h-[200px]">
                {/* User message */}
                <div className="flex justify-end">
                  <div className="px-4 py-2.5 rounded-xl max-w-[280px]"
                    style={{ background: "rgba(51,201,161,0.08)", border: "1px solid rgba(51,201,161,0.12)" }}>
                    <span className="text-[14px]">long SOL 5x $100</span>
                  </div>
                </div>

                {/* AI response — trade card */}
                <div className="flex items-start gap-3">
                  <div className="w-7 h-7 rounded-full shrink-0 flex items-center justify-center mt-0.5"
                    style={{ background: "rgba(51,201,161,0.1)", border: "1px solid rgba(51,201,161,0.15)" }}>
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M3 13L8 3L13 13H3Z" fill="var(--color-brand-teal)" /></svg>
                  </div>
                  <div className="flex-1 rounded-xl overflow-hidden" style={{ background: "rgba(14,19,28,0.8)", border: "1px solid rgba(51,201,161,0.1)" }}>
                    {/* Trade header */}
                    <div className="flex items-center gap-2.5 px-4 py-2.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                      <span className="w-2.5 h-2.5 rounded-full" style={{ background: "var(--color-accent-long)" }} />
                      <span className="text-[14px] font-bold">SOL-PERP</span>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                        style={{ color: "var(--color-accent-long)", background: "rgba(0,210,106,0.12)" }}>LONG</span>
                      <span className="text-[10px] ml-auto" style={{ color: "var(--color-brand-teal)" }}>✓ Ready</span>
                    </div>
                    {/* Trade grid */}
                    <div className="grid grid-cols-4 text-[12px]">
                      {[
                        { label: "Entry", value: "$148.32", color: "" },
                        { label: "Size", value: "$500", color: "" },
                        { label: "Leverage", value: "5x", color: "" },
                        { label: "Liq", value: "$118.66", color: "var(--color-accent-warn)" },
                      ].map((cell, i) => (
                        <div key={i} className="px-3 py-2.5 text-center" style={{ borderRight: i < 3 ? "1px solid rgba(255,255,255,0.04)" : "none" }}>
                          <div className="text-[9px] text-text-tertiary uppercase tracking-wider mb-0.5">{cell.label}</div>
                          <div className="num font-semibold" style={{ color: cell.color || "var(--color-text-primary)" }}>{cell.value}</div>
                        </div>
                      ))}
                    </div>
                    {/* Confirm button */}
                    <div style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
                      <div className="py-2.5 text-center text-[12px] font-bold"
                        style={{ background: "var(--color-accent-long)", color: "#000", borderRadius: "0 0 12px 12px" }}>
                        Confirm Trade
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Input bar at bottom */}
              <div className="px-5 pb-5 pt-2">
                <div className="flex items-center rounded-xl px-4 py-3"
                  style={{
                    background: "rgba(14,19,28,0.6)",
                    border: "1px solid rgba(51,201,161,0.1)",
                  }}>
                  <span className="text-[14px] text-text-tertiary font-mono flex-1">Type a command...</span>
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center"
                    style={{ background: "rgba(255,255,255,0.04)" }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-tertiary)" strokeWidth="2" strokeLinecap="round">
                      <line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" />
                    </svg>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* CTAs */}
          <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-5 mt-16"
            style={{ animation: "heroReveal 700ms cubic-bezier(0.2, 0, 0, 1) 500ms both" }}>
            <Link href="/" className="btn-cta px-10 py-4 text-[16px] font-bold tracking-wide">
              Start Trading
            </Link>
            <Link href="https://docs.flash.trade" target="_blank"
              className="btn-ghost px-10 py-4 text-[16px] font-medium">
              View Docs
            </Link>
          </div>
        </div>

        {/* Scroll hint */}
        <div className="absolute bottom-10 left-1/2 -translate-x-1/2" style={{ opacity: heroOpacity * 0.5 }}>
          <div className="w-7 h-11 rounded-full flex items-start justify-center pt-2.5"
            style={{ border: "2px solid rgba(51,201,161,0.12)" }}>
            <div className="w-1 h-2.5 rounded-full" style={{ background: "var(--color-brand-teal)", animation: "typingBounce 2s ease-in-out infinite" }} />
          </div>
        </div>
      </section>

      {/* ══════════ SPEED ══════════ */}
      <section className="py-28 sm:py-36 px-6">
        <div className="max-w-4xl mx-auto text-center">
          <div className="text-[11px] font-bold tracking-[0.3em] uppercase mb-5" style={{ color: "var(--color-brand-teal)" }}>SPEED</div>
          <h2 className="text-[32px] sm:text-[40px] md:text-[48px] font-bold tracking-tight mb-6">Execution in milliseconds</h2>
          <p className="text-[17px] text-text-secondary mb-16 max-w-2xl mx-auto">Common commands execute in under 5ms. Deterministic parsing, cached prices, instant preview.</p>

          <div className="glass-card px-10 py-8 max-w-2xl mx-auto">
            <div className="flex items-start justify-between relative">
              <div className="absolute top-[7px] left-[24px] right-[24px] h-px" style={{ background: "linear-gradient(90deg, var(--color-brand-teal), var(--color-brand-cyan), var(--color-accent-long), var(--color-accent-lime))", opacity: 0.25 }} />
              {[
                { t: "0ms", label: "Parse", color: "var(--color-brand-teal)" },
                { t: "1ms", label: "Validate", color: "var(--color-brand-cyan)" },
                { t: "3ms", label: "Preview", color: "var(--color-accent-long)" },
                { t: "5ms", label: "Ready", color: "var(--color-accent-lime)" },
              ].map((step, i) => (
                <div key={i} className="flex flex-col items-center relative z-10 flex-1">
                  <div className="w-3.5 h-3.5 rounded-full mb-4" style={{ background: step.color, boxShadow: `0 0 16px ${step.color}50` }} />
                  <div className="text-[16px] num font-bold mb-1" style={{ color: step.color }}>{step.t}</div>
                  <div className="text-[12px] text-text-tertiary">{step.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ══════════ SAFETY ══════════ */}
      <section className="py-28 sm:py-36 px-6 relative">
        <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse 80% 60% at 50% 50%, rgba(51,201,161,0.03) 0%, transparent 70%)" }} />
        <div className="max-w-5xl mx-auto text-center relative z-10">
          <div className="text-[11px] font-bold tracking-[0.3em] uppercase mb-5" style={{ color: "var(--color-brand-cyan)" }}>SAFETY</div>
          <h2 className="text-[32px] sm:text-[40px] md:text-[48px] font-bold tracking-tight mb-6">Every trade is verified</h2>
          <p className="text-[17px] text-text-secondary mb-16 max-w-2xl mx-auto">6-layer validation. Simulation before signing. Your wallet never signs a doomed transaction.</p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 text-left">
            {[
              { icon: "🎯", title: "Deterministic Parser", desc: "Regex-based compiler. No AI guessing on critical trading paths." },
              { icon: "🛡️", title: "Pre-Sign Simulation", desc: "Every transaction simulated on-chain before your wallet sees it." },
              { icon: "🔒", title: "6-Layer Firewall", desc: "Zod schemas, leverage caps, wallet auth, rate limiting, and more." },
            ].map((item, i) => (
              <div key={i} className="glass-card px-6 py-6 transition-all duration-200 cursor-default"
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = "translateY(-4px)";
                  e.currentTarget.style.borderColor = "rgba(51,201,161,0.2)";
                  e.currentTarget.style.boxShadow = "0 16px 48px -8px rgba(0,0,0,0.4), 0 0 24px -4px rgba(51,201,161,0.12)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = "none";
                  e.currentTarget.style.borderColor = "rgba(51,201,161,0.06)";
                  e.currentTarget.style.boxShadow = "0 8px 32px -8px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.04)";
                }}>
                <div className="text-[28px] mb-4">{item.icon}</div>
                <div className="text-[16px] font-semibold mb-2">{item.title}</div>
                <div className="text-[14px] text-text-tertiary leading-relaxed">{item.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════ SIMPLICITY ══════════ */}
      <section className="py-28 sm:py-36 px-6">
        <div className="max-w-4xl mx-auto text-center">
          <div className="text-[11px] font-bold tracking-[0.3em] uppercase mb-5" style={{ color: "var(--color-accent-long)" }}>SIMPLICITY</div>
          <h2 className="text-[32px] sm:text-[40px] md:text-[48px] font-bold tracking-tight mb-6">No dashboards. No complexity.</h2>
          <p className="text-[17px] text-text-secondary mb-16 max-w-2xl mx-auto">Just type what you want. The AI handles the rest.</p>

          <div className="flex flex-col gap-3 max-w-lg mx-auto text-left">
            {[
              { cmd: "long SOL 5x $100", desc: "Open a leveraged long" },
              { cmd: "close SOL", desc: "Close your position" },
              { cmd: "deposit $50 to crypto", desc: "Earn yield from fees" },
              { cmd: "show portfolio", desc: "See all positions" },
            ].map((ex, i) => (
              <div key={i} className="flex items-center gap-5 px-5 py-4 rounded-xl transition-all duration-200"
                style={{ background: "rgba(14,19,28,0.65)", border: "1px solid rgba(51,201,161,0.05)" }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "rgba(51,201,161,0.15)";
                  e.currentTarget.style.paddingLeft = "22px";
                  e.currentTarget.style.borderLeftWidth = "3px";
                  e.currentTarget.style.borderLeftColor = "var(--color-brand-teal)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "rgba(51,201,161,0.05)";
                  e.currentTarget.style.paddingLeft = "20px";
                  e.currentTarget.style.borderLeftWidth = "1px";
                }}>
                <code className="text-[14px] sm:text-[15px] num font-medium flex-1 whitespace-nowrap" style={{ color: "var(--color-brand-cyan)" }}>{ex.cmd}</code>
                <span className="text-[13px] text-text-tertiary whitespace-nowrap">{ex.desc}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════ FINAL CTA ══════════ */}
      <section className="py-36 sm:py-44 px-6 text-center relative">
        <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse 80% 60% at 50% 50%, rgba(51,201,161,0.06) 0%, transparent 70%)" }} />
        <div className="relative z-10">
          <h2 className="text-[36px] sm:text-[44px] md:text-[56px] font-bold tracking-tight mb-5">
            Start typing your <span className="text-gradient-brand">first trade</span>
          </h2>
          <p className="text-[18px] text-text-secondary mb-12">No signup. Connect wallet. Trade.</p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-5">
            <Link href="/" className="btn-cta px-12 py-4 text-[17px] font-bold tracking-wide">
              Open Flash Terminal
            </Link>
            <Link href="https://docs.flash.trade" target="_blank"
              className="btn-ghost px-12 py-4 text-[17px] font-medium">
              View Docs
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-10 px-6 text-center relative">
        <div className="absolute top-0 left-[20%] right-[20%] h-px" style={{ background: "linear-gradient(90deg, transparent, rgba(51,201,161,0.2), transparent)" }} />
        <div className="text-[13px] text-text-tertiary">
          Built on <a href="https://flash.trade" target="_blank" rel="noopener" className="text-text-secondary hover:text-text-primary transition-colors">Flash Trade</a> · Powered by <a href="https://solana.com" target="_blank" rel="noopener" className="text-text-secondary hover:text-text-primary transition-colors">Solana</a>
        </div>
      </footer>
    </div>
  );
}
