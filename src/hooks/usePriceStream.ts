"use client";

import { useEffect, useRef } from "react";
import { PriceStream } from "@/lib/price-stream";
import { useFlashStore } from "@/store";
import { PRICE_REFRESH_MS } from "@/lib/constants";

/**
 * Manages the Pyth Hermes SSE price stream.
 * - Connects once on mount, disconnects on unmount
 * - Falls back to REST polling if SSE fails
 * - Uses refs for store functions to avoid re-render loops
 */
export function usePriceStream() {
  const handleStreamPrices = useFlashStore((s) => s.handleStreamPrices);
  const setStreamStatus = useFlashStore((s) => s.setStreamStatus);
  const refreshPrices = useFlashStore((s) => s.refreshPrices);

  // Refs to avoid dependency-triggered re-runs
  const handleRef = useRef(handleStreamPrices);
  const statusRef = useRef(setStreamStatus);
  const refreshRef = useRef(refreshPrices);
  useEffect(() => {
    handleRef.current = handleStreamPrices;
    statusRef.current = setStreamStatus;
    refreshRef.current = refreshPrices;
  });

  useEffect(() => {
    // Initial load via REST
    refreshRef.current();

    // Start SSE stream
    let pollingTimer: ReturnType<typeof setInterval> | null = null;

    const stream = new PriceStream(
      (updates) => handleRef.current(updates),
      (status) => {
        statusRef.current(status);
        if (status === "connected") {
          if (pollingTimer) {
            clearInterval(pollingTimer);
            pollingTimer = null;
          }
        } else if (!pollingTimer) {
          pollingTimer = setInterval(() => refreshRef.current(), PRICE_REFRESH_MS);
        }
      },
    );

    stream.connect();

    // Safety net polling until SSE connects
    pollingTimer = setInterval(() => refreshRef.current(), PRICE_REFRESH_MS);

    return () => {
      stream.destroy();
      if (pollingTimer) clearInterval(pollingTimer);
    };
  }, []); // Empty deps — runs once on mount
}
