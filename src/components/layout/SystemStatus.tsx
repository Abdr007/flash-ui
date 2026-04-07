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
    <div className="flex items-center gap-3 px-5 h-14 shrink-0">
      {/* Logo */}
      <div className="flex items-center gap-2.5">
        <div
          className="w-8 h-8 rounded-xl flex items-center justify-center"
          style={{ background: "var(--color-accent-lime)" }}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M3 12L8 3L13 12H3Z" fill="#070A0F" fillOpacity="0.9" />
          </svg>
        </div>
        <span className="text-[16px] font-bold text-text-primary tracking-tight">
          Flash
        </span>
      </div>

      <div className="flex-1" />

      {/* Wallet */}
      <button
        onClick={handleWallet}
        className="flex items-center gap-2.5 px-4 py-2 rounded-xl text-[13px] font-semibold cursor-pointer
          transition-all duration-150"
        style={{
          background: walletConnected
            ? "rgba(14, 19, 28, 0.7)"
            : "var(--color-accent-lime)",
          color: walletConnected ? "var(--color-text-primary)" : "#070A0F",
          border: `1px solid ${walletConnected ? "rgba(255,255,255,0.08)" : "transparent"}`,
          backdropFilter: walletConnected ? "blur(12px)" : "none",
        }}
      >
        {walletConnected ? (
          <>
            <span
              className="w-2 h-2 rounded-full"
              style={{
                background: "var(--color-accent-long)",
                boxShadow: "0 0 6px rgba(0,210,106,0.4)",
              }}
            />
            <span className="font-mono text-[13px]">
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
