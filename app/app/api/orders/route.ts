// POST /api/orders — record a purchase the client is about to make (or just made).
// The stream webhook is the source of truth and will only move this row forward.
// With DEMO_DEADLINES=true the response tells the client to use 60-second windows.

import { connection as dynamicRequest, NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { demoDeadlineSecs } from "@/lib/server/deadlines";
import { supabaseAdmin } from "@/lib/server/supabase-admin";

const Body = z.object({
  id: z.string().min(1).max(80),
  listingId: z.string().min(1).max(80),
  eventId: z.string().min(1).max(80),
  buyerId: z.string().min(1).max(80),
  sellerId: z.string().min(1).max(80),
  amountUsd: z.number().positive().max(1_000_000),
  tier: z.union([z.literal(1), z.literal(2)]),
  vaultAddress: z.string().max(80).optional(),
  shipDeadline: z.string().optional(),
  confirmDeadline: z.string().optional(),
});

export async function POST(req: NextRequest) {
  await dynamicRequest();
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid order", issues: parsed.error.issues }, { status: 400 });
  }
  const db = supabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });

  const demoSecs = demoDeadlineSecs();
  const now = Date.now();
  const ship = demoSecs
    ? new Date(now + demoSecs * 1000).toISOString()
    : parsed.data.shipDeadline ?? new Date(now + 2 * 60 * 60 * 1000).toISOString();
  const confirm = demoSecs
    ? new Date(now + demoSecs * 2 * 1000).toISOString()
    : parsed.data.confirmDeadline ?? new Date(now + 24 * 60 * 60 * 1000).toISOString();

  const row = {
    id: parsed.data.id,
    listing_id: parsed.data.listingId,
    event_id: parsed.data.eventId,
    buyer_id: parsed.data.buyerId,
    seller_id: parsed.data.sellerId,
    amount_usd: parsed.data.amountUsd,
    tier: parsed.data.tier,
    state: "HELD" as const,
    ship_deadline: ship,
    confirm_deadline: confirm,
    vault_address: parsed.data.vaultAddress ?? parsed.data.id,
  };

  const { data: existing } = await db.from("orders").select("id, state").eq("id", row.id).maybeSingle();
  if (!existing) {
    const { error } = await db.from("orders").insert(row);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await db.from("order_events").insert({
      id: `${row.id}:created`,
      order_id: row.id,
      type: "FUNDED",
      message: `Payment of $${row.amount_usd.toFixed(2)} is locked in the SeatSafe vault.`,
      at: new Date(now).toISOString(),
    });
  }

  return NextResponse.json({
    orderId: row.id,
    state: existing?.state ?? "HELD",
    created: !existing,
    shipDeadline: ship,
    confirmDeadline: confirm,
    demo: demoSecs !== null,
    shipWindowSecs: demoSecs ?? undefined,
    confirmWindowSecs: demoSecs ?? undefined,
  });
}
