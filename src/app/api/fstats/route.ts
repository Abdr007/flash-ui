import { NextRequest, NextResponse } from "next/server";

const FSTATS = "https://fstats.io/api/v1";

export async function GET(req: NextRequest) {
  const path = req.nextUrl.searchParams.get("path") ?? "overview/stats";
  const period = req.nextUrl.searchParams.get("period") ?? "";

  try {
    const url = `${FSTATS}/${path}${period ? `?period=${period}` : ""}`;
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: { "Accept": "application/json" },
    });

    if (!resp.ok) {
      return NextResponse.json({ error: `fstats ${resp.status}` }, { status: resp.status });
    }

    const data = await resp.json();
    return NextResponse.json(data, {
      headers: { "Cache-Control": "s-maxage=30, stale-while-revalidate=60" },
    });
  } catch {
    return NextResponse.json({ error: "fstats unavailable" }, { status: 502 });
  }
}
