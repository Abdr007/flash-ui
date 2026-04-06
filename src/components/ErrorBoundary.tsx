"use client";

import { Component, type ReactNode } from "react";

interface Props { children: ReactNode; }
interface State { hasError: boolean; error: string; }

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: "" };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error: error.message };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="h-full flex flex-col items-center justify-center gap-4 bg-bg-root text-text-primary">
          <div className="text-[18px] font-semibold">Something went wrong</div>
          <div className="text-[13px] text-text-tertiary max-w-md text-center">{this.state.error}</div>
          <button
            onClick={() => { this.setState({ hasError: false, error: "" }); window.location.reload(); }}
            className="px-4 py-2 text-[13px] font-medium rounded-lg cursor-pointer"
            style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.1)" }}>
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
