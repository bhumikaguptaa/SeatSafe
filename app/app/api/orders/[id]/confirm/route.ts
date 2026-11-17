// POST /api/orders/:id/confirm
// The buyer has to sign confirm_receipt. Pass the same partially signed tx the relayer
// accepts on /api/relay, or pass nothing and this route only syncs a confirmation that
// already landed (the stream will also do that).

import { connection as dynamicRequest, NextResponse, type NextRequest } from "next/server";
import { Connection, SendTransactionError, VersionedTransaction } from "@solana/web3.js";
import { z } from "zod";
import { checkRelayTx } from "@/lib/relay-policy";
import { PROGRAM_ID, RPC_URL } from "@/lib/solana";
import idl from "@/lib/idl/seatsafe.json";
import { PublicKey } from "@solana/web3.js";
import { getEscrowOrder } from "@/lib/chain";
import { canAdvance } from "@/lib/order-state";
import type { OrderState } from "@/lib/types";
import { loadRelayer } from "@/lib/server/relayer";
import { supabaseAdmin } from "@/lib/server/supabase-admin";

const Body = z.object({
  tx: z.string().max(4096).optional(),
  lastValidBlockHeight: z.number().int().positive().optional(),
});

async function mirror(orderId: string) {
  const db = supabaseAdmin();
  const chain = await getEscrowOrder(orderId).catch(() => null);
  if (!db || !chain) return chain;
  const { data: existing } = await db.from("orders").select("state").eq("id", orderId).maybeSingle();
  const current = (existing?.state as OrderState | undefined) ?? null;
  if (existing && !canAdvance(current, chain.state)) return chain;
  const row = {
    id: chain.id,
    listing_id: chain.listingId,
    event_id: chain.eventId,
    buyer_id: chain.buyerId,
    seller_id: chain.sellerId,
    amount_usd: chain.amountUsd,
    tier: chain.tier,
    state: chain.state,
    ship_deadline: chain.shipDeadline,
    confirm_deadline: chain.confirmDeadline,
    vault_address: chain.vaultAddress ?? null,
  };
  if (existing) await db.from("orders").update(row).eq("id", orderId);
  else await db.from("orders").insert(row);
  return chain;
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  await dynamicRequest();
  const { id } = await ctx.params;
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  }

  if (!parsed.data.tx) {
    const order = await mirror(id);
    if (!order) return NextResponse.json({ error: "Order not onchain yet. Send the buyer's signed confirm transaction.", needsSignature: true }, { status: 404 });
    return NextResponse.json({ order, relayed: false });
  }

  const relayer = loadRelayer();
  if (!relayer) return NextResponse.json({ error: "Relayer not configured" }, { status: 503 });

  let tx: VersionedTransaction;
  try {
    tx = VersionedTransaction.deserialize(Buffer.from(parsed.data.tx, "base64"));
  } catch {
    return NextResponse.json({ error: "Could not decode transaction" }, { status: 400 });
  }
  const programId = PROGRAM_ID ?? new PublicKey(idl.address);
  const verdict = checkRelayTx(tx, relayer.publicKey, programId);
  if (!verdict.ok) return NextResponse.json({ error: `Rejected: ${verdict.reason}` }, { status: 400 });

  tx.sign([relayer]);
  const conn = new Connection(RPC_URL, "confirmed");
  let signature: string;
  try {
    signature = await conn.sendRawTransaction(tx.serialize(), { preflightCommitment: "confirmed" });
  } catch (err) {
    const logs = err instanceof SendTransactionError ? await err.getLogs(conn).catch(() => []) : [];
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err), logs }, { status: 400 });
  }
  const lastValidBlockHeight = parsed.data.lastValidBlockHeight
    ?? (await conn.getLatestBlockhash("confirmed")).lastValidBlockHeight;
  const res = await conn.confirmTransaction(
    { signature, blockhash: tx.message.recentBlockhash, lastValidBlockHeight },
    "confirmed",
  );
  if (res.value.err) {
    return NextResponse.json({ error: "Transaction failed", signature }, { status: 400 });
  }
  const order = await mirror(id);
  return NextResponse.json({ signature, order, relayed: true });
}
