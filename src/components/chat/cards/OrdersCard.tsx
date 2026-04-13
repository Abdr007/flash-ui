"use client";

import { memo } from "react";
import { Cell, ToolError } from "./shared";
import type { ToolOutput } from "./types";
import { formatPrice } from "@/lib/format";

interface Order {
  market: string;
  side: string;
  type: string;
  price: number;
  size_usd?: number;
  collateral_usd?: number;
  leverage?: number;
  order_id?: number;
}

export const OrdersCard = memo(function OrdersCard({ output }: { output: ToolOutput }) {
  const d = output.data as Record<string, unknown> | null;
  if (!d) return <ToolError toolName="get_orders" error={output.error} />;

  const limitOrders = (d.limit_orders ?? []) as Order[];
  const triggerOrders = (d.trigger_orders ?? []) as Order[];
  const total = Number(d.total ?? 0);

  if (total === 0) {
    return (
      <div className="w-full max-w-[460px] glass-card overflow-hidden px-5 py-5">
        <div className="text-[14px] font-semibold text-text-primary mb-1">No Open Orders</div>
        <div className="text-[12px] text-text-tertiary">Place a limit order or set TP/SL on an open position.</div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-[500px] glass-card overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4">
        <div className="text-[11px] text-text-tertiary tracking-wider uppercase mb-1">Open Orders</div>
        <div className="text-[20px] font-semibold text-text-primary">
          {total} order{total !== 1 ? "s" : ""}
        </div>
      </div>

      {/* Limit Orders */}
      {limitOrders.length > 0 && (
        <>
          <div
            className="px-5 py-2 text-[10px] font-bold tracking-wider uppercase"
            style={{ color: "var(--color-accent-blue)", borderTop: "1px solid rgba(255,255,255,0.04)" }}
          >
            Limit Orders
          </div>
          {limitOrders.map((order, i) => (
            <div
              key={`limit-${i}`}
              className="px-5 py-3.5 flex items-center justify-between"
              style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}
            >
              <div className="flex items-center gap-3">
                <span
                  className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                  style={{
                    color: order.side === "LONG" ? "var(--color-accent-long)" : "var(--color-accent-short)",
                    background: order.side === "LONG" ? "rgba(16,185,129,0.12)" : "rgba(239,68,68,0.12)",
                  }}
                >
                  {order.side}
                </span>
                <span className="text-[14px] font-semibold text-text-primary">{order.market}</span>
                {order.leverage && <span className="text-[11px] text-text-tertiary num">{order.leverage}x</span>}
              </div>
              <div className="text-right">
                <div className="text-[14px] num font-semibold" style={{ color: "var(--color-accent-blue)" }}>
                  @ {formatPrice(order.price)}
                </div>
                {order.size_usd && (
                  <div className="text-[11px] num text-text-tertiary">${order.size_usd.toFixed(2)}</div>
                )}
              </div>
            </div>
          ))}
        </>
      )}

      {/* Trigger Orders (TP/SL) */}
      {triggerOrders.length > 0 && (
        <>
          <div
            className="px-5 py-2 text-[10px] font-bold tracking-wider uppercase"
            style={{ color: "var(--color-accent-warn)", borderTop: "1px solid rgba(255,255,255,0.04)" }}
          >
            TP / SL Orders
          </div>
          {triggerOrders.map((order, i) => {
            const isTP = order.type === "take_profit";
            return (
              <div
                key={`trigger-${i}`}
                className="px-5 py-3.5 flex items-center justify-between"
                style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}
              >
                <div className="flex items-center gap-3">
                  <span
                    className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                    style={{
                      color: isTP ? "var(--color-accent-long)" : "var(--color-accent-short)",
                      background: isTP ? "rgba(16,185,129,0.12)" : "rgba(239,68,68,0.12)",
                    }}
                  >
                    {isTP ? "TP" : "SL"}
                  </span>
                  <span className="text-[14px] font-medium text-text-primary">{order.market}</span>
                  <span className="text-[11px] text-text-tertiary">{order.side}</span>
                </div>
                <div
                  className="text-[14px] num font-semibold"
                  style={{ color: isTP ? "var(--color-accent-long)" : "var(--color-accent-short)" }}
                >
                  @ {formatPrice(order.price)}
                </div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
});

export default OrdersCard;
