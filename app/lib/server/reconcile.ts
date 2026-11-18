// Every 5 minutes, re-read open chain accounts and repair any Supabase row that fell behind.
// The stream is the fast path. This is the safety net.

import { chainProgram, toOrderState } from "@/lib/chain";
import { canAdvance } from "@/lib/order-state";
import type { OrderState } from "@/lib/types";
import { matchOpenListings } from "@/lib/server/matcher";
import { supabaseAdmin } from "@/lib/server/supabase-admin";

function stateName(state: object): string {
  return Object.keys(state)[0] ?? "";
}

function iso(unixSecs: number): string {
  return new Date(unixSecs * 1000).toISOString();
}

export async function reconcileOrders(): Promise<{ checked: number; repaired: string[]; matcher: number }> {
  const db = supabaseAdmin();
  const repaired: string[] = [];
  if (!db) return { checked: 0, repaired, matcher: 0 };

  const program = chainProgram();
  const rows = await program.account.escrowOrder.all();
  for (const row of rows) {
    const name = stateName(row.account.state as object);
    const next = toOrderState(name as "funded");
    if (!next || !row.account.buyer) continue;
    const id = row.publicKey.toBase58();
    const { data: existing } = await db.from("orders").select("state").eq("id", id).maybeSingle();
    const current = (existing?.state as OrderState | undefined) ?? null;
    if (existing && !canAdvance(current, next)) continue;

    const ship = Number(row.account.shipDeadline.toString());
    const confirm = Number(row.account.confirmDeadline.toString());
    const saved = {
      id,
      listing_id: id,
      event_id: "",
      buyer_id: row.account.buyer.toBase58(),
      seller_id: row.account.seller.toBase58(),
      amount_usd: Number(row.account.price.toString()) / 1_000_000,
      tier: 2,
      state: next,
      ship_deadline: iso(ship > 0 ? ship : Math.floor(Date.now() / 1000)),
      confirm_deadline: iso(confirm > 0 ? confirm : ship),
      vault_address: id,
    };
    if (existing) {
      const { data: prev } = await db.from("orders").select("event_id").eq("id", id).maybeSingle();
      if (prev?.event_id) saved.event_id = prev.event_id;
      await db.from("orders").update(saved).eq("id", id);
    } else {
      await db.from("orders").insert(saved);
    }
    await db.from("order_events").upsert({
      id: `${id}:reconcile:${next}`,
      order_id: id,
      type: next === "HELD" ? "FUNDED"
        : next === "IN_TRANSIT" ? "TICKET_SENT"
        : next === "REFUNDED" ? "REFUNDED"
        : next === "DISPUTED" ? "DISPUTE_OPENED"
        : "RELEASED",
      message: `Chain state is ${next}. Reconciled from the escrow account.`,
      at: new Date().toISOString(),
    }, { onConflict: "id", ignoreDuplicates: true });
    repaired.push(id);
  }

  const matcher = await matchOpenListings();
  return { checked: rows.length, repaired, matcher: matcher.considered };
}
