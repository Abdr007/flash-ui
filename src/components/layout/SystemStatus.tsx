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
    <div className="flex flex-col">
      {/* Early version banner */}
      <div className="text-center py-2 text-[13px]" style={{ color: "rgba(255,255,255,0.45)", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
        You are using an <span className="font-semibold" style={{ color: "#3AFFE1" }}>early</span> version of Flash Terminal. Always verify details before signing.
      </div>
      <div className="flex items-center justify-end px-5 h-12 shrink-0">


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
    </div>
  );
}
