"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useFlashStore } from "@/store";

export default function SystemStatus() {
  const walletConnected = useFlashStore((s) => s.walletConnected);
  const walletAddress = useFlashStore((s) => s.walletAddress);
  const streamStatus = useFlashStore((s) => s.streamStatus);
  const { disconnect } = useWallet();
  const { setVisible } = useWalletModal();

  const handleWallet = () => {
    if (walletConnected) disconnect();
    else setVisible(true);
  };

  return (
    <div className="flex items-center gap-3 px-4 h-12 shrink-0 bg-bg-root"
      style={{ borderBottom: "1px solid var(--color-border-subtle)" }}>
      {/* Logo */}
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center"
          style={{ background: "var(--color-accent-lime)" }}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
            <path d="M3 12L8 3L13 12H3Z" fill="#080B10" fillOpacity="0.9" />
          </svg>
        </div>
        <span className="text-[15px] font-bold text-text-primary tracking-tight">Flash</span>
      </div>

      {/* Stream status */}
      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md"
        style={{ background: streamStatus === "connected" ? "rgba(0,210,106,0.06)" : "rgba(68,81,96,0.08)" }}>
        <span
          className="w-1.5 h-1.5 rounded-full"
          style={{
            background: streamStatus === "connected" ? "var(--color-accent-long)" : streamStatus === "reconnecting" ? "var(--color-accent-warn)" : "var(--color-text-tertiary)",
            animation: streamStatus === "connected" ? "livePulse 2s infinite" : "none",
          }}
        />
        <span className="text-[11px] font-medium tracking-wide"
          style={{ color: streamStatus === "connected" ? "var(--color-accent-long)" : "var(--color-text-tertiary)" }}>
          {streamStatus === "connected" ? "Live" : streamStatus === "reconnecting" ? "Reconnecting" : "Offline"}
        </span>
      </div>

      <div className="flex-1" />

      {/* Wallet */}
      <button
        onClick={handleWallet}
        className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-[12px] font-semibold cursor-pointer transition-all duration-100"
        style={{
          background: walletConnected
            ? "var(--color-bg-card)"
            : "var(--color-accent-lime)",
          color: walletConnected ? "var(--color-accent-long)" : "#080B10",
          border: `1px solid ${walletConnected ? "var(--color-border-subtle)" : "transparent"}`,
        }}
      >
        {walletConnected ? (
          <>
            <span className="w-2 h-2 rounded-full bg-accent-long" />
            <span className="font-mono text-[12px]">
              {walletAddress?.slice(0, 4)}...{walletAddress?.slice(-4)}
            </span>
          </>
        ) : (
          <span className="font-semibold">Connect Wallet</span>
        )}
      </button>
    </div>
  );
}
