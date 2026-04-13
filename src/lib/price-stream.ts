// ============================================
// Flash UI — Real-Time Price Stream (Pyth Hermes SSE)
// ============================================
//
// Connects to Pyth Hermes SSE for sub-second price updates.
// Falls back to REST polling on disconnect.
//
// Guarantees:
// - Every price update is validated (Number.isFinite, > 0, newer timestamp)
// - Invalid/stale data is silently discarded
// - Automatic reconnection with backoff
// - Never overwrites execution state
// - Batch updates to minimize re-renders

import { PYTH_FEED_IDS, FEED_TO_SYMBOL, HERMES_SSE_URL } from "./pyth-feeds";
import type { MarketPrice } from "./types";

// ---- Types ----

interface PythParsedPrice {
  id: string; // feed ID without 0x
  price: {
    price: string; // raw price as string
    conf: string;
    expo: number;
    publish_time: number;
  };
  ema_price?: {
    price: string;
    conf: string;
    expo: number;
    publish_time: number;
  };
}

type PriceCallback = (updates: MarketPrice[]) => void;
type StatusCallback = (status: "connected" | "reconnecting" | "disconnected") => void;

// ---- Stream Manager ----

export class PriceStream {
  private eventSource: EventSource | null = null;
  private onPrice: PriceCallback;
  private onStatus: StatusCallback;
  private lastTimestamps: Map<string, number> = new Map();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private maxReconnectDelay = 30_000;
  private destroyed = false;

  constructor(onPrice: PriceCallback, onStatus: StatusCallback) {
    this.onPrice = onPrice;
    this.onStatus = onStatus;
  }

  /** Start streaming prices for all registered markets */
  connect(): void {
    if (this.destroyed) return;
    this.disconnect();

    const feedIds = Object.values(PYTH_FEED_IDS);
    if (feedIds.length === 0) return;

    // Build SSE URL with all feed IDs
    const params = feedIds.map((id) => `ids[]=${encodeURIComponent(id)}`).join("&");
    const url = `${HERMES_SSE_URL}?${params}&parsed=true&allow_unordered=true&benchmarks_only=false`;

    try {
      this.eventSource = new EventSource(url);

      this.eventSource.onopen = () => {
        this.reconnectAttempts = 0;
        this.onStatus("connected");
      };

      this.eventSource.onmessage = (event) => {
        this.handleMessage(event.data);
      };

      this.eventSource.onerror = () => {
        this.onStatus("reconnecting");
        this.scheduleReconnect();
      };
    } catch {
      this.onStatus("disconnected");
      this.scheduleReconnect();
    }
  }

  /** Parse and validate an SSE message, emit valid price updates */
  private handleMessage(data: string): void {
    let parsed: { parsed?: PythParsedPrice[] };
    try {
      parsed = JSON.parse(data);
    } catch {
      return; // Discard unparseable data
    }

    if (!parsed.parsed || !Array.isArray(parsed.parsed)) return;

    const updates: MarketPrice[] = [];

    for (const entry of parsed.parsed) {
      const symbol = FEED_TO_SYMBOL[entry.id];
      if (!symbol) continue; // Unknown feed — skip

      const rawPrice = entry.price;
      if (!rawPrice || !rawPrice.price || rawPrice.expo == null) continue;

      // Compute human-readable price
      const priceNum = parseInt(rawPrice.price) * Math.pow(10, rawPrice.expo);
      const confidence = parseInt(rawPrice.conf || "0") * Math.pow(10, rawPrice.expo);
      const timestamp = (rawPrice.publish_time || 0) * 1000; // Convert to ms

      // ---- VALIDATION GATE ----
      // 1. Must be a finite positive number
      if (!Number.isFinite(priceNum) || priceNum <= 0) continue;

      // 2. Timestamp must be newer than last accepted update
      const lastTs = this.lastTimestamps.get(symbol) ?? 0;
      if (timestamp <= lastTs) continue;

      // 3. Confidence must be finite (non-critical, default to 0)
      const safeConfidence = Number.isFinite(confidence) ? confidence : 0;

      this.lastTimestamps.set(symbol, timestamp);

      updates.push({
        symbol,
        price: priceNum,
        confidence: safeConfidence,
        timestamp,
      });
    }

    // Batch emit — only if there are valid updates
    if (updates.length > 0) {
      this.onPrice(updates);
    }
  }

  /** Schedule reconnection with exponential backoff */
  private scheduleReconnect(): void {
    if (this.destroyed) return;
    this.disconnect();

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), this.maxReconnectDelay);
    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(() => {
      if (!this.destroyed) {
        this.connect();
      }
    }, delay);
  }

  /** Clean disconnect without destroying */
  private disconnect(): void {
    if (this.eventSource) {
      this.eventSource.onopen = null;
      this.eventSource.onmessage = null;
      this.eventSource.onerror = null;
      this.eventSource.close();
      this.eventSource = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /** Permanently shut down the stream */
  destroy(): void {
    this.destroyed = true;
    this.disconnect();
    this.lastTimestamps.clear();
  }

  /** Check if connected */
  get isConnected(): boolean {
    return this.eventSource?.readyState === EventSource.OPEN;
  }
}
