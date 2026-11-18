// GET /api/standing-orders/:id — the order plus the pending voice-approval, if any.

import { connection as dynamicRequest, NextResponse, type NextRequest } from "next/server";
import { standingOrderFromRow, type StandingOrderRow } from "@/lib/db-map";
import { supabaseAdmin } from "@/lib/server/supabase-admin";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  await dynamicRequest();
  const { id } = await ctx.params;
  const db = supabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });

  const { data: row, error } = await db.from("standing_orders").select("*").eq("id", id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: "Standing order not found" }, { status: 404 });

  const { data: approval } = await db
    .from("approval_requests")
    .select("*")
    .eq("standing_order_id", id)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return NextResponse.json({
    standingOrder: standingOrderFromRow(row as StandingOrderRow),
    approval: approval
      ? {
          id: approval.id,
          prompt: approval.prompt,
          totalUsd: Number(approval.total_usd),
          detail: approval.detail,
          listingId: approval.listing_id,
          priceUsd: Number(approval.price_usd),
          quantity: approval.quantity,
          sellerRating: Number(approval.seller_rating),
        }
      : null,
  });
}
