// POST /api/standing-orders/:id/approve
// "Yes" from the voice approval (or the Approve button). Fills the listing when both
// the standing order and the ticket mint are onchain. The program still enforces the cap.

import { connection as dynamicRequest, NextResponse, type NextRequest } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { chainProgram } from "@/lib/chain";
import { fillStandingOrder } from "@/lib/program";
import { loadRelayer } from "@/lib/server/relayer";
import { sendAsRelayer } from "@/lib/server/send";
import { supabaseAdmin } from "@/lib/server/supabase-admin";

function isPubkey(value: string | null | undefined): value is string {
  if (!value) return false;
  try {
    new PublicKey(value);
    return true;
  } catch {
    return false;
  }
}

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  await dynamicRequest();
  const { id } = await ctx.params;
  const db = supabaseAdmin();
  if (!db) return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });

  const { data: approval } = await db
    .from("approval_requests")
    .select("*")
    .eq("standing_order_id", id)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!approval) return NextResponse.json({ error: "Nothing is waiting for approval" }, { status: 404 });

  const { data: listing } = await db.from("listings").select("ticket_mint, price_usd").eq("id", approval.listing_id).maybeSingle();
  let signature: string | null = null;
  if (isPubkey(id) && isPubkey(listing?.ticket_mint)) {
    const relayer = loadRelayer();
    if (!relayer) return NextResponse.json({ error: "Relayer not configured" }, { status: 503 });
    try {
      const program = chainProgram();
      const built = await fillStandingOrder(
        { program, user: relayer.publicKey, payer: relayer.publicKey },
        { standingOrder: new PublicKey(id), ticketMint: new PublicKey(listing.ticket_mint) },
      );
      signature = await sendAsRelayer(built, relayer);
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
    }
  }

  await db.from("approval_requests").update({ status: "approved" }).eq("id", approval.id);
  await db.from("standing_order_decisions").upsert({
    standing_order_id: id,
    listing_id: approval.listing_id,
    decision: signature ? "filled" : "approved_offchain",
  });
  await db.from("agent_log").insert({
    id: `log_yes_${approval.id}`,
    standing_order_id: id,
    kind: "filled",
    message: signature
      ? `You approved listing ${String(approval.listing_id).slice(0, 4)} at $${Number(approval.price_usd).toFixed(2)}. Filled.`
      : `You approved listing ${String(approval.listing_id).slice(0, 4)} at $${Number(approval.price_usd).toFixed(2)}.`,
    at: new Date().toISOString(),
  });

  return NextResponse.json({ ok: true, signature, approvalId: approval.id });
}
