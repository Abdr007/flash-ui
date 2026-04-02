"use client";

import { useEffect, useRef } from "react";
import { PriceStream } from "@/lib/price-stream";
import { useFlashStore } from "@/store";
import { PRICE_REFRESH_MS } from "@/lib/constants";

/**
 * Manages the Pyth Hermes SSE price stream.
 * - Connects on mount, disconnects on unmount
 * - Falls back to REST polling if SSE fails
 * - Stream pushes into store.handleStreamPrices
 */
export function usePriceStream() {
  const handleStreamPrices = useFlashStore((s) => s.handleStreamPrices);
  const setStreamStatus = useFlashStore((s) => s.setStreamStatus);
  const refreshPrices = useFlashStore((s) => s.refreshPrices);
  const streamRef = useRef<PriceStream | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // Initial load via REST (fast, reliable)
    refreshPrices();

    // Start SSE stream
    const stream = new PriceStream(
      (updates) => {
        handleStreamPrices(updates);
      },
      (status) => {
        setStreamStatus(status);

        if (status === "connected") {
          // SSE is live — stop polling fallback
          if (pollingRef.current) {
            clearInterval(pollingRef.current);
            pollingRef.current = null;
          }
        } else if (status === "reconnecting" || status === "disconnected") {
          // SSE down — start polling fallback if not already running
          if (!pollingRef.current) {
            pollingRef.current = setInterval(refreshPrices, PRICE_REFRESH_MS);
          }
        }
      }
    );

    stream.connect();
    streamRef.current = stream;

    // Safety net: start polling immediately in case SSE takes time to connect
    pollingRef.current = setInterval(refreshPrices, PRICE_REFRESH_MS);

    return () => {
      stream.destroy();
      streamRef.current = null;
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [handleStreamPrices, setStreamStatus, refreshPrices]);
}
