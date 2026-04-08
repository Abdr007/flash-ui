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
    <div className="relative flex items-center px-5 h-11 shrink-0">
      {/* Banner — absolute centered, ignores wallet button width */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <span className="text-[12px]" style={{ color: "rgba(255,255,255,0.3)" }}>
          You are using an <span className="font-semibold" style={{ color: "#3AFFE1" }}>early</span> version of Flash Terminal. Always verify details before signing.
        </span>
      </div>

      {/* Wallet — right aligned, above the centered text */}
      <div className="ml-auto relative z-10">
        <button
          onClick={handleWallet}
          className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-[12px] font-semibold cursor-pointer
            transition-all duration-150"
          style={{
            background: walletConnected ? "rgba(255,255,255,0.03)" : "var(--color-accent-lime)",
            color: walletConnected ? "var(--color-text-primary)" : "#070A0F",
            border: `1px solid ${walletConnected ? "rgba(255,255,255,0.06)" : "transparent"}`,
          }}
        >
          {walletConnected ? (
            <>
              <span className="w-1.5 h-1.5 rounded-full"
                style={{ background: "#2CE800", boxShadow: "0 0 4px rgba(44,232,0,0.4)" }} />
              <span className="font-mono">
                {walletAddress?.slice(0, 4)}...{walletAddress?.slice(-4)}
              </span>
            </>
          ) : (
            <span>Connect Wallet</span>
          )}
        </button>
      </div>
    </div>
  );
}
