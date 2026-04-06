"use client";

import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  name?: string;
}
interface State {
  hasError: boolean;
  error: string;
  errorCount: number;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: "", errorCount: 0 };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error: error?.message ?? "Unknown error" };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    try {
      console.error(`[ErrorBoundary${this.props.name ? `:${this.props.name}` : ""}]`, error?.message, info?.componentStack?.slice(0, 500));
    } catch {}
  }

  handleRetry = () => {
    this.setState((prev) => ({
      hasError: false,
      error: "",
      errorCount: prev.errorCount + 1,
    }));
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="h-full flex flex-col items-center justify-center gap-4 bg-bg-root text-text-primary p-6">
          <div className="text-[18px] font-semibold">Something went wrong</div>
          <div className="text-[13px] text-text-tertiary max-w-md text-center">
            {this.state.error || "An unexpected error occurred"}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={this.handleRetry}
              className="px-4 py-2 text-[13px] font-medium rounded-lg cursor-pointer"
              style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.1)" }}>
              Try Again
            </button>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 text-[13px] font-medium rounded-lg cursor-pointer"
              style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.1)" }}>
              Reload Page
            </button>
          </div>
          {this.state.errorCount > 0 && (
            <div className="text-[11px] text-text-tertiary">
              Retry attempts: {this.state.errorCount}
            </div>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}

/** Lightweight section boundary — renders null on crash instead of blank screen */
export class SectionBoundary extends Component<
  { children: ReactNode; fallback?: ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: ReactNode; fallback?: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    try { console.error("[SectionBoundary]", error?.message); } catch {}
  }

  render() {
    if (this.state.hasError) return this.props.fallback ?? null;
    return this.props.children;
  }
}
