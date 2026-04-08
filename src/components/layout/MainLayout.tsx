"use client";

// ============================================
// Flash AI — Main Layout (Galileo-Style)
// ============================================
// Single centered column: Header → Portfolio Hero → Chat → Input
// No two-panel split. Everything flows vertically, centered.

import { useState, useCallback } from "react";
import ChatPanel from "@/components/chat/ChatPanel";
import PortfolioPanel from "@/components/portfolio/PortfolioPanel";
import ConfirmOverlay from "@/components/trade/ConfirmOverlay";
import SystemStatus from "@/components/layout/SystemStatus";
import { SectionBoundary } from "@/components/ErrorBoundary";
import DataStatusBanner from "@/components/layout/DataStatusBanner";

export default function MainLayout() {
  // Portfolio hero collapses once chat has messages
  const [heroCollapsed, setHeroCollapsed] = useState(false);

  const onChatStart = useCallback(() => {
    setHeroCollapsed(true);
  }, []);

  return (
    <div className="flex flex-col bg-bg-root overflow-hidden relative" style={{ height: "100dvh" }}>
      {/* ---- Dotted Grid Background (Galileo-style) ---- */}
      <div className="dot-grid-full" />

      {/* ---- Top Bar ---- */}
      <header className="shrink-0 relative z-10">
        <SectionBoundary fallback={<div className="h-12 bg-bg-root" />}>
          <SystemStatus />
        </SectionBoundary>
      </header>

      {/* ---- Data Status Banner (auto-hides when healthy) ---- */}
      <SectionBoundary>
        <DataStatusBanner />
      </SectionBoundary>

      {/* ---- Single Column Content ---- */}
      <div className="flex-1 flex flex-col min-h-0 relative z-10">
        <SectionBoundary fallback={
          <div className="flex-1 flex items-center justify-center text-text-tertiary text-[14px]">
            Chat failed to load. <button onClick={() => window.location.reload()} className="ml-2 text-accent-blue underline cursor-pointer">Reload</button>
          </div>
        }>
          <ChatPanel heroCollapsed={heroCollapsed} onChatStart={onChatStart} />
        </SectionBoundary>
      </div>

      {/* ---- Confirm Overlay ---- */}
      <SectionBoundary>
        <ConfirmOverlay />
      </SectionBoundary>
    </div>
  );
}
