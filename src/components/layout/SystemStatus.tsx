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
        {/* FT mark — the lightning bolt, not the round logo */}
        <svg width="22" height="22" viewBox="5 14 62 45" fill="none" aria-hidden="true">
          <path
            d="M49.88 19.7C49.88 20.6 49.94 26.35 49.94 27.58H33.28c-.66 0-1.09.19-1.56.65L19.06 40.89c-.47.47-.9.65-1.55.62h-6.22v-5.69c0-.49.09-.84.47-1.21L26.19 20.2c.31-.34.62-.53 1.09-.53h22.6z"
            fill="url(#hdr-a)"
          />
          <path
            d="M60.75 30.69h.56v6.84h-7.31c-.65 0-1.09.19-1.56.65l-13.83 13.9c-.5.47-.97.69-1.65.66h-13.2l8.86-8.24c2.15-2.18 4.3-4.32 6.47-6.5.09-.1.16-.19.34-.44h-13.3l.6-.81c1.87-1.87 3.73-3.7 5.6-5.57.34-.34.69-.53 1.21-.53h27z"
            fill="url(#hdr-b)"
          />
          <defs>
            <linearGradient id="hdr-a" x1="27.6" y1="18.7" x2="36.3" y2="53.5" gradientUnits="userSpaceOnUse">
              <stop stopColor="white" />
              <stop offset="0.44" stopColor="#FFEB00" />
              <stop offset="1" stopColor="#3AFFE1" />
            </linearGradient>
            <linearGradient id="hdr-b" x1="27.6" y1="18.7" x2="36.3" y2="53.5" gradientUnits="userSpaceOnUse">
              <stop stopColor="white" />
              <stop offset="0.44" stopColor="#FFEB00" />
              <stop offset="1" stopColor="#3AFFE1" />
            </linearGradient>
          </defs>
        </svg>
        <div className="flex flex-col leading-none">
          <span className="text-[13px] font-extrabold tracking-wide text-white">FLASH</span>
          <span className="text-[9px] font-semibold tracking-[0.2em] text-white/40">TRADE</span>
        </div>
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
