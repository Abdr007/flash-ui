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
// Transparent error boundary — catches errors but NEVER unmounts children (preserves chat history)
class ChatErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError(): { hasError: boolean } { return { hasError: true }; }
  componentDidCatch(error: Error) {
    console.error("[ChatCrash]", error?.message);
    // Immediately clear error — never show fallback, never unmount children
    setTimeout(() => this.setState({ hasError: false }), 0);
  }
  render() {
    // ALWAYS render children — never show a fallback, never unmount
    return <div className="flex flex-col h-full">{this.props.children}</div>;
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
