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
    <div className="flex items-center gap-3 px-5 h-14 shrink-0 bg-bg-root">
      {/* Logo */}
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-xl flex items-center justify-center"
          style={{ background: "linear-gradient(135deg, #3B82F6, #8B5CF6)" }}>
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
            <path d="M3 12L8 3L13 12H3Z" fill="white" fillOpacity="0.9" />
          </svg>
        </div>
        <span className="text-[16px] font-semibold text-text-primary tracking-tight">Flash</span>
      </div>

      {/* Stream status */}
      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full"
        style={{ background: streamStatus === "connected" ? "rgba(16,185,129,0.08)" : "rgba(68,81,96,0.12)" }}>
        <span
          className="w-2 h-2 rounded-full"
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
        className="flex items-center gap-2 px-4 py-2 rounded-full text-[13px] font-medium cursor-pointer transition-all duration-150"
        style={{
          background: walletConnected
            ? "rgba(16,185,129,0.08)"
            : "var(--color-accent-lime)",
          color: walletConnected ? "var(--color-accent-long)" : "#0A0E13",
          border: walletConnected ? "1px solid rgba(16,185,129,0.15)" : "none",
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
