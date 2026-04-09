"use client";

// ============================================
// Flash AI — Main Layout (Galileo-Style)
// ============================================
// Single centered column: Header → Portfolio Hero → Chat → Input
// No two-panel split. Everything flows vertically, centered.

import { useState, useCallback, Component, type ReactNode } from "react";
import ChatPanel from "@/components/chat/ChatPanel";
import PortfolioPanel from "@/components/portfolio/PortfolioPanel";
import ConfirmOverlay from "@/components/trade/ConfirmOverlay";
import SystemStatus from "@/components/layout/SystemStatus";
import { SectionBoundary } from "@/components/ErrorBoundary";
import DataStatusBanner from "@/components/layout/DataStatusBanner";

// Auto-recovering error boundary for chat — retries automatically after crash
class ChatErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; key: number }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, key: 0 };
  }
  static getDerivedStateFromError(): { hasError: boolean } { return { hasError: true }; }
  componentDidCatch(error: Error) {
    console.error("[ChatCrash]", error?.message);
    // Auto-recover after 500ms
    setTimeout(() => this.setState((s) => ({ hasError: false, key: s.key + 1 })), 500);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex-1 flex items-center justify-center">
          <div className="flex items-center gap-2 text-[13px] text-text-tertiary">
            <span className="w-4 h-4 border-2 border-text-tertiary border-t-transparent rounded-full" style={{ animation: "spin 0.8s linear infinite" }} />
            Reconnecting...
          </div>
        </div>
      );
    }
    return <div key={this.state.key} className="flex flex-col h-full">{this.props.children}</div>;
  }
}

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
        <ChatErrorBoundary>
          <ChatPanel heroCollapsed={heroCollapsed} onChatStart={onChatStart} />
        </ChatErrorBoundary>
      </div>

      {/* ---- Confirm Overlay ---- */}
      <SectionBoundary>
        <ConfirmOverlay />
      </SectionBoundary>
    </div>
  );
}
