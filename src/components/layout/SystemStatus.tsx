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
    <div className="flex items-center gap-3 px-4 h-9 shrink-0 bg-bg-root text-[11px]">
      {/* Logo / Name */}
      <span className="font-semibold text-text-primary tracking-wide">FLASH</span>

      {/* Stream status */}
      <div className="flex items-center gap-1.5">
        <span
          className="w-1.5 h-1.5 rounded-full"
          style={{
            background: streamStatus === "connected" ? "var(--color-accent-long)" : streamStatus === "reconnecting" ? "var(--color-accent-warn)" : "var(--color-text-tertiary)",
            animation: streamStatus === "connected" ? "livePulse 2s infinite" : "none",
          }}
        />
        <span className="text-text-tertiary uppercase tracking-wider">
          {streamStatus === "connected" ? "LIVE" : streamStatus === "reconnecting" ? "RECONN" : "OFFLINE"}
        </span>
      </div>

      <div className="flex-1" />

      {/* Wallet */}
      <button
        onClick={handleWallet}
        className="flex items-center gap-1.5 text-[11px] tracking-wide cursor-pointer transition-colors hover:text-text-primary"
        style={{ color: walletConnected ? "var(--color-accent-long)" : "var(--color-text-tertiary)" }}
      >
        <span
          className="w-1.5 h-1.5 rounded-full"
          style={{ background: walletConnected ? "var(--color-accent-long)" : "var(--color-text-tertiary)" }}
        />
        {walletConnected
          ? `${walletAddress?.slice(0, 4)}..${walletAddress?.slice(-4)}`
          : "CONNECT"}
      </button>
    </div>
  );
}
