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

export default function MainLayout() {
  // Portfolio hero collapses once chat has messages
  const [heroCollapsed, setHeroCollapsed] = useState(false);

  const onChatStart = useCallback(() => {
    setHeroCollapsed(true);
  }, []);

  return (
    <div className="h-screen flex flex-col bg-bg-root overflow-hidden">
      {/* ---- Top Bar ---- */}
      <header className="shrink-0" style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
        <SectionBoundary fallback={<div className="h-14 bg-bg-root" />}>
          <SystemStatus />
        </SectionBoundary>
      </header>

      {/* ---- Single Column Content ---- */}
      <div className="flex-1 flex flex-col min-h-0">
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
