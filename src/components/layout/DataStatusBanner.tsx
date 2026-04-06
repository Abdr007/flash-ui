"use client";

import { useFlashStore } from "@/store";

/**
 * Subtle, non-blocking banner that appears when data is stale or APIs are failing.
 * Auto-hides when data recovers. Never blocks interaction.
 */
export default function DataStatusBanner() {
  const pricesError = useFlashStore((s) => s.dataStatus.pricesError);
  const positionsError = useFlashStore((s) => s.dataStatus.positionsError);
  const streamStatus = useFlashStore((s) => s.streamStatus);

  // Determine worst status
  const hasError = !!(pricesError || positionsError);
  const isDisconnected = streamStatus === "disconnected";
  const isReconnecting = streamStatus === "reconnecting";

  // Nothing wrong — hide completely
  if (!hasError && !isDisconnected && !isReconnecting) return null;

  let message = "";
  let color = "var(--color-accent-warn)";

  if (pricesError && positionsError) {
    message = "Data temporarily unavailable";
    color = "var(--color-accent-short)";
  } else if (pricesError) {
    message = "Price data temporarily unavailable";
  } else if (positionsError) {
    message = "Position data temporarily unavailable";
  } else if (isDisconnected) {
    message = "Price stream disconnected — using cached data";
  } else if (isReconnecting) {
    message = "Reconnecting to price stream...";
  }

  return (
    <div
      className="flex items-center justify-center gap-2 px-4 py-1.5 text-[11px] font-medium shrink-0"
      style={{
        background: `${color}08`,
        borderBottom: `1px solid ${color}20`,
        color,
        animation: "fadeIn 200ms ease-out",
      }}
    >
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />
      {message}
    </div>
  );
}
