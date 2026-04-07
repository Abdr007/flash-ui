// ============================================
// Flash AI — Transfer History + Insights Tool
// ============================================
// Returns transfer history and spending insights
// from client-side localStorage (passed via context).
// No server-side storage — privacy first.

import { z } from "zod";
import { tool } from "ai";
import type { ToolResponse } from "./shared";
import { logToolCall, logToolResult, runReadGuards } from "./shared";

function makeRequestId(): string {
  return `txhist_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

interface TransferRecord {
  token: string;
  amount: number;
  recipient: string;
  recipientLabel: string | null;
  txSignature: string;
  timestamp: number;
  status: "success" | "failed";
}

interface TransferInsights {
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
}

export function createTransferHistoryTool(wallet: string) {
  return tool({
    description:
      "Show transfer history, recent transfers, and spending insights. " +
      "Analyzes past transfers to show patterns: top tokens, frequent recipients, volume. " +
      "Call when user asks about transfer history, recent sends, or spending patterns.",
    inputSchema: z.object({
      history_json: z.string().optional().describe(
        "JSON string of transfer history from client localStorage. " +
        "If not provided, returns empty results."
      ),
    }),
    execute: async ({ history_json }): Promise<ToolResponse<TransferInsights>> => {
      const requestId = makeRequestId();
      const start = Date.now();

      logToolCall("transfer_history", requestId, wallet);

      const guardErr = runReadGuards(requestId, wallet);
      if (guardErr) return guardErr as unknown as ToolResponse<TransferInsights>;

      let history: TransferRecord[] = [];
      try {
        if (history_json) {
          history = JSON.parse(history_json);
          if (!Array.isArray(history)) history = [];
        }
      } catch {
        history = [];
      }

      const successful = history.filter((t) => t.status === "success");
      const now = Date.now();

      // Top tokens
      const tokenMap = new Map<string, { count: number; total: number }>();
      for (const t of successful) {
        const entry = tokenMap.get(t.token) ?? { count: 0, total: 0 };
        entry.count++;
        entry.total += t.amount;
        tokenMap.set(t.token, entry);
      }
      const topTokens = [...tokenMap.entries()]
        .map(([token, { count, total }]) => ({ token, count, total_amount: total }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

      // Top recipients
      const recipientMap = new Map<string, { label: string | null; count: number }>();
      for (const t of successful) {
        const entry = recipientMap.get(t.recipient) ?? { label: t.recipientLabel, count: 0 };
        entry.count++;
        if (t.recipientLabel) entry.label = t.recipientLabel;
        recipientMap.set(t.recipient, entry);
      }
      const topRecipients = [...recipientMap.entries()]
        .map(([address, { label, count }]) => ({ address, label, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

      // Volume by period
      const h24 = successful.filter((t) => now - t.timestamp < 86400_000);
      const h7d = successful.filter((t) => now - t.timestamp < 604800_000);
      const h30d = successful.filter((t) => now - t.timestamp < 2592000_000);

      const uniqueTokens = (records: TransferRecord[]) => [...new Set(records.map((t) => t.token))];

      const insights: TransferInsights = {
        total_transfers: history.length,
        total_successful: successful.length,
        recent_transfers: successful.slice(0, 10),
        top_tokens: topTokens,
        top_recipients: topRecipients,
        volume_summary: {
          last_24h: { count: h24.length, tokens: uniqueTokens(h24) },
          last_7d: { count: h7d.length, tokens: uniqueTokens(h7d) },
          last_30d: { count: h30d.length, tokens: uniqueTokens(h30d) },
        },
      };

      logToolResult("transfer_history", requestId, wallet, Date.now() - start, "success", {
        total: history.length,
      });

      return {
        status: "success",
        data: insights,
        request_id: requestId,
        latency_ms: Date.now() - start,
      };
    },
  });
}
