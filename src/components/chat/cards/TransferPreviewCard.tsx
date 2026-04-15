"use client";

import { memo, useState, useRef } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useFlashStore } from "@/store";
import { ToolError, TxSuccessCard } from "./shared";
import type { ToolOutput } from "./types";

// ---- Address Intelligence ----
const KNOWN_ADDRESSES: Record<string, { label: string; type: "cex" | "protocol" | "bridge" }> = {
  // Major CEX hot wallets (Solana)
  "5tzFkiKscjHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9": { label: "Binance", type: "cex" },
  "2AQdpHJ2JpcEgPiATUXjQxA8QmafFegfQwSLWSprPicm": { label: "Coinbase", type: "cex" },
  ASTyfSima4LLAdDgoFGkgqoKowG1LZFDr9fAQrg7iaJZ: { label: "FTX (Inactive)", type: "cex" },
  HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH: { label: "Kraken", type: "cex" },
  "4wBqpZM9xaSheekzYoGKNteMCRPqBKKCbuMgmuKn3R2V": { label: "OKX", type: "cex" },
  GJRs4FwHtemZ5ZE9x3FNvJ8TMwitKTh21yxdRPqn7npE: { label: "Bybit", type: "cex" },
};

function getAddressLabel(addr: string): { label: string; type: string } | null {
  const known = KNOWN_ADDRESSES[addr];
  if (known) return known;
  // Check localStorage contacts
  try {
    const contacts = JSON.parse(localStorage.getItem("flash_contacts") ?? "{}");
    if (contacts[addr]) return { label: contacts[addr], type: "contact" };
  } catch {}
  return null;
}

function getRecentRecipients(): { address: string; label: string; lastUsed: number }[] {
  try {
    return JSON.parse(localStorage.getItem("flash_recent_recipients") ?? "[]");
  } catch {
    return [];
  }
}

function saveRecentRecipient(address: string, label: string) {
  try {
    const recents = getRecentRecipients().filter((r) => r.address !== address);
    recents.unshift({ address, label, lastUsed: Date.now() });
    localStorage.setItem("flash_recent_recipients", JSON.stringify(recents.slice(0, 10)));
  } catch {}
}

// ---- Transfer History (localStorage) ----
interface TransferRecord {
  token: string;
  amount: number;
  recipient: string;
  recipientLabel: string | null;
  txSignature: string;
  timestamp: number;
  status: "success" | "failed";
}

function saveTransferHistory(record: TransferRecord) {
  try {
    const key = "flash_transfer_history";
    const history: TransferRecord[] = JSON.parse(localStorage.getItem(key) ?? "[]");
    history.unshift(record);
    // Keep last 100 transfers
    localStorage.setItem(key, JSON.stringify(history.slice(0, 100)));
  } catch {}
}

function humanizeError(raw: string): { message: string; suggestion: string } {
  const lower = raw.toLowerCase();
  if (lower.includes("insufficient sol"))
    return {
      message: "You don't have enough SOL to complete this transfer.",
      suggestion: "Deposit more SOL or reduce the amount.",
    };
  if (lower.includes("insufficient"))
    return {
      message: "You don't have enough tokens to complete this transfer.",
      suggestion: "Check your balance and try a smaller amount.",
    };
  if (lower.includes("simulation failed"))
    return {
      message: "This transaction would fail on-chain.",
      suggestion: "The token may have transfer restrictions. Try a smaller amount or check the token.",
    };
  if (lower.includes("rejected"))
    return {
      message: "You cancelled the transaction in your wallet.",
      suggestion: "Click Confirm Transfer to try again.",
    };
  if (lower.includes("wallet not available"))
    return { message: "Your wallet isn't connected.", suggestion: "Connect your wallet and try again." };
  if (lower.includes("frozen"))
    return {
      message: "This token account is frozen by the token issuer.",
      suggestion: "Contact the token issuer or check their announcements.",
    };
  return { message: raw, suggestion: "Try again or contact support if this persists." };
}

const TransferPreviewCard = memo(function TransferPreviewCard({ output }: { output: ToolOutput }) {
  const [status, setStatus] = useState<"preview" | "executing" | "signing" | "confirming" | "success" | "error">(
    "preview",
  );
  const [txSig, setTxSig] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<"addr" | "tx" | null>(null);
  const [confirmInput, setConfirmInput] = useState("");
  const walletAddress = useFlashStore((s) => s.walletAddress);
  const { signTransaction: walletSignTransaction } = useWallet();
  // Execution lock — prevents double-click across renders
  const executionLockRef = useRef(false);
  // Attempt counter — ensures each retry gets a fresh blockhash (not stale cache)
  const attemptRef = useRef(0);

  const data = output.data as {
    token: string;
    token_name: string;
    amount: number;
    amount_display: string;
    recipient: string;
    recipient_short: string;
    sender: string;
    sender_short: string;
    estimated_fee_sol: number;
    needs_ata: boolean;
    ata_fee_sol: number;
    total_fee_sol: number;
    mint: string | null;
    mint_short: string | null;
    decimals: number;
    is_native_sol: boolean;
    is_verified: boolean;
    sender_balance?: number;
    warnings: string[];
  } | null;

  if (!data) return <ToolError toolName="transfer_preview" error={output.error} />;

  // Address intelligence
  const recipientLabel = getAddressLabel(data.recipient);
  const recipientDisplay = recipientLabel?.label ?? data.recipient_short;
  const recentMatch = getRecentRecipients().find((r) => r.address === data.recipient);
  const isFirstTime = !recentMatch && !recipientLabel;

  // Balance impact
  const balanceImpactPct =
    data.sender_balance && data.sender_balance > 0 ? Math.round((data.amount / data.sender_balance) * 100) : null;
  const requiresTypeConfirm = balanceImpactPct !== null && balanceImpactPct >= 80;

  // Risk signals
  const risks: { level: "warn" | "caution"; message: string }[] = [];
  if (!data.is_verified && !data.is_native_sol) {
    risks.push({ level: "warn", message: "This token is not verified. Double-check the mint address." });
  }
  if (isFirstTime) {
    risks.push({ level: "caution", message: "First time sending to this address." });
  }
  if (balanceImpactPct !== null && balanceImpactPct >= 80) {
    risks.push({ level: "warn", message: `You're sending ${balanceImpactPct}% of your ${data.token} balance.` });
  } else if (balanceImpactPct !== null && balanceImpactPct >= 50) {
    risks.push({ level: "caution", message: `This is ${balanceImpactPct}% of your ${data.token} balance.` });
  }
  for (const w of data.warnings) {
    if (w.toLowerCase().includes("large") || w.includes("verified")) continue; // already handled above
    if (!w.includes("ATA") || data.needs_ata) {
      risks.push({ level: "caution", message: w });
    }
  }

  function copyToClipboard(text: string, type: "addr" | "tx") {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(type);
    setTimeout(() => setCopied(null), 2000);
  }

  async function handleConfirm() {
    // Lock FIRST to prevent any race condition
    if (executionLockRef.current || status !== "preview" || !walletAddress) return;
    executionLockRef.current = true;

    // Verify wallet hasn't changed since preview
    if (walletAddress !== data!.sender) {
      executionLockRef.current = false;
      setError("Wallet changed since preview. Please request a new transfer preview.");
      setStatus("error");
      return;
    }

    attemptRef.current++;
    setStatus("executing");
    setError(null);

    // Idempotency key: stable within same click (prevents double-click),
    // but changes on retry (ensures fresh blockhash after error)
    const requestId = `txf_${data!.sender.slice(0, 6)}_${data!.recipient.slice(0, 6)}_${data!.amount}_${attemptRef.current}`;

    try {
      // Step 1: Build unsigned transaction (idempotent)
      const buildController = new AbortController();
      const buildTimer = setTimeout(() => buildController.abort(), 15000);

      const buildResp = await fetch("/api/transfer/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sender: data!.sender,
          recipient: data!.recipient,
          token: data!.token,
          amount: data!.amount,
          mint: data!.mint,
          decimals: data!.decimals,
          is_native_sol: data!.is_native_sol,
          is_token2022: (data as Record<string, unknown>).is_token2022 ?? false,
          request_id: requestId,
        }),
        signal: buildController.signal,
      }).finally(() => clearTimeout(buildTimer));

      const buildJson = await buildResp.json().catch(() => null);
      if (!buildResp.ok || !buildJson) {
        throw new Error(buildJson?.error ?? "Failed to build transaction");
      }

      const txBase64 = buildJson.transaction;
      if (!txBase64 || typeof txBase64 !== "string") {
        throw new Error("Server returned invalid transaction data");
      }

      // Step 2: Sign with wallet (60s timeout)
      setStatus("signing");

      const { VersionedTransaction } = await import("@solana/web3.js");
      const txBytes = Uint8Array.from(atob(txBase64), (c) => c.charCodeAt(0));
      const tx = VersionedTransaction.deserialize(txBytes);

      // Sign via wallet adapter (properly authorized by the connected wallet)
      if (!walletSignTransaction) {
        throw new Error("Wallet not available. Please connect your wallet.");
      }

      const signed = await walletSignTransaction(tx);

      if (!signed || typeof signed.serialize !== "function") {
        throw new Error("Wallet returned invalid signed transaction");
      }

      // CRITICAL FIX: Chunked base64 encoding (no spread operator overflow)
      const signedBytes = signed.serialize();
      let signedBase64 = "";
      const CHUNK = 8192;
      for (let i = 0; i < signedBytes.length; i += CHUNK) {
        const slice = signedBytes.subarray(i, Math.min(i + CHUNK, signedBytes.length));
        signedBase64 += String.fromCharCode(...slice);
      }
      signedBase64 = btoa(signedBase64);

      // Step 3: Broadcast
      const broadcastController = new AbortController();
      const broadcastTimer = setTimeout(() => broadcastController.abort(), 20000);

      const broadcastResp = await fetch("/api/broadcast", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-wallet-address": data!.sender,
        },
        body: JSON.stringify({ transaction: signedBase64 }),
        signal: broadcastController.signal,
      }).finally(() => clearTimeout(broadcastTimer));

      const broadcastJson = await broadcastResp.json().catch(() => null);
      if (!broadcastResp.ok || !broadcastJson) {
        throw new Error("Failed to broadcast transaction");
      }

      // Validate signature format
      const sig = broadcastJson.signature;
      if (!sig || typeof sig !== "string" || sig.length < 80) {
        throw new Error("Broadcast returned invalid signature");
      }

      // Step 4: Wait for on-chain confirmation (poll getSignatureStatuses)
      // Never show "Confirmed on-chain" until actually confirmed
      setTxSig(sig);
      setStatus("confirming");

      const { Connection } = await import("@solana/web3.js");
      const conn = new Connection(`${window.location.origin}/api/rpc`, "confirmed");

      let confirmed = false;
      const confirmStart = Date.now();
      const CONFIRM_TIMEOUT = 45_000;
      const POLL_MS = 2_000;

      while (Date.now() - confirmStart < CONFIRM_TIMEOUT) {
        try {
          const { value } = await conn.getSignatureStatuses([sig]);
          const s = value[0];
          if (s?.err) {
            throw new Error("Transaction failed on-chain. Check Solscan for details.");
          }
          if (s?.confirmationStatus === "confirmed" || s?.confirmationStatus === "finalized") {
            confirmed = true;
            break;
          }
        } catch (pollErr) {
          if (pollErr instanceof Error && pollErr.message.includes("failed on-chain")) throw pollErr;
        }
        await new Promise((r) => setTimeout(r, POLL_MS));
      }

      if (confirmed) {
        setStatus("success");
        // Only save as success when ACTUALLY confirmed on-chain
        saveRecentRecipient(data!.recipient, recipientLabel?.label ?? data!.recipient_short);
        saveTransferHistory({
          token: data!.token,
          amount: data!.amount,
          recipient: data!.recipient,
          recipientLabel: recipientLabel?.label ?? null,
          txSignature: sig,
          timestamp: Date.now(),
          status: "success",
        });
      } else {
        // Tx broadcast but NOT confirmed — show honest error, not false success
        throw new Error(
          "Transaction was broadcast but not confirmed within 30 seconds. " +
            "It may still land — check Solscan before retrying. Signature: " +
            sig.slice(0, 12) +
            "...",
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Transfer failed";
      setError(msg);
      setStatus("error");
    } finally {
      executionLockRef.current = false;
    }
  }

  // ======== SUCCESS STATE ========
  if (status === "success" && txSig) {
    return (
      <TxSuccessCard label={`${data.amount_display} sent to ${recipientDisplay}`} signature={txSig} variant="long" />
    );
  }

  // ======== ERROR STATE ========
  if (status === "error" && error) {
    const { message, suggestion } = humanizeError(error);
    return (
      <div className="glass-card-solid overflow-hidden" style={{ borderColor: "rgba(255,77,77,0.15)" }}>
        <div className="px-5 py-5 flex items-start gap-3">
          <span
            className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 mt-0.5"
            style={{ background: "rgba(255,77,77,0.1)", border: "1px solid rgba(255,77,77,0.2)" }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--color-accent-short)"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
          </span>
          <div>
            <div className="text-[14px] font-semibold text-text-primary mb-1">Transfer Failed</div>
            <div className="text-[13px] text-text-secondary leading-relaxed">{message}</div>
            <div className="text-[12px] text-text-tertiary mt-2">{suggestion}</div>
          </div>
        </div>
        <div className="flex border-t" style={{ borderColor: "rgba(255,255,255,0.04)" }}>
          <button
            onClick={() => {
              setStatus("preview");
              setError(null);
            }}
            className="btn-secondary flex-1 py-3 text-[13px] font-semibold text-text-secondary cursor-pointer hover:text-text-primary transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  // ======== PREVIEW STATE ========
  return (
    <div className="glass-card-solid overflow-hidden">
      {/* ---- Header: "You are sending..." ---- */}
      <div className="px-5 pt-5 pb-4">
        <div className="flex items-center gap-3 mb-4">
          <span
            className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
            style={{ background: "rgba(59,130,246,0.1)", border: "1px solid rgba(59,130,246,0.15)" }}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--color-accent-blue)"
              strokeWidth="1.8"
              strokeLinecap="round"
            >
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </span>
          <div>
            <div
              className="text-[11px] font-semibold tracking-wider uppercase"
              style={{ color: "var(--color-text-tertiary)" }}
            >
              You are sending
            </div>
            <div className="text-[22px] font-bold tracking-tight num text-text-primary leading-tight mt-0.5">
              {data.amount_display}
            </div>
          </div>
        </div>

        {/* ---- Transfer flow visualization ---- */}
        <div className="flex items-center gap-3 px-1">
          {/* From */}
          <div
            className="flex-1 rounded-xl px-3.5 py-2.5"
            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}
          >
            <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: "var(--color-text-tertiary)" }}>
              From
            </div>
            <div className="text-[13px] font-mono font-medium text-text-primary">{data.sender_short}</div>
          </div>

          {/* Arrow */}
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--color-text-tertiary)"
            strokeWidth="1.5"
            strokeLinecap="round"
            className="shrink-0"
          >
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>

          {/* To */}
          <div
            className="flex-1 rounded-xl px-3.5 py-2.5"
            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}
          >
            <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: "var(--color-text-tertiary)" }}>
              To
            </div>
            <div className="text-[13px] font-mono font-medium text-text-primary">
              {recipientLabel ? (
                <span className="flex items-center gap-1.5">
                  {recipientLabel.label}
                  {recipientLabel.type === "cex" && (
                    <span
                      className="text-[9px] px-1.5 py-0.5 rounded-full font-sans"
                      style={{ background: "rgba(59,130,246,0.12)", color: "var(--color-accent-blue)" }}
                    >
                      Exchange
                    </span>
                  )}
                </span>
              ) : (
                data.recipient_short
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ---- Details ---- */}
      <div className="px-5 py-3" style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
        <div className="flex items-center justify-between py-1.5">
          <span className="text-[12px] text-text-tertiary">Token</span>
          <span className="text-[12px] font-medium text-text-primary flex items-center gap-1.5">
            {data.token_name}
            {data.is_verified ? (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="var(--color-accent-blue)">
                <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            ) : (
              <span
                className="text-[9px] px-1.5 py-0.5 rounded-full"
                style={{ background: "rgba(245,166,35,0.12)", color: "var(--color-accent-warn)" }}
              >
                Unverified
              </span>
            )}
          </span>
        </div>
        {data.mint_short && (
          <div className="flex items-center justify-between py-1.5">
            <span className="text-[12px] text-text-tertiary">Mint</span>
            <span className="text-[11px] font-mono text-text-secondary">{data.mint_short}</span>
          </div>
        )}
        <div className="flex items-center justify-between py-1.5">
          <span className="text-[12px] text-text-tertiary">Network Fee</span>
          <span className="text-[12px] num text-text-secondary">
            {(Number(data.total_fee_sol) || 0).toFixed(6)} SOL
          </span>
        </div>
        {data.needs_ata && (
          <div className="flex items-center justify-between py-1.5">
            <span className="text-[12px] text-text-tertiary">Account Creation</span>
            <span className="text-[12px] num text-text-secondary">
              ~{(Number(data.ata_fee_sol) || 0).toFixed(4)} SOL
            </span>
          </div>
        )}
      </div>

      {/* ---- Risk signals ---- */}
      {risks.length > 0 && (
        <div className="px-5 py-3" style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
          {risks.map((r, i) => (
            <div key={i} className="flex items-start gap-2 mb-1.5 last:mb-0">
              <span
                className="w-4 h-4 rounded-full flex items-center justify-center shrink-0 mt-0.5"
                style={{ background: r.level === "warn" ? "rgba(245,166,35,0.12)" : "rgba(59,130,246,0.12)" }}
              >
                <svg
                  width="8"
                  height="8"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke={r.level === "warn" ? "var(--color-accent-warn)" : "var(--color-accent-blue)"}
                  strokeWidth="3"
                  strokeLinecap="round"
                >
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <circle
                    cx="12"
                    cy="17"
                    r="1"
                    fill={r.level === "warn" ? "var(--color-accent-warn)" : "var(--color-accent-blue)"}
                  />
                </svg>
              </span>
              <span
                className="text-[12px] leading-relaxed"
                style={{ color: r.level === "warn" ? "var(--color-accent-warn)" : "var(--color-text-secondary)" }}
              >
                {r.message}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* ---- Balance impact ---- */}
      {balanceImpactPct !== null && data.sender_balance != null && data.sender_balance > 0 && (
        <div className="px-5 py-3" style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] text-text-tertiary">Balance Impact</span>
            <span
              className="text-[11px] num"
              style={{
                color:
                  balanceImpactPct >= 80
                    ? "var(--color-accent-short)"
                    : balanceImpactPct >= 50
                      ? "var(--color-accent-warn)"
                      : "var(--color-text-secondary)",
              }}
            >
              {balanceImpactPct}% of your {data.token}
            </span>
          </div>
          <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${Math.min(balanceImpactPct, 100)}%`,
                background:
                  balanceImpactPct >= 80
                    ? "var(--color-accent-short)"
                    : balanceImpactPct >= 50
                      ? "var(--color-accent-warn)"
                      : "var(--color-accent-blue)",
              }}
            />
          </div>
          <div className="flex items-center justify-between mt-1.5 text-[10px] num text-text-tertiary">
            <span>
              Before: {data.sender_balance < 1 ? data.sender_balance.toFixed(4) : data.sender_balance.toFixed(2)}{" "}
              {data.token}
            </span>
            <span>
              After:{" "}
              {data.sender_balance - data.amount < 0.0001
                ? "0"
                : (data.sender_balance - data.amount).toFixed(data.sender_balance < 1 ? 4 : 2)}{" "}
              {data.token}
            </span>
          </div>
        </div>
      )}

      {/* ---- Recipient full address (copyable) ---- */}
      <div
        className="px-5 py-3 flex items-center justify-between"
        style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-[10px] text-text-tertiary">Recipient Address</span>
            {recentMatch && <span className="text-[9px] text-text-tertiary">(sent before)</span>}
          </div>
          <div className="text-[11px] font-mono text-text-secondary break-all leading-relaxed">{data.recipient}</div>
        </div>
        <button
          onClick={() => copyToClipboard(data!.recipient, "addr")}
          className="shrink-0 ml-3 w-8 h-8 rounded-lg flex items-center justify-center cursor-pointer transition-all hover:bg-white/[0.05]"
          title="Copy address"
        >
          {copied === "addr" ? (
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--color-accent-long)"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : (
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--color-text-tertiary)"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="9" y="9" width="13" height="13" rx="2" />
              <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
            </svg>
          )}
        </button>
      </div>

      {/* ---- In-flight status ---- */}
      {(status === "executing" || status === "signing" || status === "confirming") && (
        <div className="px-5 py-4 flex items-center gap-3" style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
          <span
            className="w-4 h-4 border-2 border-accent-blue border-t-transparent rounded-full shrink-0"
            style={{ animation: "spin 0.8s linear infinite" }}
          />
          <span className="text-[13px] text-text-secondary">
            {status === "executing"
              ? "Building transaction..."
              : status === "signing"
                ? "Approve in your wallet..."
                : "Confirming on-chain..."}
          </span>
        </div>
      )}

      {/* ---- Confirm section ---- */}
      {status === "preview" && (
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
          {/* Type CONFIRM gate for large transfers */}
          {requiresTypeConfirm && walletAddress && (
            <div className="px-5 pt-3 pb-2">
              <div className="text-[11px] text-text-tertiary mb-2">
                Type <span className="font-bold text-text-secondary">CONFIRM</span> to proceed with this large transfer
              </div>
              <input
                type="text"
                value={confirmInput}
                onChange={(e) => setConfirmInput(e.target.value)}
                placeholder="Type CONFIRM"
                className="w-full px-3 py-2 rounded-lg text-[13px] font-mono bg-transparent outline-none
                  text-text-primary placeholder:text-text-tertiary"
                style={{ border: "1px solid var(--color-border-subtle)" }}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
          )}

          <div className="flex">
            <button
              onClick={handleConfirm}
              disabled={
                !walletAddress ||
                (requiresTypeConfirm && confirmInput.trim().toUpperCase() !== "CONFIRM") ||
                status !== "preview"
              }
              className="btn-primary flex-1 py-4 text-[14px] font-bold tracking-wide cursor-pointer disabled:opacity-25 disabled:cursor-default"
              style={{ color: "#070A0F", background: "var(--color-accent-lime)", borderRadius: "0 0 16px 16px" }}
            >
              {!walletAddress ? "Connect Wallet" : `Send ${data.amount_display} to ${recipientDisplay}`}
            </button>
          </div>

          {/* Trust signal */}
          <div
            className="flex items-center justify-center gap-1.5 py-2 text-[10px]"
            style={{ color: "var(--color-text-tertiary)" }}
          >
            <svg
              width="9"
              height="9"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <rect x="3" y="11" width="18" height="11" rx="2" />
              <path d="M7 11V7a5 5 0 0110 0v4" />
            </svg>
            Executed on-chain via Solana
          </div>
        </div>
      )}
    </div>
  );
});

export { TransferPreviewCard };
export default TransferPreviewCard;
