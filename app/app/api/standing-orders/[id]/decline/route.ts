// POST /api/standing-orders/:id/decline — the fan said no on the voice call.
// The order stays open. The same listing will not be offered again.

import { connection as dynamicRequest, NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/server/supabase-admin";

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  await dynamicRequest();
  const { id } = await ctx.params;
  const db = supabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });

  const { data: approval } = await db
    .from("approval_requests")
    .select("id, listing_id, price_usd")
    .eq("standing_order_id", id)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!approval) return NextResponse.json({ error: "Nothing is waiting for approval" }, { status: 404 });

  await db.from("approval_requests").update({ status: "declined" }).eq("id", approval.id);
  await db.from("standing_order_decisions").upsert({
    standing_order_id: id,
    listing_id: approval.listing_id,
    decision: "declined",
  });
  await db.from("agent_log").insert({
    id: `log_no_${approval.id}`,
    standing_order_id: id,
    kind: "declined",
    message: `You declined listing ${String(approval.listing_id).slice(0, 4)} at $${Number(approval.price_usd).toFixed(2)}. Still watching.`,
    at: new Date().toISOString(),
  });
  return NextResponse.json({ ok: true, approvalId: approval.id });
}
