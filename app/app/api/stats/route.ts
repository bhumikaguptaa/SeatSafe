// Owner: B to review, added by A.
// GET  /api/stats  -> Stats (lib/server/stats.ts) for the Discover protection ticker. Always 200; zeros with
//                     source "empty" if Supabase is unconfigured or has no data. Edge-cached for 10 s.
// POST /api/stats  { eventId?, priceUsd, capUsd } -> records one over-cap listing the program rejected
//                     (AboveResaleCap) in blocked_attempts. No wallet or personal data. Rate-limited.

import { connection as dynamicRequest, NextResponse, type NextRequest } from "next/server";
import { computeStats } from "@/lib/server/stats";
import { supabaseAdmin } from "@/lib/server/supabase-admin";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";

export async function GET() {
  await dynamicRequest();
  const stats = await computeStats(supabaseAdmin());
  return NextResponse.json(stats, {
    headers: { "Cache-Control": "public, max-age=0, s-maxage=10, stale-while-revalidate=30" },
  });
}

export async function POST(req: NextRequest) {
  await dynamicRequest();
  if (!rateLimit(`blocked:${clientIp(req.headers)}`, 10, 60_000)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  const body = (await req.json().catch(() => null)) as { eventId?: unknown; priceUsd?: unknown; capUsd?: unknown } | null;
  const price = Number(body?.priceUsd);
  const cap = Number(body?.capUsd);
  // Only a real over-cap attempt counts.
  if (!Number.isFinite(price) || !Number.isFinite(cap) || cap < 0 || price <= cap || price > 1_000_000) {
    return NextResponse.json({ error: "Not an over-cap attempt" }, { status: 400 });
  }
  const eventId = typeof body?.eventId === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(body.eventId) ? body.eventId : null;
  const db = supabaseAdmin();
  if (!db) return NextResponse.json({ stored: false, reason: "Supabase not configured" });
  const { error } = await db.from("blocked_attempts").insert({ event_id: eventId, price_usd: price, cap_usd: cap });
  if (error) {
    console.warn("blocked_attempts insert failed:", error.message);
    return NextResponse.json({ stored: false, reason: error.message });
  }
  return NextResponse.json({ stored: true });
}
