"use client";

import { memo } from "react";
import type { ToolOutput } from "./types";

const ActionOptionsCard = memo(function ActionOptionsCard({
  output,
  onAction,
}: {
  output: ToolOutput;
  onAction?: (cmd: string) => void;
}) {
  const data = output.data as Record<string, unknown> | null;
  if (!data) return null;

  const title = String(data.title ?? "");
  const options = (data.options ?? []) as { label: string; intent: string; description?: string }[];

  return (
    <div style={{ animation: "slideUp 200ms ease-out" }}>
      {title && <div className="text-[15px] font-semibold text-text-primary mb-3">{title}</div>}
      <div className="flex flex-col gap-1.5">
        {options.map((opt, i) => (
          <button
            key={i}
            onClick={() => onAction?.(opt.intent)}
            className="quick-option group flex items-center justify-between w-full text-left
              px-4 py-3.5 rounded-xl cursor-pointer transition-all"
            style={{
              background: "transparent",
              border: "1px solid var(--color-border-subtle)",
              animationDelay: `${i * 60}ms`,
            }}
          >
            <div className="flex flex-col">
              <span className="text-[14px] font-medium text-text-primary group-hover:text-accent-lime transition-colors">
                {opt.label}
              </span>
              {opt.description && (
                <span className="text-[12px] mt-0.5" style={{ color: "var(--color-text-tertiary)" }}>
                  {opt.description}
                </span>
              )}
            </div>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--color-text-tertiary)"
              strokeWidth="2"
              strokeLinecap="round"
              className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
            >
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </button>
        ))}
      </div>
    </div>
  );
});

export { ActionOptionsCard };
export default ActionOptionsCard;
