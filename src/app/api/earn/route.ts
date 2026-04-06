// ============================================
// Flash UI — Earn Pool Data API
// ============================================
// Fetches pool metrics from Flash official earn API.
// Caches for 30s to prevent API spam.
// NO custom math — all APY/TVL from protocol.

// Flash official earn data API
const EARN_API = "https://api.prod.flash.trade/earn-page/data";
const CACHE_TTL_MS = 30_000;

let cached: { data: unknown; expires: number } | null = null;

export async function GET() {
  // Return cached if fresh
  if (cached && Date.now() < cached.expires) {
    return Response.json(cached.data, {
      headers: { "Cache-Control": "public, max-age=30, stale-while-revalidate=60" },
    });
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);

    const res = await fetch(EARN_API, {
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timer);

    if (!res.ok) {
      return Response.json(
        { error: `Flash API ${res.status}` },
        { status: 502 },
      );
    }

    const data = await res.json();

    // Cache
    cached = { data, expires: Date.now() + CACHE_TTL_MS };

    return Response.json(data, {
      headers: { "Cache-Control": "public, max-age=30, stale-while-revalidate=60" },
    });
  } catch (err) {
    // Return stale cache if available
    if (cached) {
      return Response.json(cached.data, {
        headers: { "X-Flash-Cache": "stale" },
      });
    }

    return Response.json(
      { error: err instanceof Error ? err.message : "Earn data unavailable" },
      { status: 502 },
    );
  }
}
