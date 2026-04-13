"use client";

// ============================================
// Flash UI — Earn Page (Protocol-Native)
// ============================================
// ALL data from Flash API. NO custom APY math.
// Deposit/withdraw via Flash API transaction builder.

import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { useFlashStore } from "@/store";
import { formatUsd, safe } from "@/lib/format";
import dynamic from "next/dynamic";
const EarnModal = dynamic(() => import("./EarnModal"), { ssr: false });

// ---- Types (from Flash earn API) ----

interface EarnPool {
  poolAddress: string;
  aum: string;
  flpTokenSymbol: string;
  sflpTokenSymbol: string;
  flpDailyApy: number;
  flpWeeklyApy: number;
  sflpWeeklyApr: number;
  sflpDailyApr: number;
  flpPrice: number;
  sFlpPrice: number;
}

// Pool display metadata
const POOL_META: Record<string, { name: string; assets: string; color: string }> = {
  "FLP.1": { name: "Crypto Pool", assets: "SOL, BTC, ETH, BNB", color: "#9945FF" },
  "FLP.2": { name: "Gold Pool", assets: "XAU, Forex", color: "#FCD34D" },
  "FLP.3": { name: "DeFi Pool", assets: "JUP, PYTH, JTO, RAY", color: "#00D18C" },
  "FLP.4": { name: "Meme Pool", assets: "BONK, PENGU", color: "#F59E0B" },
  "FLP.5": { name: "WIF Pool", assets: "WIF", color: "#A855F7" },
  "FLP.7": { name: "FART Pool", assets: "FARTCOIN", color: "#86EFAC" },
  "FLP.8": { name: "Ore Pool", assets: "ORE", color: "#F97316" },
};

export default function EarnPage({ onBack }: { onBack: () => void }) {
  const [pools, setPools] = useState<EarnPool[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const walletConnected = useFlashStore((s) => s.walletConnected);

  const fetchPools = useCallback(async () => {
    try {
      const res = await fetch("/api/earn");
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      setPools(data.pools ?? []);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPools();
    const interval = setInterval(fetchPools, 60_000);
    return () => clearInterval(interval);
  }, [fetchPools]);

  const totalTvl = pools.reduce((sum, p) => sum + safe(parseFloat(p.aum)), 0);

  return (
    <div
      className="flex flex-col items-center pt-8 pb-6 px-6 w-full max-w-[560px] mx-auto"
      style={{ animation: "fadeIn 300ms ease-out" }}
    >
      {/* Header */}
      <div className="w-full flex items-center justify-between mb-6">
        <button onClick={onBack} className="text-[12px] text-text-tertiary hover:text-text-secondary cursor-pointer">
          ← Back
        </button>
        <div className="text-[12px] text-text-tertiary tracking-[0.2em] uppercase">Earn</div>
        <div className="w-12" />
      </div>

      {/* TVL Banner */}
      <div className="w-full glass-card px-5 py-4 mb-4 text-center">
        <div className="text-[11px] text-text-tertiary tracking-wider uppercase mb-1">Total Value Locked</div>
        <div className="text-[32px] font-bold text-text-primary num tracking-tight">
          {loading ? "..." : formatUsd(totalTvl)}
        </div>
        <div className="text-[12px] text-text-tertiary mt-1">
          Earn from trading fees · Value fluctuates with trader PnL
        </div>
      </div>

      {/* Error */}
      {error && <div className="w-full text-[12px] text-accent-short text-center py-2 mb-2">{error}</div>}

      {/* Pool List */}
      {loading ? (
        <div className="w-full flex flex-col gap-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="glass-card px-5 py-4">
              <div className="flex items-center gap-3 mb-3">
                <div className="skel w-8 h-8 rounded-full" />
                <div className="skel w-32 h-5" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="skel h-10" />
                <div className="skel h-10" />
                <div className="skel h-10" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="w-full flex flex-col gap-3">
          {pools.map((pool) => (
            <PoolCard key={pool.poolAddress} pool={pool} walletConnected={walletConnected} onRefresh={fetchPools} />
          ))}
        </div>
      )}

      {/* Info */}
      <div
        className="w-full mt-4 px-4 py-3 rounded-xl text-[11px] text-text-tertiary leading-relaxed"
        style={{ background: "rgba(59,130,246,0.04)", border: "1px solid rgba(59,130,246,0.08)" }}
      >
        <span className="font-medium text-accent-blue">How it works: </span>
        Deposit USDC → receive FLP tokens. FLP auto-compounds trading fees into token value. Your earnings grow as
        traders pay fees. Withdraw anytime.
      </div>
    </div>
  );
}

// ---- Pool Card ----

function PoolCard({
  pool,
  walletConnected,
  onRefresh,
}: {
  pool: EarnPool;
  walletConnected: boolean;
  onRefresh: () => void;
}) {
  const [modal, setModal] = useState<"deposit" | "withdraw" | null>(null);
  const meta = POOL_META[pool.flpTokenSymbol] ?? { name: pool.flpTokenSymbol, assets: "", color: "#555" };
  const aum = safe(parseFloat(pool.aum));
  const flpApy = safe(pool.flpWeeklyApy);
  const sflpApr = safe(pool.sflpWeeklyApr);
  const flpPrice = safe(pool.flpPrice);

  const apyColor =
    flpApy > 40 ? "var(--color-accent-long)" : flpApy > 15 ? "var(--color-accent-blue)" : "var(--color-text-secondary)";

  return (
    <div className="glass-card overflow-hidden card-anim">
      {/* Header */}
      <div className="px-5 py-3.5 flex items-center justify-between border-b border-border-subtle">
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-[12px] font-bold text-white"
            style={{ background: meta.color }}
          >
            {meta.name.charAt(0)}
          </div>
          <div>
            <div className="text-[14px] font-semibold text-text-primary">{meta.name}</div>
            <div className="text-[11px] text-text-tertiary">{meta.assets}</div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[16px] font-bold num" style={{ color: apyColor }}>
            {flpApy > 0 ? `${flpApy.toFixed(1)}%` : "—"}
          </div>
          <div className="text-[10px] text-text-tertiary">APY (7d)</div>
        </div>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-3 gap-px" style={{ background: "var(--color-border-subtle)" }}>
        <MetricCell label="TVL" value={aum >= 1e6 ? `$${(aum / 1e6).toFixed(1)}M` : formatUsd(aum)} />
        <MetricCell label="FLP Price" value={`$${flpPrice.toFixed(4)}`} />
        <MetricCell label="sFLP APR" value={sflpApr > 0 ? `${sflpApr.toFixed(1)}%` : "—"} />
      </div>

      {/* Actions */}
      {walletConnected ? (
        <div className="flex border-t border-border-subtle">
          <button
            onClick={() => setModal("deposit")}
            className="btn-primary flex-1 py-3 text-[13px] font-bold tracking-wide cursor-pointer"
            style={{ color: "#000", background: "var(--color-accent-lime)", borderRadius: "0 0 0 16px" }}
          >
            Deposit
          </button>
          <button
            onClick={() => setModal("withdraw")}
            className="flex-1 py-3 text-[13px] font-medium text-text-tertiary hover:text-text-secondary cursor-pointer
              border-l border-border-subtle"
            style={{ borderRadius: "0 0 16px 0" }}
          >
            Withdraw
          </button>
        </div>
      ) : (
        <div className="px-5 py-3 text-[11px] text-text-tertiary text-center">Connect wallet to deposit</div>
      )}

      {/* Modal — portaled to body to escape overflow:hidden */}
      {modal &&
        typeof document !== "undefined" &&
        createPortal(
          <EarnModal
            mode={modal}
            poolAlias={meta.name.split(" ")[0].toLowerCase()}
            poolName={meta.name}
            flpPrice={flpPrice}
            poolApy={flpApy}
            onClose={() => setModal(null)}
            onSuccess={() => {
              setModal(null);
              onRefresh();
            }}
          />,
          document.body,
        )}
    </div>
  );
}

function MetricCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-bg-card px-4 py-2.5">
      <div className="text-[10px] text-text-tertiary mb-0.5">{label}</div>
      <div className="text-[13px] num font-medium text-text-primary">{value}</div>
    </div>
  );
}
