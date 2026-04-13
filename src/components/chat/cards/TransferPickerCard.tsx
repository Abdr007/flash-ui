"use client";

import { memo, useState } from "react";
import type { ToolOutput } from "./types";

const TransferPickerCard = memo(function TransferPickerCard({
  output,
  onAction,
}: {
  output: ToolOutput;
  onAction?: (cmd: string) => void;
}) {
  const data = output.data as Record<string, unknown> | null;
  const tokens = (data?.tokens ?? ["SOL", "USDC"]) as string[];
  const [token, setToken] = useState(tokens[0] ?? "SOL");
  const [customToken, setCustomToken] = useState("");
  const [showCustom, setShowCustom] = useState(false);
  const [amount, setAmount] = useState("");
  const [address, setAddress] = useState("");

  if (!data) return null;

  const activeToken = showCustom ? customToken : token;
  const isValidAddress = address.length >= 32 && address.length <= 44 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(address);
  const canSend = amount && Number(amount) > 0 && isValidAddress && activeToken.length > 0;

  function handleSend() {
    if (!canSend || !onAction) return;
    onAction(`send ${amount} ${activeToken} to ${address}`);
  }

  return (
    <div className="glass-card-solid overflow-hidden" style={{ animation: "slideUp 200ms ease-out" }}>
      <div className="px-5 py-4">
        <div className="text-[15px] font-semibold text-text-primary mb-4">Transfer Tokens</div>

        {/* Token selector */}
        <div className="flex gap-2 mb-3">
          {tokens.map((t) => (
            <button
              key={t}
              onClick={() => {
                setToken(t);
                setShowCustom(false);
              }}
              className="px-4 py-2 rounded-lg text-[13px] font-medium cursor-pointer transition-all"
              style={{
                background: !showCustom && token === t ? "rgba(51,201,161,0.1)" : "rgba(255,255,255,0.04)",
                border: `1px solid ${!showCustom && token === t ? "rgba(51,201,161,0.2)" : "rgba(255,255,255,0.08)"}`,
                color: !showCustom && token === t ? "var(--color-accent-lime)" : "var(--color-text-secondary)",
              }}
            >
              {t}
            </button>
          ))}
          <button
            onClick={() => setShowCustom(true)}
            className="px-4 py-2 rounded-lg text-[13px] font-medium cursor-pointer transition-all"
            style={{
              background: showCustom ? "rgba(51,201,161,0.1)" : "rgba(255,255,255,0.04)",
              border: `1px solid ${showCustom ? "rgba(51,201,161,0.2)" : "rgba(255,255,255,0.08)"}`,
              color: showCustom ? "var(--color-accent-lime)" : "var(--color-text-tertiary)",
            }}
          >
            Other
          </button>
        </div>

        {/* Custom token input */}
        {showCustom && (
          <div className="mb-3">
            <label className="text-[11px] uppercase tracking-wider text-text-tertiary mb-1.5 block">
              Token symbol or mint
            </label>
            <input
              type="text"
              value={customToken}
              onChange={(e) => setCustomToken(e.target.value)}
              placeholder="e.g. BONK or mint address"
              autoFocus
              className="w-full px-3 py-2.5 rounded-lg text-[14px] font-mono text-text-primary placeholder:text-text-tertiary outline-none"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
            />
          </div>
        )}

        {/* Amount input */}
        <div className="mb-3">
          <label className="text-[11px] uppercase tracking-wider text-text-tertiary mb-1.5 block">Amount</label>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={`0.00 ${token}`}
            className="w-full px-3 py-2.5 rounded-lg text-[14px] font-mono text-text-primary placeholder:text-text-tertiary outline-none"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
            onKeyDown={(e) => e.key === "Enter" && document.getElementById("transfer-address")?.focus()}
          />
        </div>

        {/* Address input */}
        <div className="mb-4">
          <label className="text-[11px] uppercase tracking-wider text-text-tertiary mb-1.5 block">
            Recipient wallet
          </label>
          <input
            id="transfer-address"
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Solana wallet address"
            className="w-full px-3 py-2.5 rounded-lg text-[14px] font-mono text-text-primary placeholder:text-text-tertiary outline-none"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
            onKeyDown={(e) => e.key === "Enter" && canSend && handleSend()}
          />
        </div>
      </div>

      {/* Send button */}
      <button
        onClick={handleSend}
        disabled={!canSend}
        className="w-full py-3.5 text-[14px] font-bold cursor-pointer transition-all disabled:opacity-30 disabled:cursor-default"
        style={{
          background: canSend ? "var(--color-accent-lime)" : "rgba(51,201,161,0.1)",
          color: canSend ? "#0a0a0a" : "var(--color-text-tertiary)",
        }}
      >
        Send {amount || "0"} {activeToken}
      </button>
    </div>
  );
});

export { TransferPickerCard };
export default TransferPickerCard;
