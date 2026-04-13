"use client";

import { memo } from "react";
import { ToolError } from "./shared";
import type { ToolOutput } from "./types";

interface TransferRecord {
  token: string;
  amount: number;
  recipient: string;
  recipientLabel: string | null;
  txSignature: string;
  timestamp: number;
  status: "success" | "failed";
}

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const TransferHistoryCard = memo(function TransferHistoryCard({ output }: { output: ToolOutput }) {
  const data = output.data as {
    total_transfers: number;
    total_successful: number;
    recent_transfers: TransferRecord[];
    top_tokens: { token: string; count: number; total_amount: number }[];
    top_recipients: { address: string; label: string | null; count: number }[];
    volume_summary: {
      last_24h: { count: number; tokens: string[] };
      last_7d: { count: number; tokens: string[] };
      last_30d: { count: number; tokens: string[] };
    };
  } | null;

  if (!data) return <ToolError toolName="transfer_history" error={output.error} />;

  if (data.total_transfers === 0) {
    return (
      <div className="glass-card-solid overflow-hidden px-5 py-5">
        <div className="text-[14px] font-semibold text-text-primary mb-1">No Transfer History</div>
        <div className="text-[12px] text-text-tertiary">Send your first transfer to start tracking your activity.</div>
      </div>
    );
  }

  return (
    <div className="glass-card-solid overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 flex items-center gap-3">
        <span
          className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
          style={{ background: "rgba(139,92,246,0.1)", border: "1px solid rgba(139,92,246,0.15)" }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--color-accent-purple)"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 8v4l3 3" />
            <circle cx="12" cy="12" r="10" />
          </svg>
        </span>
        <div>
          <div className="text-[15px] font-semibold text-text-primary">Transfer History</div>
          <div className="text-[12px] text-text-tertiary">
            {data.total_successful} successful transfer{data.total_successful !== 1 ? "s" : ""}
          </div>
        </div>
      </div>

      {/* Insights row */}
      {data.top_tokens.length > 0 && (
        <div className="px-5 py-3" style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
          <div className="text-[10px] uppercase tracking-wider text-text-tertiary mb-2">Most used tokens</div>
          <div className="flex flex-wrap gap-2">
            {data.top_tokens.map((t) => (
              <span
                key={t.token}
                className="text-[12px] px-2.5 py-1 rounded-full font-medium"
                style={{ background: "rgba(255,255,255,0.04)", color: "var(--color-text-secondary)" }}
              >
                {t.token} <span className="num text-text-tertiary">({t.count}x)</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Top recipients */}
      {data.top_recipients.length > 0 && (
        <div className="px-5 py-3" style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
          <div className="text-[10px] uppercase tracking-wider text-text-tertiary mb-2">Frequent recipients</div>
          {data.top_recipients.slice(0, 3).map((r) => (
            <div key={r.address} className="flex items-center justify-between py-1">
              <span className="text-[12px] font-mono text-text-secondary">
                {r.label ?? `${r.address.slice(0, 4)}...${r.address.slice(-4)}`}
              </span>
              <span className="text-[11px] num text-text-tertiary">
                {r.count} transfer{r.count !== 1 ? "s" : ""}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Recent transfers */}
      <div className="px-5 py-3" style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
        <div className="text-[10px] uppercase tracking-wider text-text-tertiary mb-2">Recent</div>
        {data.recent_transfers.slice(0, 5).map((t, i) => (
          <div
            key={i}
            className="flex items-center justify-between py-1.5"
            style={{
              borderBottom:
                i < Math.min(data.recent_transfers.length, 5) - 1 ? "1px solid rgba(255,255,255,0.03)" : "none",
            }}
          >
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--color-accent-long)" }} />
              <span className="text-[12px] font-medium text-text-primary">
                {t.amount} {t.token}
              </span>
              <span className="text-[11px] text-text-tertiary">
                → {t.recipientLabel ?? `${t.recipient.slice(0, 4)}...${t.recipient.slice(-4)}`}
              </span>
            </div>
            <span className="text-[10px] text-text-tertiary">{timeAgo(t.timestamp)}</span>
          </div>
        ))}
      </div>

      {/* Volume summary */}
      <div
        className="grid grid-cols-3 gap-px"
        style={{ background: "var(--color-border-subtle)", borderTop: "1px solid rgba(255,255,255,0.04)" }}
      >
        <div className="px-3 py-3 text-center" style={{ background: "var(--color-bg-card-solid)" }}>
          <div className="text-[16px] num font-bold text-text-primary">{data.volume_summary.last_24h.count}</div>
          <div className="text-[10px] text-text-tertiary mt-0.5">Last 24h</div>
        </div>
        <div className="px-3 py-3 text-center" style={{ background: "var(--color-bg-card-solid)" }}>
          <div className="text-[16px] num font-bold text-text-primary">{data.volume_summary.last_7d.count}</div>
          <div className="text-[10px] text-text-tertiary mt-0.5">Last 7d</div>
        </div>
        <div className="px-3 py-3 text-center" style={{ background: "var(--color-bg-card-solid)" }}>
          <div className="text-[16px] num font-bold text-text-primary">{data.volume_summary.last_30d.count}</div>
          <div className="text-[10px] text-text-tertiary mt-0.5">Last 30d</div>
        </div>
      </div>
    </div>
  );
});

export { TransferHistoryCard };
export default TransferHistoryCard;
