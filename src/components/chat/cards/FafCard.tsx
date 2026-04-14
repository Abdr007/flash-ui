"use client";

import { memo, useState, useRef, useEffect } from "react";
import { useFlashStore } from "@/store";
import { useWallet } from "@solana/wallet-adapter-react";
import { Cell, ToolError } from "./shared";
import type { ToolOutput } from "./types";
import { safe } from "@/lib/format";

// ---- FAF Error Humanization ----
function humanizeFafError(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes("accountnotfound") || lower.includes("account not found") || lower.includes("not been authorized"))
    return "You don't have FAF tokens in your wallet. Buy FAF first to start staking.";
  if (lower.includes("instructionerror") || lower.includes("simulation failed") || lower.includes("custom"))
    return "You may not have enough FAF tokens. Check your FAF balance and try again.";
  if (lower.includes("insufficient")) return "Not enough tokens to complete this action.";
  if (lower.includes("not confirmed")) return "Transaction sent but not confirmed. Check Solscan before retrying.";
  if (lower.includes("wallet not available") || lower.includes("connect")) return "Connect your wallet first.";
  if (lower.includes("rejected")) return "Transaction cancelled in your wallet.";
  return raw;
}

// ---- FAF Amount Picker (inline input for custom amount) ----
function FafAmountPicker({ data, onAction }: { data: Record<string, unknown>; onAction?: (cmd: string) => void }) {
  const [customAmount, setCustomAmount] = useState("");
  const [showInput, setShowInput] = useState(false);
  const question = String(data.question ?? "How much?");
  const amounts = (data.amounts as number[]) ?? [100, 500, 1000];
  const action = String(data.action ?? "stake");
  const cmd = action === "unstake" ? "faf unstake" : "faf stake";

  function submitCustom() {
    const num = parseFloat(customAmount);
    if (num > 0) onAction?.(`${cmd} ${num}`);
  }

  return (
    <div style={{ animation: "slideUp 200ms ease-out" }}>
      <div className="text-[15px] text-text-secondary mb-3">{question}</div>
      <div className="flex flex-col gap-1.5">
        {amounts.map((amt) => (
          <button
            key={amt}
            onClick={() => onAction?.(`${cmd} ${amt}`)}
            className="quick-option group flex items-center justify-between w-full text-left
              px-4 py-3 rounded-xl cursor-pointer transition-all"
            style={{ background: "transparent", border: "1px solid var(--color-border-subtle)" }}
          >
            <span className="text-[14px] font-semibold num text-text-primary group-hover:text-accent-lime transition-colors">
              {amt.toLocaleString()} FAF
            </span>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--color-text-tertiary)"
              strokeWidth="2"
              strokeLinecap="round"
              className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
            >
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </button>
        ))}

        {/* Custom amount with inline input */}
        {!showInput ? (
          <button
            onClick={() => setShowInput(true)}
            className="quick-option group flex items-center w-full text-left
              px-4 py-3 rounded-xl cursor-pointer transition-all"
            style={{ background: "transparent", border: "1px solid var(--color-border-subtle)" }}
          >
            <span className="text-[14px] text-text-secondary group-hover:text-text-primary transition-colors">
              Other amount...
            </span>
          </button>
        ) : (
          <div
            className="flex items-center gap-2 px-4 py-2 rounded-xl"
            style={{ border: "1px solid rgba(51,201,161,0.15)", background: "rgba(51,201,161,0.04)" }}
          >
            <input
              type="number"
              value={customAmount}
              onChange={(e) => setCustomAmount(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitCustom()}
              placeholder="Enter amount"
              autoFocus
              className="flex-1 bg-transparent text-[14px] num text-text-primary outline-none
                placeholder:text-text-tertiary"
              min="0"
              step="any"
            />
            <span className="text-[12px] text-text-tertiary">FAF</span>
            <button
              onClick={submitCustom}
              disabled={!customAmount || parseFloat(customAmount) <= 0}
              className="px-3 py-1.5 rounded-lg text-[12px] font-semibold cursor-pointer
                disabled:opacity-25 disabled:cursor-default transition-all"
              style={{ background: "var(--color-accent-lime)", color: "#070A0F" }}
            >
              Go
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const FafCard = memo(function FafCard({
  toolName,
  output,
  onAction,
}: {
  toolName: string;
  output: ToolOutput;
  onAction?: (cmd: string) => void;
}) {
  const data = output.data as Record<string, unknown> | null;
  const walletAddress = useFlashStore((s) => s.walletAddress);
  const { signTransaction, connected } = useWallet();
  const [status, setStatus] = useState<"idle" | "executing" | "signing" | "confirming" | "success" | "error">("idle");
  const [txSig, setTxSig] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lockRef = useRef(false);
  const unmountedRef = useRef(false);
  useEffect(
    () => () => {
      unmountedRef.current = true;
    },
    [],
  );

  if (!data) return <ToolError toolName={toolName} error={output.error} />;

  const type = String(data.type ?? "");

  async function executeFafAction(action: string, params: Record<string, unknown> = {}) {
    if (lockRef.current || !walletAddress || !connected || !signTransaction) return;
    lockRef.current = true;
    setStatus("executing");
    setError(null);
    try {
      const buildResp = await fetch("/api/faf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, wallet: walletAddress, ...params }),
      });
      const buildJson = await buildResp.json().catch(() => null);
      if (!buildResp.ok || !buildJson?.transaction) throw new Error(buildJson?.error ?? "Failed to build transaction");

      setStatus("signing");
      const { VersionedTransaction } = await import("@solana/web3.js");
      const txBytes = Uint8Array.from(atob(buildJson.transaction), (c) => c.charCodeAt(0));
      const tx = VersionedTransaction.deserialize(txBytes);
      const signed = await signTransaction(tx);

      const signedBytes = signed.serialize();
      let signedB64 = "";
      const CHUNK = 8192;
      for (let i = 0; i < signedBytes.length; i += CHUNK) {
        signedB64 += String.fromCharCode(...signedBytes.subarray(i, Math.min(i + CHUNK, signedBytes.length)));
      }
      signedB64 = btoa(signedB64);

      const bResp = await fetch("/api/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transaction: signedB64 }),
      });
      const bJson = await bResp.json().catch(() => null);
      if (!bResp.ok || !bJson?.signature) throw new Error("Broadcast failed");

      setTxSig(bJson.signature);
      setStatus("confirming");

      // Poll for confirmation + rebroadcast every other cycle (matches CLI sendTx behavior)
      const { Connection } = await import("@solana/web3.js");
      const conn = new Connection(`${window.location.origin}/api/rpc`, "confirmed");
      let confirmed = false;
      let pollCount = 0;
      const start = Date.now();
      while (Date.now() - start < 45000) {
        if (unmountedRef.current) break;
        try {
          const { value } = await conn.getSignatureStatuses([bJson.signature]);
          const s = value[0];
          if (s?.err) throw new Error("Transaction failed on-chain");
          if (s?.confirmationStatus === "confirmed" || s?.confirmationStatus === "finalized") {
            confirmed = true;
            break;
          }
        } catch (e) {
          if (e instanceof Error && e.message.includes("failed on-chain")) throw e;
        }
        if (unmountedRef.current) break;
        // Rebroadcast every other poll cycle to improve landing rate
        pollCount++;
        if (pollCount % 2 === 0) {
          fetch("/api/broadcast", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ transaction: signedB64 }),
          }).catch(() => {});
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
      if (!confirmed) throw new Error("Transaction not confirmed in 45s. Check Solscan.");
      setStatus("success");
    } catch (err) {
      const raw = err instanceof Error ? err.message : "Failed";
      setError(humanizeFafError(raw));
      setStatus("error");
    } finally {
      lockRef.current = false;
    }
  }

  // Success state
  if (status === "success" && txSig) {
    return (
      <div className="glass-card-solid overflow-hidden success-glow" style={{ borderColor: "rgba(0,210,106,0.15)" }}>
        <div className="px-5 py-4 flex items-center gap-3">
          <span
            className="w-9 h-9 rounded-full flex items-center justify-center"
            style={{ background: "rgba(0,210,106,0.1)" }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--color-accent-long)"
              strokeWidth="2.5"
              strokeLinecap="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </span>
          <div>
            <div className="text-[14px] font-semibold text-text-primary">Transaction Confirmed</div>
            <a
              href={`https://solscan.io/tx/${txSig}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[12px] font-mono text-accent-blue hover:underline"
            >
              {txSig.slice(0, 16)}...
            </a>
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (status === "error") {
    return (
      <div className="glass-card-solid overflow-hidden" style={{ borderColor: "rgba(255,77,77,0.15)" }}>
        <div className="px-5 py-4">
          <div className="text-[14px] font-semibold text-accent-short mb-1">Failed</div>
          <div className="text-[12px] text-text-tertiary">{error}</div>
        </div>
        <div className="flex border-t border-border-subtle">
          <button
            onClick={() => {
              setStatus("idle");
              setError(null);
            }}
            className="btn-secondary flex-1 py-2.5 text-[12px] font-semibold text-text-secondary cursor-pointer"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // In-flight
  if (status !== "idle") {
    return (
      <div className="glass-card-solid overflow-hidden px-5 py-4 flex items-center gap-3">
        <span
          className="w-4 h-4 border-2 border-accent-blue border-t-transparent rounded-full"
          style={{ animation: "spin 0.8s linear infinite" }}
        />
        <span className="text-[13px] text-text-secondary">
          {status === "executing" ? "Building..." : status === "signing" ? "Sign in wallet..." : "Confirming..."}
        </span>
      </div>
    );
  }

  // ── AMOUNT PICKER (Galileo-style with inline custom input) ──
  if (type === "faf_amount_picker") {
    return <FafAmountPicker data={data} onAction={onAction} />;
  }

  // ── OPTIONS (Galileo-style action picker) ──
  if (type === "faf_options") {
    const options = [
      { label: "Dashboard", desc: "Staked FAF, rewards, tier progress", intent: "faf status" },
      { label: "Stake FAF", desc: "Earn rewards + fee discounts", intent: "I want to stake FAF tokens" },
      { label: "Claim Rewards", desc: "FAF rewards + USDC revenue", intent: "claim my faf rewards" },
      { label: "VIP Tiers", desc: "See all tiers and benefits", intent: "show me the vip tiers" },
      { label: "Unstake Requests", desc: "Pending unlocks + progress", intent: "show my unstake requests" },
    ];

    return (
      <div style={{ animation: "slideUp 200ms ease-out" }}>
        <div className="text-[15px] font-semibold text-text-primary mb-3">What would you like to do?</div>
        <div className="flex flex-col gap-1.5">
          {options.map((opt, i) => (
            <button
              key={i}
              onClick={() => onAction?.(opt.intent)}
              className="quick-option group flex items-center justify-between w-full text-left
                px-4 py-3.5 rounded-xl cursor-pointer transition-all"
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
                <span className="text-[12px] mt-0.5" style={{ color: "var(--color-text-tertiary)" }}>
                  {opt.desc}
                </span>
              </div>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--color-text-tertiary)"
                strokeWidth="2"
                strokeLinecap="round"
                className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
              >
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ── DASHBOARD (Progression-Driven) ──
  if (type === "faf_dashboard") {
    if (!data.hasAccount)
      return (
        <div className="glass-card-solid overflow-hidden">
          <div className="px-5 py-5">
            <div className="flex items-center gap-3 mb-3">
              <span
                className="w-10 h-10 rounded-full flex items-center justify-center"
                style={{ background: "rgba(51,201,161,0.08)", border: "1px solid rgba(51,201,161,0.1)" }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/ft-logo.svg" alt="FAF" width={20} height={20} style={{ borderRadius: "50%" }} />
              </span>
              <div>
                <div className="text-[15px] font-semibold text-text-primary">Start Earning with FAF</div>
                <div className="text-[12px] text-text-tertiary">Stake FAF to earn rewards + fee discounts</div>
              </div>
            </div>
            <div className="text-[13px] text-text-secondary leading-relaxed">
              Stake 20,000 FAF to unlock VIP Level 1 with 2.5% trading fee discount and USDC revenue share from protocol
              fees.
            </div>
          </div>
        </div>
      );

    const staked = safe(data.stakedAmount as number);
    const fafR = safe(data.pendingRewardsFaf as number);
    const usdcR = safe(data.pendingRevenueUsdc as number);
    const rebate = safe(data.pendingRebateUsdc as number);
    const tier = String(data.tierName ?? "None");
    const discount = safe(data.feeDiscount as number);
    const level = safe(data.level as number);
    const nextTier = data.nextTier as Record<string, unknown> | null;
    const toNext = safe(data.amountToNextTier as number);
    const hasRewards = fafR > 0.001 || usdcR > 0.001 || rebate > 0.001;

    // Tier progress calculation
    const nextReq = nextTier ? safe(nextTier.fafRequired as number) : 0;
    const currentReq = level > 0 ? ([0, 20000, 40000, 100000, 200000, 1000000, 2000000][level] ?? 0) : 0;
    const tierRange = nextReq - currentReq;
    const tierProgress = tierRange > 0 ? Math.min(100, Math.max(0, ((staked - currentReq) / tierRange) * 100)) : 100;

    return (
      <div className="glass-card overflow-hidden" style={{ maxWidth: "480px" }}>
        {/* Header with tier badge */}
        <div className="px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <span
              className="w-12 h-12 rounded-full flex items-center justify-center"
              style={{
                background: "linear-gradient(135deg, rgba(51,201,161,0.15), rgba(58,255,225,0.08))",
                border: "1.5px solid rgba(51,201,161,0.2)",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/ft-logo.svg" alt="FAF" width={28} height={28} style={{ borderRadius: "50%" }} />
            </span>
            <div>
              <div className="text-[20px] font-bold text-text-primary num">
                {staked.toLocaleString()} <span className="text-[13px] font-medium text-text-tertiary">FAF</span>
              </div>
              <div className="text-[12px] text-text-tertiary">staked balance</div>
            </div>
          </div>
          <div className="text-right">
            <div
              className="text-[12px] font-bold px-3 py-1.5 rounded-full"
              style={{
                background:
                  level > 0
                    ? "linear-gradient(135deg, rgba(51,201,161,0.12), rgba(58,255,225,0.06))"
                    : "rgba(255,255,255,0.04)",
                border: `1px solid ${level > 0 ? "rgba(51,201,161,0.2)" : "rgba(255,255,255,0.06)"}`,
                color: level > 0 ? "var(--color-brand-cyan)" : "var(--color-text-tertiary)",
              }}
            >
              VIP {tier}
            </div>
            <div className="text-[11px] num text-text-tertiary mt-1.5">{discount}% fee discount</div>
          </div>
        </div>

        {/* Tier progress bar */}
        {nextTier && toNext > 0 && (
          <div className="px-6 pb-5" style={{ borderTop: "1px solid rgba(51,201,161,0.04)" }}>
            <div className="flex items-center justify-between mb-2 mt-4">
              <span className="text-[10px] text-text-tertiary uppercase tracking-widest font-medium">
                Progress to {String(nextTier.name)}
              </span>
              <span className="text-[12px] num font-bold" style={{ color: "var(--color-brand-teal)" }}>
                {Math.round(tierProgress)}%
              </span>
            </div>
            <div className="w-full h-2.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.05)" }}>
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${tierProgress}%`,
                  background: "linear-gradient(90deg, var(--color-brand-teal), var(--color-brand-cyan))",
                  boxShadow: "0 0 8px rgba(51,201,161,0.3)",
                }}
              />
            </div>
            <div className="flex items-center justify-between mt-2 text-[10px] text-text-tertiary">
              <span>Stake {toNext.toLocaleString()} more</span>
              <span className="num">
                +{safe((nextTier as Record<string, unknown>).feeDiscount as number) - discount}% fee discount
              </span>
            </div>
          </div>
        )}

        {/* Rewards section */}
        <div style={{ borderTop: "1px solid rgba(51,201,161,0.04)" }}>
          <div className="px-6 py-4">
            <div className="text-[10px] uppercase tracking-widest text-text-tertiary mb-3 font-medium">Earnings</div>
            <div className="grid grid-cols-2 gap-4">
              <div
                className="rounded-xl px-4 py-3"
                style={{ background: "rgba(51,201,161,0.03)", border: "1px solid rgba(51,201,161,0.06)" }}
              >
                <div
                  className="text-[20px] font-bold num"
                  style={{ color: fafR > 0 ? "var(--color-accent-long)" : "var(--color-text-secondary)" }}
                >
                  {fafR.toFixed(2)}
                </div>
                <div className="text-[11px] text-text-tertiary mt-1">FAF rewards</div>
              </div>
              <div
                className="rounded-xl px-4 py-3"
                style={{ background: "rgba(51,201,161,0.03)", border: "1px solid rgba(51,201,161,0.06)" }}
              >
                <div
                  className="text-[20px] font-bold num"
                  style={{ color: usdcR > 0 ? "var(--color-accent-long)" : "var(--color-text-secondary)" }}
                >
                  ${usdcR.toFixed(2)}
                </div>
                <div className="text-[11px] text-text-tertiary mt-1">USDC revenue</div>
              </div>
            </div>
          </div>
        </div>

        {/* Action triggers */}
        {hasRewards && (
          <div
            className="mx-6 mb-4 px-4 py-3 flex items-center gap-2.5 rounded-xl"
            style={{ background: "rgba(0,210,106,0.04)", border: "1px solid rgba(0,210,106,0.1)" }}
          >
            <span
              className="w-2 h-2 rounded-full"
              style={{
                background: "var(--color-accent-long)",
                animation: "pulseDot 2s infinite",
                boxShadow: "0 0 6px rgba(0,210,106,0.4)",
              }}
            />
            <span className="text-[12px] font-medium" style={{ color: "var(--color-accent-long)" }}>
              Rewards waiting to be claimed
            </span>
          </div>
        )}

        {nextTier && toNext > 0 && toNext < staked * 0.2 && !hasRewards && (
          <div
            className="mx-6 mb-4 px-4 py-3 flex items-center gap-2.5 rounded-xl"
            style={{ background: "rgba(51,201,161,0.03)", border: "1px solid rgba(51,201,161,0.08)" }}
          >
            <span
              className="w-2 h-2 rounded-full"
              style={{ background: "var(--color-brand-teal)", boxShadow: "0 0 6px rgba(51,201,161,0.4)" }}
            />
            <span className="text-[12px] font-medium" style={{ color: "var(--color-brand-teal)" }}>
              You&apos;re close to {String(nextTier.name)}!
            </span>
          </div>
        )}

        {/* Action buttons — premium pill style */}
        {onAction && (
          <div className="flex flex-wrap gap-2 px-6 py-4" style={{ borderTop: "1px solid rgba(51,201,161,0.04)" }}>
            {[
              { label: "Stake FAF", intent: "I want to stake FAF tokens" },
              { label: "Claim Rewards", intent: "claim my faf rewards" },
              { label: "VIP Tiers", intent: "show me the vip tiers" },
              { label: "Unstake", intent: "I want to unstake FAF" },
              { label: "Requests", intent: "show my unstake requests" },
            ].map((opt) => (
              <button
                key={opt.label}
                onClick={() => onAction(opt.intent)}
                className="px-4 py-2 rounded-xl text-[12px] font-medium cursor-pointer
                  transition-all duration-150 hover:scale-[1.03] hover:-translate-y-[1px] active:scale-[0.97]"
                style={{
                  background: "rgba(51,201,161,0.05)",
                  border: "1px solid rgba(51,201,161,0.12)",
                  color: "var(--color-brand-cyan)",
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── STAKE PREVIEW ──
  if (type === "faf_stake_preview") {
    const amount = safe(data.amount as number);
    const newTier = String(data.newTier ?? "None");
    const newDiscount = safe(data.newFeeDiscount as number);
    const tierChanged = data.tierChanged as boolean;

    return (
      <div className="glass-card-solid overflow-hidden">
        <div className="px-5 py-4">
          <div className="text-[11px] uppercase tracking-wider text-text-tertiary mb-1">You are staking</div>
          <div className="text-[22px] font-bold num text-text-primary">{amount.toLocaleString()} FAF</div>
        </div>
        <div className="grid grid-cols-2 gap-px" style={{ background: "var(--color-border-subtle)" }}>
          <Cell label="Current Stake" value={`${safe(data.currentStake as number).toLocaleString()} FAF`} />
          <Cell label="New Stake" value={`${safe(data.newStake as number).toLocaleString()} FAF`} />
          <Cell label="New Tier" value={newTier} color={tierChanged ? "var(--color-accent-lime)" : undefined} />
          <Cell label="Fee Discount" value={`${newDiscount}%`} />
        </div>
        {tierChanged && (
          <div
            className="px-5 py-3 text-[12px] text-accent-lime"
            style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}
          >
            Tier upgrade! You&apos;ll reach {newTier} with this stake.
          </div>
        )}
        <div className="flex" style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
          <button
            onClick={() => executeFafAction("stake", { amount })}
            disabled={!walletAddress}
            className="btn-primary flex-1 py-3.5 text-[14px] font-bold cursor-pointer disabled:opacity-25"
            style={{ color: "#070A0F", background: "var(--color-accent-lime)", borderRadius: "0 0 16px 16px" }}
          >
            Confirm Stake
          </button>
        </div>
      </div>
    );
  }

  // ── UNSTAKE PREVIEW ──
  if (type === "faf_unstake_preview") {
    const amount = safe(data.amount as number);

    return (
      <div className="glass-card-solid overflow-hidden">
        <div className="px-5 py-4">
          <div className="text-[11px] uppercase tracking-wider text-text-tertiary mb-1">You are unstaking</div>
          <div className="text-[22px] font-bold num text-text-primary">{amount.toLocaleString()} FAF</div>
        </div>
        <div className="grid grid-cols-2 gap-px" style={{ background: "var(--color-border-subtle)" }}>
          <Cell label="Remaining Stake" value={`${safe(data.remainingStake as number).toLocaleString()} FAF`} />
          <Cell label="New Tier" value={String(data.newTier ?? "None")} />
          <Cell label="Lock Period" value="90 days" color="var(--color-accent-warn)" />
          <Cell label="Unlock Date" value={String(data.unlockDate ?? "")} />
        </div>
        <div className="px-5 py-3 flex items-start gap-2" style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--color-accent-warn)"
            strokeWidth="2"
            className="mt-0.5 shrink-0"
          >
            <path d="M12 9v4M12 17h.01" />
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
          <span className="text-[12px] text-accent-warn leading-relaxed">{String(data.warning)}</span>
        </div>
        <div className="flex" style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
          <button
            onClick={() => executeFafAction("unstake", { amount })}
            disabled={!walletAddress}
            className="btn-primary flex-1 py-3.5 text-[14px] font-bold cursor-pointer disabled:opacity-25"
            style={{ color: "#070A0F", background: "var(--color-accent-warn)", borderRadius: "0 0 16px 16px" }}
          >
            Confirm Unstake (90-day lock)
          </button>
        </div>
      </div>
    );
  }

  // ── CLAIM PREVIEW ──
  if (type === "faf_claim_preview") {
    const fafR = safe(data.fafRewards as number);
    const usdcR = safe(data.usdcRevenue as number);
    const claimType = String(data.claim_type ?? "all");

    return (
      <div className="glass-card-solid overflow-hidden">
        <div className="px-5 py-4">
          <div className="text-[15px] font-semibold text-text-primary">Claim Rewards</div>
        </div>
        <div className="grid grid-cols-2 gap-px" style={{ background: "var(--color-border-subtle)" }}>
          {fafR > 0 && <Cell label="FAF Rewards" value={`${fafR.toFixed(4)} FAF`} color="var(--color-accent-long)" />}
          {usdcR > 0 && <Cell label="USDC Revenue" value={`$${usdcR.toFixed(2)}`} color="var(--color-accent-long)" />}
        </div>
        <div className="flex" style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
          {(claimType === "all" || claimType === "rewards") && fafR > 0 && (
            <button
              onClick={() => executeFafAction("claim_rewards")}
              disabled={!walletAddress}
              className="btn-primary flex-1 py-3 text-[13px] font-bold cursor-pointer disabled:opacity-25"
              style={{
                color: "#070A0F",
                background: "var(--color-accent-lime)",
                borderRadius: usdcR > 0 ? "0" : "0 0 16px 16px",
              }}
            >
              Claim FAF
            </button>
          )}
          {(claimType === "all" || claimType === "revenue") && usdcR > 0 && (
            <button
              onClick={() => executeFafAction("claim_revenue")}
              disabled={!walletAddress}
              className="btn-primary flex-1 py-3 text-[13px] font-bold cursor-pointer disabled:opacity-25"
              style={{
                color: "#070A0F",
                background: "var(--color-accent-blue)",
                borderRadius: fafR > 0 ? "0 0 16px 0" : "0 0 16px 16px",
              }}
            >
              Claim USDC
            </button>
          )}
        </div>
      </div>
    );
  }

  // ── REQUESTS LIST ──
  if (type === "faf_requests") {
    const requests = (data.requests as Record<string, unknown>[]) ?? [];
    if (requests.length === 0)
      return (
        <div className="glass-card-solid overflow-hidden px-5 py-5">
          <div className="text-[14px] text-text-secondary">No pending unstake requests.</div>
        </div>
      );

    return (
      <div className="glass-card-solid overflow-hidden">
        <div className="px-5 py-4">
          <div className="text-[15px] font-semibold text-text-primary">Unstake Requests</div>
          <div className="text-[12px] text-text-tertiary">{requests.length} pending</div>
        </div>
        {requests.map((req, i) => {
          const locked = safe(req.lockedAmount as number);
          const withdrawable = safe(req.withdrawableAmount as number);
          const progress = safe(req.progressPercent as number);
          const timeLeft = safe(req.timeRemainingSeconds as number);
          const daysLeft = Math.ceil(timeLeft / 86400);

          return (
            <div key={i} className="px-5 py-3" style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[13px] font-medium text-text-primary">
                  #{i} · {(locked + withdrawable).toFixed(2)} FAF
                </span>
                <span className="text-[11px] num text-text-tertiary">
                  {daysLeft > 0 ? `${daysLeft}d left` : "Unlocked"}
                </span>
              </div>
              <div
                className="w-full h-1.5 rounded-full overflow-hidden mb-2"
                style={{ background: "rgba(255,255,255,0.06)" }}
              >
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${progress}%`,
                    background: progress >= 100 ? "var(--color-accent-long)" : "var(--color-accent-blue)",
                    transition: "width 300ms",
                  }}
                />
              </div>
              <div className="flex items-center justify-between text-[11px] text-text-tertiary">
                <span>{progress}% unlocked</span>
                {progress < 100 && (
                  <button
                    onClick={() => executeFafAction("cancel_unstake", { index: i })}
                    disabled={!walletAddress}
                    className="text-accent-short hover:underline cursor-pointer"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  // ── CANCEL PREVIEW ──
  if (type === "faf_cancel_preview") {
    const amount = safe(data.amount as number);
    const idx = safe(data.index as number);

    return (
      <div className="glass-card-solid overflow-hidden">
        <div className="px-5 py-4">
          <div className="text-[15px] font-semibold text-text-primary">Cancel Unstake Request #{idx}</div>
          <div className="text-[13px] text-text-tertiary mt-1">
            {amount.toFixed(2)} FAF will be returned to your active stake.
          </div>
        </div>
        <div className="flex" style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
          <button
            onClick={() => executeFafAction("cancel_unstake", { index: idx })}
            disabled={!walletAddress}
            className="btn-primary flex-1 py-3.5 text-[14px] font-bold cursor-pointer disabled:opacity-25"
            style={{ color: "#070A0F", background: "var(--color-accent-lime)", borderRadius: "0 0 16px 16px" }}
          >
            Confirm Cancel → Re-stake
          </button>
        </div>
      </div>
    );
  }

  // ── TIERS ──
  if (type === "faf_tiers") {
    const tiers = (data.tiers as Record<string, unknown>[]) ?? [];
    const currentLevel = safe(data.currentLevel as number);
    const staked = safe(data.stakedAmount as number);

    return (
      <div className="glass-card-solid overflow-hidden">
        <div className="px-5 py-4">
          <div className="text-[15px] font-semibold text-text-primary">VIP Tiers</div>
          <div className="text-[12px] text-text-tertiary">You have {staked.toLocaleString()} FAF staked</div>
        </div>
        {tiers.map((t, i) => {
          const level = safe(t.level as number);
          const name = String(t.name ?? `Level ${level}`);
          const req = safe(t.fafRequired as number);
          const discount = safe(t.feeDiscount as number);
          const isActive = level === currentLevel;

          return (
            <div
              key={i}
              className="flex items-center justify-between px-5 py-2.5"
              style={{
                borderTop: "1px solid rgba(255,255,255,0.04)",
                background: isActive ? "rgba(51,201,161,0.04)" : "transparent",
              }}
            >
              <div className="flex items-center gap-2">
                {isActive && (
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--color-accent-lime)" }} />
                )}
                <span className={`text-[13px] ${isActive ? "font-semibold text-text-primary" : "text-text-secondary"}`}>
                  {name}
                </span>
              </div>
              <div className="flex items-center gap-4 text-[11px] num text-text-tertiary">
                <span>{req > 0 ? `${(req / 1000).toFixed(0)}K FAF` : "Free"}</span>
                <span className="w-12 text-right">{discount}% off</span>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  // Fallback
  return (
    <div className="text-[13px] text-text-secondary py-1.5">
      {toolName}: {output.status === "success" ? "Done" : (output.error ?? "Error")}
    </div>
  );
});

export { FafCard };
export default FafCard;
