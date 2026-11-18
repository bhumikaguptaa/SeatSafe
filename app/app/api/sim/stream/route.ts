// Owner: B to review, added by A.
// GET /api/sim/stream?sig=<signature> -> { delivered, processedAt }
// When did the QuickNode Stream deliver this transaction to /api/stream-webhook? Reads processed_signatures
// (server-only table, service role). Used by the Live Lab "under the hood" panel to time the Stream.
import { connection as dynamicRequest, NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/server/supabase-admin";

export async function GET(req: NextRequest) {
  await dynamicRequest();
  const sig = new URL(req.url).searchParams.get("sig") ?? "";
  if (!/^[1-9A-HJ-NP-Za-km-z]{60,100}$/.test(sig)) return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  const db = supabaseAdmin();
  if (!db) return NextResponse.json({ delivered: false, reason: "Supabase not configured" });
  const { data, error } = await db.from("processed_signatures").select("processed_at, event_count").eq("signature", sig).maybeSingle();
  if (error) return NextResponse.json({ delivered: false, reason: error.message });
  return NextResponse.json(
    data ? { delivered: true, processedAt: data.processed_at, eventCount: data.event_count } : { delivered: false },
    { headers: { "Cache-Control": "no-store" } },
  );
}
