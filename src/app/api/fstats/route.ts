import { NextRequest, NextResponse } from "next/server";
import { getClientIp, RateLimiter, rateLimitResponse, isAllowedFstatsPath } from "@/lib/api-security";

const FSTATS = "https://fstats.io/api/v1";

// Rate limit: 30 req/min per IP
const limiter = new RateLimiter(30);

export async function GET(req: NextRequest) {
  // ---- Rate Limit ----
  const ip = getClientIp(req);
  if (!limiter.check(ip)) return rateLimitResponse();

  const path = req.nextUrl.searchParams.get("path") ?? "overview/stats";
  const period = req.nextUrl.searchParams.get("period") ?? "";

  // ---- Path Whitelist (prevents SSRF / path traversal) ----
  if (!isAllowedFstatsPath(path)) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  // ---- Sanitize period param ----
  const safePeriod = /^[a-zA-Z0-9_-]{0,20}$/.test(period) ? period : "";

  try {
    const url = `${FSTATS}/${encodeURIComponent(path)}${safePeriod ? `?period=${encodeURIComponent(safePeriod)}` : ""}`;
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: { "Accept": "application/json" },
    });

    if (!resp.ok) {
      return NextResponse.json({ error: "Upstream unavailable" }, { status: 502 });
    }

    const data = await resp.json();
    return NextResponse.json(data, {
      headers: { "Cache-Control": "s-maxage=30, stale-while-revalidate=60" },
    });
  } catch {
    return NextResponse.json({ error: "fstats unavailable" }, { status: 502 });
  }
}
