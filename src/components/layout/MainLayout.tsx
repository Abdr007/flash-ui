"use client";

// ============================================
// Flash AI — Main Layout (Galileo-Style)
// ============================================
// Single centered column: Header → Portfolio Hero → Chat → Input
// No two-panel split. Everything flows vertically, centered.

import { useState, useCallback, Component, type ReactNode } from "react";
import ChatPanel from "@/components/chat/ChatPanel";
import SystemStatus from "@/components/layout/SystemStatus";
import { SectionBoundary } from "@/components/ErrorBoundary";
import DataStatusBanner from "@/components/layout/DataStatusBanner";

// Secondary safety-net boundary for ChatPanel's top-level render.
//
// NOTE: React error boundaries inherently unmount-and-remount the subtree on
// catch — returning `{children}` from render() creates a fresh subtree, it
// does NOT reuse prior instances. This means a catch here DOES lose useChat
// state (messages array resets) and flashes PortfolioHero.
//
// The primary defense is inside ChatPanel — per-message SectionBoundary that
// isolates tool-card crashes without unmounting ChatPanel. This outer
// boundary only fires if something in ChatPanel's own render code throws,
// which should be rare.
class ChatErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }
  componentDidCatch(error: Error) {
    console.error("[ChatCrash]", error?.message);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col h-full items-center justify-center gap-3">
          <p className="text-[14px] text-text-secondary">Something went wrong in the chat panel.</p>
          <button
            onClick={() => this.setState({ hasError: false })}
            className="btn-secondary px-4 py-2 text-[13px] text-accent-blue cursor-pointer"
          >
            Retry
          </button>
        </div>
      );
    }
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
      {/* ---- Ambient Teal Glow (brand depth) ---- */}
      <div className="ambient-teal" />
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

      {/* ConfirmOverlay removed — trade preview card has all the detail
          already, and clicking Confirm Trade now fires the signing flow
          directly (no interstitial modal). See TradePreviewCard.handleConfirm. */}
    </div>
  );
}
