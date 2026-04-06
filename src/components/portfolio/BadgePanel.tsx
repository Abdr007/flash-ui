"use client";

import { useState, useMemo } from "react";
import { computeBadges, getNextBadge, formatShareText, type Badge } from "@/lib/badges";
import { getUserPatterns } from "@/lib/user-patterns";

export default function BadgePanel() {
  const [showAll, setShowAll] = useState(false);
  const [copied, setCopied] = useState(false);

  const patterns = getUserPatterns();
  const allBadges = useMemo(() => computeBadges(patterns), [patterns]);
  const earned = allBadges.filter((b) => b.earned);
  const next = useMemo(() => getNextBadge(), [patterns]);

  if (patterns.totalTrades === 0) return null;

  const earnedCount = earned.length;
  const totalCount = allBadges.length;

  function handleShare() {
    const text = formatShareText();
    if (!text) return;
    try {
      if (navigator.share) {
        navigator.share({ text }).catch(() => {});
      } else {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      try { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {}
    }
  }

  return (
    <div className="w-full" style={{ animation: "fadeIn 200ms ease-out" }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-text-tertiary tracking-wider uppercase">Badges</span>
          <span className="text-[11px] num font-medium" style={{ color: "var(--color-accent-lime)" }}>
            {earnedCount}/{totalCount}
          </span>
        </div>
        {earnedCount > 0 && (
          <button
            onClick={handleShare}
            className="text-[11px] font-medium px-3 py-1 rounded-full cursor-pointer transition-all hover:brightness-110"
            style={{ background: "rgba(200,245,71,0.1)", color: "var(--color-accent-lime)", border: "1px solid rgba(200,245,71,0.2)" }}
          >
            {copied ? "Copied!" : "Share"}
          </button>
        )}
      </div>

      {/* Earned badges */}
      <div className="flex flex-wrap gap-2 mb-2">
        {earned.map((b) => (
          <BadgeChip key={b.id} badge={b} />
        ))}
      </div>

      {/* Next badge hint */}
      {next && !showAll && (
        <div className="flex items-center gap-2 text-[11px] text-text-tertiary mt-1">
          <span style={{ opacity: 0.5 }}>{next.icon}</span>
          <span>Next: {next.name} — {next.description}</span>
        </div>
      )}

      {/* Show all toggle */}
      {totalCount > earned.length && (
        <button
          onClick={() => setShowAll(!showAll)}
          className="text-[11px] text-text-tertiary mt-2 cursor-pointer hover:text-text-secondary"
        >
          {showAll ? "Hide locked" : `Show all (${totalCount - earnedCount} locked)`}
        </button>
      )}

      {/* Locked badges */}
      {showAll && (
        <div className="flex flex-wrap gap-2 mt-2" style={{ opacity: 0.4 }}>
          {allBadges.filter((b) => !b.earned).map((b) => (
            <BadgeChip key={b.id} badge={b} locked />
          ))}
        </div>
      )}
    </div>
  );
}

function BadgeChip({ badge, locked }: { badge: Badge; locked?: boolean }) {
  const tierColor = {
    bronze: "rgba(205,127,50,0.15)",
    silver: "rgba(192,192,192,0.12)",
    gold: "rgba(255,215,0,0.12)",
  }[badge.tier];

  const tierBorder = {
    bronze: "rgba(205,127,50,0.25)",
    silver: "rgba(192,192,192,0.2)",
    gold: "rgba(255,215,0,0.25)",
  }[badge.tier];

  return (
    <div
      className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px]"
      style={{
        background: locked ? "rgba(255,255,255,0.03)" : tierColor,
        border: `1px solid ${locked ? "rgba(255,255,255,0.06)" : tierBorder}`,
      }}
      title={badge.description}
    >
      <span>{locked ? "🔒" : badge.icon}</span>
      <span className={locked ? "text-text-tertiary" : "text-text-secondary font-medium"}>{badge.name}</span>
    </div>
  );
}
