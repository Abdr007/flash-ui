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
    <div className="relative flex items-center px-5 h-12 shrink-0"
      style={{ borderBottom: "1px solid rgba(51, 201, 161, 0.06)" }}>
      {/* Banner — absolute centered */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <span className="text-[12px]" style={{ color: "rgba(255,255,255,0.3)" }}>
          You are using an <span className="font-semibold" style={{ color: "var(--color-brand-cyan)" }}>early</span> version of Flash Terminal. Always verify before signing.
        </span>
      </div>

      {/* Wallet — right aligned */}
      <div className="ml-auto relative z-10">
        {walletConnected ? (
          <button
            onClick={handleWallet}
            className="flex items-center gap-2 px-4 py-1.5 rounded-xl text-[12px] font-semibold cursor-pointer"
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
            <span className="w-2 h-2 rounded-full"
              style={{
                background: "var(--color-brand-teal)",
                boxShadow: "0 0 6px rgba(51, 201, 161, 0.5)",
                animation: "livePulse 2s ease-in-out infinite",
              }} />
            <span className="font-mono">
              {walletAddress?.slice(0, 4)}...{walletAddress?.slice(-4)}
            </span>
          </button>
        ) : (
          <button
            onClick={handleWallet}
            className="btn-cta px-5 py-2 text-[12px] font-bold glow-pulse"
          >
            Connect Wallet
          </button>
        )}
      </div>
    </div>
  );
}
