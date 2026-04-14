"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useFlashStore } from "@/store";

export default function SystemStatus() {
  const walletConnected = useFlashStore((s) => s.walletConnected);
  const walletAddress = useFlashStore((s) => s.walletAddress);
  const { disconnect } = useWallet();
  const { setVisible } = useWalletModal();

  const handleWallet = () => {
    if (walletConnected) disconnect();
    else setVisible(true);
  };

  return (
    <div
      className="relative flex items-center justify-between px-4 sm:px-5 h-12 shrink-0"
      style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}
    >
      {/* Brand — left */}
      <div className="flex items-center gap-2.5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/ft-logo.svg" alt="Flash Terminal" width={24} height={24} className="rounded-full" />
        <span className="text-[14px] font-bold tracking-tight" style={{ color: "rgba(255,255,255,0.85)" }}>
          Flash Terminal
        </span>
      </div>

      {/* Wallet — right */}
      {walletConnected ? (
        <button
          onClick={handleWallet}
          className="flex items-center gap-2 px-3.5 py-1.5 rounded-full text-[12px] font-semibold cursor-pointer shrink-0 transition-all duration-200 hover:border-[rgba(51,201,161,0.3)] hover:shadow-[0_0_20px_-4px_rgba(51,201,161,0.15)]"
          style={{
            background: "rgba(51, 201, 161, 0.06)",
            color: "var(--color-text-primary)",
            border: "1px solid rgba(51, 201, 161, 0.12)",
          }}
        >
          <span
            className="w-[6px] h-[6px] rounded-full"
            style={{
              background: "var(--color-brand-teal)",
              boxShadow: "0 0 6px rgba(51, 201, 161, 0.5)",
              animation: "livePulse 2s ease-in-out infinite",
            }}
          />
          <span className="font-mono">
            {walletAddress?.slice(0, 4)}...{walletAddress?.slice(-4)}
          </span>
        </button>
      ) : (
        <button onClick={handleWallet} className="btn-cta px-5 py-2 text-[12px] font-bold glow-pulse shrink-0">
          Connect Wallet
        </button>
      )}
    </div>
  );
}
