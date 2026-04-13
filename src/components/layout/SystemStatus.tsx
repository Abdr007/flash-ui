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
    <div className="relative flex items-center justify-between px-5 h-11 shrink-0">
      {/* Early version — subtle, left */}
      <span className="text-[10px] hidden sm:inline" style={{ color: "rgba(255,255,255,0.18)" }}>
        <span className="font-semibold" style={{ color: "rgba(58,255,225,0.4)" }}>
          early
        </span>{" "}
        version · always verify before signing
      </span>
      <span className="sm:hidden" />

      {/* Wallet — right */}
      {walletConnected ? (
        <button
          onClick={handleWallet}
          className="flex items-center gap-2 px-4 py-1.5 rounded-xl text-[12px] font-semibold cursor-pointer shrink-0"
          style={{
            background: "rgba(51, 201, 161, 0.06)",
            color: "var(--color-text-primary)",
            border: "1px solid rgba(51, 201, 161, 0.12)",
            backdropFilter: "blur(12px)",
            transition: "all 200ms cubic-bezier(0.34, 1.56, 0.64, 1)",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = "rgba(51, 201, 161, 0.3)";
            e.currentTarget.style.boxShadow = "0 0 20px -4px rgba(51, 201, 161, 0.15)";
            e.currentTarget.style.transform = "translateY(-1px)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = "rgba(51, 201, 161, 0.12)";
            e.currentTarget.style.boxShadow = "none";
            e.currentTarget.style.transform = "none";
          }}
        >
          <span
            className="w-2 h-2 rounded-full"
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
