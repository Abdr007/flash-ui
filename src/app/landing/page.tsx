"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";

// ─── Self-Typing Terminal Demo ───────────────────────────────────────────────
function TerminalDemo() {
  const [displayed, setDisplayed] = useState("");
  const [started, setStarted] = useState(false);
  const [cardVisible, setCardVisible] = useState(false);
  const [confirmGlow, setConfirmGlow] = useState(false);
  const text = "long SOL 5x $100";
  const typingDone = displayed.length >= text.length;
  const phase = !started ? "waiting" : typingDone ? "done" : "typing";

  useEffect(() => {
    const t = setTimeout(() => setStarted(true), 1200);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!started || typingDone) return;
    const t = setTimeout(() => setDisplayed(text.slice(0, displayed.length + 1)), 55 + Math.random() * 30);
    return () => clearTimeout(t);
  }, [displayed, started, typingDone]);

  useEffect(() => {
    if (!typingDone) return;
    const t1 = setTimeout(() => setCardVisible(true), 400);
    const t2 = setTimeout(() => setConfirmGlow(true), 1600);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [typingDone]);

  return (
    <div
      className="relative rounded-2xl overflow-hidden"
      style={{
        background: "rgba(8, 12, 18, 0.97)",
        border: "1px solid rgba(51,201,161,0.12)",
        boxShadow:
          "0 0 0 1px rgba(51,201,161,0.04), 0 40px 120px -20px rgba(0,0,0,0.8), 0 0 100px -30px rgba(51,201,161,0.1)",
      }}
    >
      {/* Window chrome */}
      <div className="flex items-center px-5 sm:px-6 py-3" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
        <div className="flex gap-[7px]">
          <span className="w-[11px] h-[11px] rounded-full bg-[#ff5f57]" />
          <span className="w-[11px] h-[11px] rounded-full bg-[#febc2e]" />
          <span className="w-[11px] h-[11px] rounded-full bg-[#28c840]" />
        </div>
        <span className="text-[11px] text-text-tertiary ml-4 tracking-wider font-mono">Flash Terminal</span>
        <div className="ml-auto flex items-center gap-2">
          <span className="w-[7px] h-[7px] rounded-full bg-[#33c9a1]" style={{ boxShadow: "0 0 6px #33c9a1" }} />
          <span className="text-[11px] text-text-tertiary font-mono">Dxv3...f4kL</span>
        </div>
      </div>

      {/* Chat area */}
      <div className="px-5 sm:px-7 py-6 sm:py-8 space-y-5 min-h-[340px] sm:min-h-[380px]">
        <div className="flex justify-end">
          <div
            className="px-4 sm:px-5 py-2.5 sm:py-3 rounded-2xl rounded-br-md max-w-[90%]"
            style={{ background: "rgba(51,201,161,0.08)", border: "1px solid rgba(51,201,161,0.1)" }}
          >
            <span className="text-[14px] sm:text-[15px] font-mono text-text-primary">
              {displayed}
              {phase === "typing" && (
                <span
                  className="inline-block w-[2px] h-[16px] bg-[#3affe1] ml-0.5 align-middle"
                  style={{ animation: "typingBounce 1s steps(1) infinite" }}
                />
              )}
            </span>
          </div>
        </div>

        {phase === "done" && (
          <div className="flex items-start gap-3 sm:gap-4" style={{ animation: "fadeIn 300ms ease-out both" }}>
            <div
              className="w-7 h-7 sm:w-8 sm:h-8 rounded-full shrink-0 flex items-center justify-center mt-1"
              style={{ background: "rgba(51,201,161,0.1)", border: "1px solid rgba(51,201,161,0.15)" }}
            >
              <svg width="12" height="12" viewBox="0 0 62 45" fill="none" aria-hidden="true">
                <path
                  d="M49.88 19.7C49.88 20.6 49.94 26.35 49.94 27.58H33.28c-.66 0-1.09.19-1.56.65L19.06 40.89c-.47.47-.9.65-1.55.62h-6.22v-5.69c0-.49.09-.84.47-1.21L26.19 20.2c.31-.34.62-.53 1.09-.53h22.6z"
                  fill="#33c9a1"
                  fillOpacity="0.9"
                />
                <path
                  d="M60.75 30.69h.56v6.84h-7.31c-.65 0-1.09.19-1.56.65l-13.83 13.9c-.5.47-.97.69-1.65.66h-13.2l8.86-8.24c2.15-2.18 4.3-4.32 6.47-6.5.09-.1.16-.19.34-.44h-13.3l.6-.81c1.87-1.87 3.73-3.7 5.6-5.57.34-.34.69-.53 1.21-.53h27z"
                  fill="#33c9a1"
                  fillOpacity="0.9"
                />
              </svg>
            </div>
            <div
              className={`flex-1 rounded-2xl overflow-hidden transition-all duration-500 ${cardVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-3"}`}
              style={{
                background: "rgba(12, 17, 24, 0.8)",
                border: cardVisible ? "1px solid rgba(0,210,106,0.15)" : "1px solid rgba(51,201,161,0.08)",
                boxShadow: cardVisible ? "0 0 40px -10px rgba(0,210,106,0.08)" : "none",
              }}
            >
              <div
                className="flex items-center gap-2.5 px-4 sm:px-5 py-3"
                style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}
              >
                <span
                  className="w-2.5 h-2.5 rounded-full bg-[#00d26a]"
                  style={{ boxShadow: "0 0 8px rgba(0,210,106,0.5)" }}
                />
                <span className="text-[14px] sm:text-[15px] font-bold tracking-tight">SOL-PERP</span>
                <span
                  className="text-[10px] font-bold px-2 py-0.5 rounded-full tracking-wider"
                  style={{ color: "#00d26a", background: "rgba(0,210,106,0.1)" }}
                >
                  LONG
                </span>
                <span className="text-[11px] font-medium ml-auto" style={{ color: "#33c9a1" }}>
                  Ready
                </span>
              </div>
              <div className="grid grid-cols-2">
                {[
                  { label: "Entry Price", value: "$148.32", color: "var(--color-text-primary)" },
                  { label: "Liquidation", value: "$119.44", color: "var(--color-accent-warn)" },
                  { label: "Size", value: "$500.00", color: "var(--color-text-primary)" },
                  { label: "Leverage", value: "5.0x", color: "var(--color-text-primary)" },
                ].map((cell, i) => (
                  <div
                    key={cell.label}
                    className={`px-4 sm:px-5 py-3 transition-all duration-500 ${cardVisible ? "opacity-100" : "opacity-0"}`}
                    style={{
                      borderBottom: i < 2 ? "1px solid rgba(255,255,255,0.04)" : undefined,
                      borderRight: i % 2 === 0 ? "1px solid rgba(255,255,255,0.04)" : undefined,
                      transitionDelay: `${400 + i * 100}ms`,
                    }}
                  >
                    <div className="text-[10px] text-text-tertiary uppercase tracking-[0.15em] mb-1">{cell.label}</div>
                    <div className="num font-bold text-[16px] sm:text-[18px]" style={{ color: cell.color }}>
                      {cell.value}
                    </div>
                  </div>
                ))}
              </div>
              <div
                className={`transition-all duration-500 ${confirmGlow ? "opacity-100" : "opacity-0"}`}
                style={{ borderTop: "1px solid rgba(255,255,255,0.04)", transitionDelay: "200ms" }}
              >
                <div
                  className="py-3 text-center text-[13px] font-bold tracking-wide"
                  style={{
                    background: confirmGlow ? "#00d26a" : "rgba(0,210,106,0.3)",
                    color: "#000",
                    transition: "background 600ms ease",
                  }}
                >
                  Confirm Trade
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="px-5 sm:px-7 pb-5 pt-1">
        <div
          className="flex items-center rounded-xl px-4 sm:px-5 py-3"
          style={{ background: "rgba(14,19,28,0.5)", border: "1px solid rgba(51,201,161,0.06)" }}
        >
          <span className="text-[13px] sm:text-[14px] text-text-tertiary font-mono flex-1">Type a command...</span>
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ background: "rgba(255,255,255,0.04)" }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--color-text-tertiary)"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <line x1="12" y1="19" x2="12" y2="5" />
              <polyline points="5 12 12 5 19 12" />
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Scroll-Reveal Wrapper ───────────────────────────────────────────────────
function RevealSection({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => e.isIntersecting && setVisible(true), { threshold: 0.12 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      className={`transition-all duration-700 ${visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"} ${className}`}
    >
      {children}
    </div>
  );
}

// ─── Animated Counter ────────────────────────────────────────────────────────
function Counter({ end, suffix = "" }: { end: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [value, setValue] = useState(0);
  const started = useRef(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting && !started.current) {
          started.current = true;
          const s = performance.now();
          const tick = (now: number) => {
            const p = Math.min((now - s) / 1500, 1);
            setValue(Math.round((1 - Math.pow(1 - p, 3)) * end));
            if (p < 1) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }
      },
      { threshold: 0.3 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [end]);
  return (
    <span ref={ref}>
      {value.toLocaleString()}
      {suffix}
    </span>
  );
}

// ─── Landing Page ────────────────────────────────────────────────────────────
export default function LandingPage() {
  return (
    <div className="bg-bg-root text-text-primary min-h-screen overflow-x-hidden selection:bg-[#33c9a1]/20">
      {/* ═══ HERO ═══ */}
      <section className="relative min-h-screen flex flex-col items-center justify-center px-5 sm:px-8 overflow-hidden">
        <div className="absolute inset-0 dot-grid-full" style={{ opacity: 0.35 }} />
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse 80% 50% at 50% 20%, rgba(51,201,161,0.15) 0%, transparent 70%), radial-gradient(ellipse 60% 40% at 30% 60%, rgba(58,255,225,0.06) 0%, transparent 60%), radial-gradient(ellipse 40% 30% at 70% 70%, rgba(200,245,71,0.04) 0%, transparent 50%)",
          }}
        />
        <div className="relative z-10 flex flex-col items-center w-full max-w-5xl text-center">
          <div
            className="flex items-center gap-2.5 px-5 py-2 rounded-full mb-10 sm:mb-14"
            style={{
              background: "rgba(51,201,161,0.06)",
              border: "1px solid rgba(51,201,161,0.15)",
              animation: "heroReveal 600ms cubic-bezier(0.16,1,0.3,1) both",
            }}
          >
            <span
              className="w-2 h-2 rounded-full shrink-0 bg-[#33c9a1]"
              style={{ boxShadow: "0 0 10px rgba(51,201,161,0.6)" }}
            />
            <span className="text-[12px] sm:text-[13px] font-medium tracking-wide text-[#33c9a1]">
              Powered by Flash Trade on Solana
            </span>
          </div>
          <h1
            className="text-[40px] sm:text-[56px] md:text-[72px] lg:text-[88px] xl:text-[96px] font-bold tracking-[-0.04em] leading-[1.05] mb-6 sm:mb-8"
            style={{ animation: "heroReveal 800ms cubic-bezier(0.16,1,0.3,1) 100ms both" }}
          >
            Trade with
            <br />
            <span className="text-gradient-brand">your words.</span>
          </h1>
          <p
            className="text-[16px] sm:text-[18px] md:text-[20px] text-text-secondary leading-relaxed mb-12 sm:mb-16 max-w-2xl px-4"
            style={{ animation: "heroReveal 800ms cubic-bezier(0.16,1,0.3,1) 200ms both" }}
          >
            The AI-native terminal for Solana perpetuals.
            <br className="hidden sm:block" />
            Type a trade in plain English. It executes on-chain.
          </p>
          <div
            className="w-full max-w-[720px]"
            style={{ animation: "heroReveal 900ms cubic-bezier(0.16,1,0.3,1) 350ms both" }}
          >
            <TerminalDemo />
          </div>
          <div
            className="flex flex-col sm:flex-row items-center gap-4 sm:gap-5 mt-12 sm:mt-16"
            style={{ animation: "heroReveal 800ms cubic-bezier(0.16,1,0.3,1) 600ms both" }}
          >
            <Link
              href="/"
              className="btn-cta px-10 sm:px-12 py-3.5 sm:py-4 text-[15px] sm:text-[16px] font-bold tracking-wide"
            >
              Start Trading
            </Link>
            <Link
              href="https://docs.flash.trade"
              target="_blank"
              rel="noopener noreferrer"
              className="btn-ghost px-10 sm:px-12 py-3.5 sm:py-4 text-[15px] sm:text-[16px] font-medium"
            >
              Documentation
            </Link>
          </div>
        </div>
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 opacity-40">
          <div
            className="w-6 h-10 rounded-full flex items-start justify-center pt-2"
            style={{ border: "1.5px solid rgba(51,201,161,0.2)" }}
          >
            <div
              className="w-1 h-2 rounded-full bg-[#33c9a1]"
              style={{ animation: "typingBounce 2s ease-in-out infinite" }}
            />
          </div>
        </div>
      </section>

      {/* ═══ STATS ═══ */}
      <RevealSection>
        <div className="py-16 sm:py-20 px-5 sm:px-8 relative">
          <div
            className="absolute inset-x-0 top-0 h-px"
            style={{ background: "linear-gradient(90deg, transparent, rgba(51,201,161,0.15), transparent)" }}
          />
          <div className="max-w-5xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-6 sm:gap-8 text-center">
            {[
              { value: 20, suffix: "+", label: "Perp Markets" },
              { value: 500, suffix: "x", label: "Max Leverage" },
              { value: 5, suffix: "ms", label: "Parse Speed" },
              { value: 6, suffix: "", label: "Safety Layers" },
            ].map((stat) => (
              <div key={stat.label} className="py-4">
                <div className="text-[28px] sm:text-[36px] md:text-[42px] font-bold num text-[#3affe1]">
                  <Counter end={stat.value} suffix={stat.suffix} />
                </div>
                <div className="text-[12px] sm:text-[13px] text-text-tertiary mt-1 tracking-wide">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </RevealSection>

      {/* ═══ SPEED ═══ */}
      <RevealSection>
        <div className="py-24 sm:py-32 px-5 sm:px-8">
          <div className="max-w-4xl mx-auto text-center">
            <div className="text-[11px] font-bold tracking-[0.3em] uppercase mb-4 text-[#33c9a1]">SPEED</div>
            <h2 className="text-[28px] sm:text-[36px] md:text-[48px] font-bold tracking-tight mb-5">
              Instant execution pipeline
            </h2>
            <p className="text-[16px] sm:text-[17px] text-text-secondary mb-12 sm:mb-16 max-w-xl mx-auto leading-relaxed">
              Commands are parsed deterministically. No AI latency on the critical path.
            </p>
            <div className="glass-card px-6 sm:px-10 py-7 sm:py-8 max-w-2xl mx-auto">
              <div className="flex items-start justify-between relative">
                <div
                  className="absolute top-[7px] left-[24px] right-[24px] h-px"
                  style={{
                    background: "linear-gradient(90deg, #33c9a1, #3affe1, #00d26a, #c8f547)",
                    opacity: 0.3,
                  }}
                />
                {[
                  { t: "0ms", label: "Parse", color: "#33c9a1" },
                  { t: "1ms", label: "Validate", color: "#3affe1" },
                  { t: "3ms", label: "Preview", color: "#00d26a" },
                  { t: "5ms", label: "Ready", color: "#c8f547" },
                ].map((step) => (
                  <div key={step.label} className="flex flex-col items-center relative z-10 flex-1">
                    <div
                      className="w-3.5 h-3.5 rounded-full mb-3 sm:mb-4"
                      style={{ background: step.color, boxShadow: `0 0 16px ${step.color}60` }}
                    />
                    <div className="text-[14px] sm:text-[16px] num font-bold mb-0.5" style={{ color: step.color }}>
                      {step.t}
                    </div>
                    <div className="text-[11px] sm:text-[12px] text-text-tertiary">{step.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </RevealSection>

      {/* ═══ SAFETY ═══ */}
      <RevealSection>
        <div className="py-24 sm:py-32 px-5 sm:px-8 relative">
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background: "radial-gradient(ellipse 80% 50% at 50% 50%, rgba(51,201,161,0.03) 0%, transparent 70%)",
            }}
          />
          <div className="max-w-5xl mx-auto text-center relative z-10">
            <div className="text-[11px] font-bold tracking-[0.3em] uppercase mb-4 text-[#3affe1]">SAFETY</div>
            <h2 className="text-[28px] sm:text-[36px] md:text-[48px] font-bold tracking-tight mb-5">
              Every trade is verified
            </h2>
            <p className="text-[16px] sm:text-[17px] text-text-secondary mb-12 sm:mb-16 max-w-xl mx-auto leading-relaxed">
              6-layer validation pipeline. Simulation before signing. Your wallet never signs a doomed transaction.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-5 text-left">
              {[
                {
                  title: "Deterministic Parser",
                  desc: "Regex compiler for trade commands. No AI guessing on critical execution paths.",
                  color: "#33c9a1",
                },
                {
                  title: "Pre-Sign Simulation",
                  desc: "Every transaction simulated on-chain before your wallet popup appears.",
                  color: "#3affe1",
                },
                {
                  title: "Trade Firewall",
                  desc: "Zod schemas, leverage caps, price validation, rate limits, circuit breaker.",
                  color: "#c8f547",
                },
              ].map((item) => (
                <div
                  key={item.title}
                  className="glass-card px-5 sm:px-6 py-5 sm:py-6 transition-transform duration-300 hover:-translate-y-1"
                >
                  <div
                    className="w-2 h-2 rounded-full mb-4"
                    style={{ background: item.color, boxShadow: `0 0 12px ${item.color}60` }}
                  />
                  <div className="text-[15px] sm:text-[16px] font-semibold mb-2">{item.title}</div>
                  <div className="text-[13px] sm:text-[14px] text-text-tertiary leading-relaxed">{item.desc}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </RevealSection>

      {/* ═══ COMMANDS ═══ */}
      <RevealSection>
        <div className="py-24 sm:py-32 px-5 sm:px-8">
          <div className="max-w-4xl mx-auto text-center">
            <div className="text-[11px] font-bold tracking-[0.3em] uppercase mb-4 text-[#00d26a]">SIMPLICITY</div>
            <h2 className="text-[28px] sm:text-[36px] md:text-[48px] font-bold tracking-tight mb-5">
              No dashboards. Just type.
            </h2>
            <p className="text-[16px] sm:text-[17px] text-text-secondary mb-12 sm:mb-16 max-w-xl mx-auto leading-relaxed">
              Every feature is a command. Every command is plain English.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-2xl mx-auto text-left">
              {[
                { cmd: "long SOL 5x $100", desc: "Open leveraged long", cat: "Trade" },
                { cmd: "short BTC 10x $200", desc: "Open leveraged short", cat: "Trade" },
                { cmd: "close SOL", desc: "Close at market", cat: "Manage" },
                { cmd: "set tp SOL $200", desc: "Set take-profit", cat: "Manage" },
                { cmd: "deposit $100 to crypto", desc: "Earn LP yield", cat: "Earn" },
                { cmd: "transfer 1 SOL to Abc...", desc: "Send tokens", cat: "Transfer" },
                { cmd: "portfolio", desc: "Full overview", cat: "Info" },
                { cmd: "price BTC", desc: "Live oracle price", cat: "Info" },
              ].map((ex) => (
                <div
                  key={ex.cmd}
                  className="flex items-center gap-4 px-4 sm:px-5 py-3.5 rounded-xl transition-all duration-200 hover:border-l-2 hover:border-l-[#33c9a1] hover:pl-[18px]"
                  style={{ background: "rgba(14,19,28,0.5)", border: "1px solid rgba(51,201,161,0.05)" }}
                >
                  <div className="flex-1 min-w-0">
                    <code className="text-[13px] sm:text-[14px] num font-medium block truncate text-[#3affe1]">
                      {ex.cmd}
                    </code>
                    <span className="text-[11px] sm:text-[12px] text-text-tertiary">{ex.desc}</span>
                  </div>
                  <span
                    className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full shrink-0"
                    style={{ color: "#33c9a1", background: "rgba(51,201,161,0.08)" }}
                  >
                    {ex.cat}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </RevealSection>

      {/* ═══ MARKETS ═══ */}
      <RevealSection>
        <div className="py-24 sm:py-32 px-5 sm:px-8 relative">
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background: "radial-gradient(ellipse 70% 50% at 50% 50%, rgba(58,255,225,0.03) 0%, transparent 60%)",
            }}
          />
          <div className="max-w-4xl mx-auto text-center relative z-10">
            <div className="text-[11px] font-bold tracking-[0.3em] uppercase mb-4 text-[#c8f547]">MARKETS</div>
            <h2 className="text-[28px] sm:text-[36px] md:text-[48px] font-bold tracking-tight mb-5">
              20+ perpetual markets
            </h2>
            <p className="text-[16px] sm:text-[17px] text-text-secondary mb-12 sm:mb-16 max-w-xl mx-auto leading-relaxed">
              Crypto, forex, commodities, equities. All on Solana. All from one terminal.
            </p>
            <div className="flex flex-wrap justify-center gap-2 sm:gap-2.5 max-w-3xl mx-auto">
              {[
                { n: "SOL", c: "crypto" },
                { n: "BTC", c: "crypto" },
                { n: "ETH", c: "crypto" },
                { n: "BONK", c: "crypto" },
                { n: "JUP", c: "crypto" },
                { n: "WIF", c: "crypto" },
                { n: "PENGU", c: "crypto" },
                { n: "RAY", c: "crypto" },
                { n: "PYTH", c: "crypto" },
                { n: "XAU", c: "commodity" },
                { n: "XAG", c: "commodity" },
                { n: "CRUDE", c: "commodity" },
                { n: "EUR", c: "forex" },
                { n: "GBP", c: "forex" },
                { n: "SPY", c: "equity" },
                { n: "NVDA", c: "equity" },
                { n: "TSLA", c: "equity" },
                { n: "AAPL", c: "equity" },
              ].map((m) => {
                const colors: Record<string, string> = {
                  crypto: "#33c9a1",
                  commodity: "#c8f547",
                  forex: "#3affe1",
                  equity: "#a78bfa",
                };
                const color = colors[m.c] ?? "#33c9a1";
                return (
                  <span
                    key={m.n}
                    className="text-[12px] sm:text-[13px] font-bold num px-3 sm:px-4 py-1.5 sm:py-2 rounded-full"
                    style={{ color, background: `${color}0C`, border: `1px solid ${color}20` }}
                  >
                    {m.n}
                  </span>
                );
              })}
            </div>
          </div>
        </div>
      </RevealSection>

      {/* ═══ FINAL CTA ═══ */}
      <section className="py-32 sm:py-40 px-5 sm:px-8 text-center relative">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: "radial-gradient(ellipse 80% 50% at 50% 50%, rgba(51,201,161,0.06) 0%, transparent 60%)",
          }}
        />
        <div className="relative z-10">
          <h2 className="text-[30px] sm:text-[40px] md:text-[56px] font-bold tracking-tight mb-5">
            Start typing your <span className="text-gradient-brand">first trade</span>
          </h2>
          <p className="text-[16px] sm:text-[18px] text-text-secondary mb-10 sm:mb-12">
            No signup. Connect wallet. Trade.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-5">
            <Link
              href="/"
              className="btn-cta px-10 sm:px-14 py-3.5 sm:py-4 text-[16px] sm:text-[17px] font-bold tracking-wide"
            >
              Open Flash Terminal
            </Link>
            <Link
              href="https://docs.flash.trade"
              target="_blank"
              rel="noopener noreferrer"
              className="btn-ghost px-10 sm:px-14 py-3.5 sm:py-4 text-[16px] sm:text-[17px] font-medium"
            >
              View Docs
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 sm:py-10 px-5 sm:px-8 text-center relative">
        <div
          className="absolute top-0 left-[15%] right-[15%] h-px"
          style={{ background: "linear-gradient(90deg, transparent, rgba(51,201,161,0.15), transparent)" }}
        />
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-8 text-[13px] text-text-tertiary">
          <span>
            Built on{" "}
            <a
              href="https://flash.trade"
              target="_blank"
              rel="noopener noreferrer"
              className="text-text-secondary hover:text-[#33c9a1] transition-colors"
            >
              Flash Trade
            </a>
          </span>
          <span className="hidden sm:inline" style={{ color: "rgba(255,255,255,0.1)" }}>
            |
          </span>
          <span>
            Powered by{" "}
            <a
              href="https://solana.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-text-secondary hover:text-[#33c9a1] transition-colors"
            >
              Solana
            </a>
          </span>
          <span className="hidden sm:inline" style={{ color: "rgba(255,255,255,0.1)" }}>
            |
          </span>
          <a
            href="https://docs.flash.trade"
            target="_blank"
            rel="noopener noreferrer"
            className="text-text-secondary hover:text-[#33c9a1] transition-colors"
          >
            Documentation
          </a>
        </div>
      </footer>
    </div>
  );
}
