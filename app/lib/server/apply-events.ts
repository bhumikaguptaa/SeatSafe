// Decode Anchor "Program data:" logs and mirror them into Supabase.
// Idempotent per signature. Order state only moves forward (lib/order-state.ts).

import { BorshCoder, type Idl } from "@coral-xyz/anchor";
import idl from "@/lib/idl/seatsafe.json";
import { canAdvance } from "@/lib/order-state";
import type { OrderEvent, OrderState } from "@/lib/types";
import type { InboundTx } from "@/lib/webhook-payload";
import { considerListing } from "@/lib/server/matcher";
import { supabaseAdmin } from "@/lib/server/supabase-admin";
import { notifyForEvent } from "@/lib/server/notify"; // added by A

const PROGRAM_ID = process.env.NEXT_PUBLIC_PROGRAM_ID || (idl as { address: string }).address;

let coder: BorshCoder | null = null;
function eventCoder(): BorshCoder {
  if (!coder) coder = new BorshCoder(idl as Idl);
  return coder;
}

export interface DecodedEvent {
  name: string;
  data: Record<string, unknown>;
}

export function decodeProgramEvents(logs: string[]): DecodedEvent[] {
  const out: DecodedEvent[] = [];
  const events = eventCoder().events;
  for (const line of logs) {
    const marker = "Program data: ";
    const at = line.indexOf(marker);
    if (at < 0) continue;
    const b64 = line.slice(at + marker.length).trim();
    try {
      const decoded = events.decode(b64);
      if (!decoded) continue;
      out.push({ name: decoded.name, data: decoded.data as Record<string, unknown> });
    } catch {
      // Account data and non-event logs share this prefix. Ignore what isn't our event.
    }
  }
  return out;
}

function field(data: Record<string, unknown>, snake: string): unknown {
  if (snake in data) return data[snake];
  const camel = snake.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
  return data[camel];
}

function pubkey(v: unknown): string {
  if (!v) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object" && v && "toBase58" in v && typeof (v as { toBase58: unknown }).toBase58 === "function") {
    return (v as { toBase58: () => string }).toBase58();
  }
  return String(v);
}

function num(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v && typeof v === "object" && "toString" in v) {
    const n = Number((v as { toString: () => string }).toString());
    return Number.isFinite(n) ? n : 0;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function usd(units: unknown): number {
  return num(units) / 1_000_000;
}

function iso(unixSecs: unknown): string {
  const n = num(unixSecs);
  return new Date((n > 10_000_000_000 ? n : n * 1000)).toISOString();
}

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

function pk(data: Record<string, unknown>, name: string): string {
  return pubkey(field(data, name));
}

type Db = NonNullable<ReturnType<typeof supabaseAdmin>>;

async function upsertOrder(
  db: Db,
  row: {
    id: string;
    listing_id: string;
    event_id: string;
    buyer_id: string;
    seller_id: string;
    amount_usd: number;
    tier: 1 | 2;
    state: OrderState;
    ship_deadline: string;
    confirm_deadline: string;
    vault_address?: string | null;
  },
  event: { id: string; type: OrderEvent["type"]; message: string; tx?: string; at: string },
): Promise<boolean> {
  const { data: existing } = await db.from("orders").select("state, event_id, amount_usd").eq("id", row.id).maybeSingle();
  const current = (existing?.state as OrderState | undefined) ?? null;
  if (existing && !canAdvance(current, row.state)) return false;

  const saved = {
    ...row,
    event_id: row.event_id || existing?.event_id || "",
    amount_usd: row.amount_usd || Number(existing?.amount_usd ?? 0),
  };
  const { error } = existing
    ? await db.from("orders").update(saved).eq("id", row.id)
    : await db.from("orders").insert(saved);
  if (error) throw new Error(error.message);

  const { error: eventError } = await db.from("order_events").upsert(
    {
      id: event.id,
      order_id: row.id,
      type: event.type,
      message: event.message,
      tx_signature: event.tx ?? null,
      at: event.at,
    },
    { onConflict: "id", ignoreDuplicates: true },
  );
  if (eventError) throw new Error(eventError.message);
  return true;
}

async function sellerRating(db: Db, seller: string): Promise<number | null> {
  const { data } = await db.from("users").select("rating").eq("id", seller).maybeSingle();
  if (!data || data.rating === null || data.rating === undefined) return null;
  return Number(data.rating);
}

async function rememberUser(db: Db, id: string) {
  if (!id) return;
  await db.from("users").upsert({ id, wallet: id }, { onConflict: "id", ignoreDuplicates: true });
}

export async function applyDecodedEvent(
  db: Db,
  ev: DecodedEvent,
  signature: string,
  index: number,
): Promise<string | null> {
  const data = ev.data;
  const at = iso(field(data, "at"));
  const eventId = `${signature}:${ev.name}:${index}`;
  const name = ev.name;

  if (name === "EventCreated") {
    const id = pk(data, "event");
    const price = usd(field(data, "price"));
    const { data: existing } = await db.from("events").select("id").eq("id", id).maybeSingle();
    const numbers = {
      starts_at: iso(field(data, "starts_at")),
      price_from_usd: price,
      resale_cap_usd: usd(field(data, "resale_cap")),
      royalty_bps: num(field(data, "royalty_bps")),
    };
    const { error } = existing
      ? await db.from("events").update(numbers).eq("id", id)
      : await db.from("events").insert({
          id,
          title: `Event ${id.slice(0, 4)}`,
          category: "concert",
          venue: "Venue TBA",
          city: "",
          image_gradient: "bg-gradient-to-br from-slate-600 via-slate-800 to-slate-950",
          organizer_name: "Independent organizer",
          ...numbers,
        });
    if (error) throw new Error(error.message);
    return name;
  }

  if (name === "TicketMinted") {
    const mint = pk(data, "ticket_mint");
    const buyer = pk(data, "buyer");
    await rememberUser(db, buyer);
    const { error } = await db.from("tickets").upsert({
      id: mint,
      event_id: pk(data, "event"),
      section: "",
      row_label: "",
      seat: String(field(data, "seat") ?? ""),
      tier: 1,
      owner_id: buyer,
      mint_address: mint,
    }, { onConflict: "id" });
    if (error) throw new Error(error.message);
    return name;
  }

  if (name === "ListingCreated" || name === "EscrowListed") {
    const tier = name === "ListingCreated" ? 1 : 2;
    const id = name === "ListingCreated" ? pk(data, "listing") : pk(data, "escrow");
    const seller = pk(data, "seller");
    await rememberUser(db, seller);
    const rating = await sellerRating(db, seller);
    const price = usd(field(data, "price"));
    const ticketMint = name === "ListingCreated" ? pk(data, "ticket_mint") : null;
    const row = {
      id,
      ticket_id: ticketMint,
      ticket_mint: ticketMint,
      event_id: name === "ListingCreated" ? pk(data, "event") : "",
      seller_id: seller,
      seller_name: `${seller.slice(0, 4)}…${seller.slice(-4)}`,
      seller_rating: rating,
      price_usd: price,
      tier,
      bond_usd: name === "EscrowListed" ? usd(field(data, "bond")) : 0,
      status: "active",
      created_at: at,
    };
    const { error } = await db.from("listings").upsert(row, { onConflict: "id" });
    if (error) throw new Error(error.message);
    if (name === "ListingCreated") {
      await considerListing({
        id,
        eventId: row.event_id,
        sellerId: seller,
        priceUsd: price,
        sellerRating: rating,
        ticketMint,
        seat: null,
      });
    }
    return name;
  }

  if (name === "ListingCancelled") {
    await db.from("listings").update({ status: "cancelled" }).eq("id", pk(data, "listing"));
    return name;
  }

  if (name === "TicketSwapped") {
    const listing = pk(data, "listing");
    const buyer = pk(data, "buyer");
    const seller = pk(data, "seller");
    const price = usd(field(data, "price"));
    await rememberUser(db, buyer);
    await rememberUser(db, seller);
    await db.from("listings").update({ status: "sold" }).eq("id", listing);
    await db.from("tickets").update({ owner_id: buyer }).eq("id", pk(data, "ticket_mint"));
    await upsertOrder(db, {
      id: listing,
      listing_id: listing,
      event_id: pk(data, "event"),
      buyer_id: buyer,
      seller_id: seller,
      amount_usd: price,
      tier: 1,
      state: "SWAPPED",
      ship_deadline: at,
      confirm_deadline: at,
    }, {
      id: eventId,
      type: "SWAPPED",
      message: `Ticket and payment swapped in one transaction at ${money(price)}.`,
      tx: signature,
      at,
    });
    return name;
  }

  if (name === "OrderFunded") {
    const escrow = pk(data, "escrow");
    const price = usd(field(data, "price"));
    const buyer = pk(data, "buyer");
    const seller = pk(data, "seller");
    await rememberUser(db, buyer);
    await rememberUser(db, seller);
    const { data: listing } = await db.from("listings").select("event_id, bond_usd").eq("id", escrow).maybeSingle();
    await upsertOrder(db, {
      id: escrow,
      listing_id: escrow,
      event_id: (listing?.event_id as string) || "",
      buyer_id: buyer,
      seller_id: seller,
      amount_usd: price,
      tier: 2,
      state: "HELD",
      ship_deadline: iso(field(data, "ship_deadline")),
      confirm_deadline: iso(field(data, "ship_deadline")),
      vault_address: escrow,
    }, {
      id: eventId,
      type: "FUNDED",
      message: `Payment of ${money(price)} locked in the SeatSafe vault.`,
      tx: signature,
      at,
    });
    return name;
  }

  if (name === "TicketSent") {
    const escrow = pk(data, "escrow");
    const atConfirm = iso(field(data, "confirm_deadline"));
    const { data: existing } = await db.from("orders").select("*").eq("id", escrow).maybeSingle();
    await upsertOrder(db, {
      id: escrow,
      listing_id: existing?.listing_id ?? escrow,
      event_id: existing?.event_id ?? "",
      buyer_id: pk(data, "buyer") || existing?.buyer_id || "",
      seller_id: pk(data, "seller") || existing?.seller_id || "",
      amount_usd: Number(existing?.amount_usd ?? 0),
      tier: 2,
      state: "IN_TRANSIT",
      ship_deadline: existing?.ship_deadline ?? at,
      confirm_deadline: atConfirm,
      vault_address: existing?.vault_address ?? escrow,
    }, {
      id: eventId,
      type: "TICKET_SENT",
      message: "Seller sent the ticket.",
      tx: signature,
      at,
    });
    return name;
  }

  if (name === "OrderCompleted") {
    const escrow = pk(data, "escrow");
    const auto = field(data, "auto") === true;
    const { data: existing } = await db.from("orders").select("*").eq("id", escrow).maybeSingle();
    const base = {
      id: escrow,
      listing_id: existing?.listing_id ?? escrow,
      event_id: existing?.event_id ?? "",
      buyer_id: pk(data, "buyer") || existing?.buyer_id || "",
      seller_id: pk(data, "seller") || existing?.seller_id || "",
      amount_usd: Number(existing?.amount_usd ?? 0),
      tier: 2 as const,
      ship_deadline: existing?.ship_deadline ?? at,
      confirm_deadline: existing?.confirm_deadline ?? at,
      vault_address: existing?.vault_address ?? escrow,
    };
    if (!auto) {
      await upsertOrder(db, { ...base, state: "CONFIRMED" }, {
        id: `${eventId}:confirmed`,
        type: "CONFIRMED",
        message: "Buyer confirmed the ticket.",
        tx: signature,
        at,
      });
    }
    await upsertOrder(db, { ...base, state: "RELEASED" }, {
      id: eventId,
      type: "RELEASED",
      message: auto
        ? "Confirm window ended. Payment released to the seller."
        : `Seller paid ${money(usd(field(data, "seller_amount")))}.`,
      tx: signature,
      at,
    });
    return name;
  }

  if (name === "OrderRefunded") {
    const escrow = pk(data, "escrow");
    const amount = usd(field(data, "amount"));
    const { data: existing } = await db.from("orders").select("*").eq("id", escrow).maybeSingle();
    await upsertOrder(db, {
      id: escrow,
      listing_id: existing?.listing_id ?? escrow,
      event_id: existing?.event_id ?? "",
      buyer_id: pk(data, "buyer") || existing?.buyer_id || "",
      seller_id: pk(data, "seller") || existing?.seller_id || "",
      amount_usd: Number(existing?.amount_usd ?? 0) || amount,
      tier: 2,
      state: "REFUNDED",
      ship_deadline: existing?.ship_deadline ?? at,
      confirm_deadline: existing?.confirm_deadline ?? at,
      vault_address: existing?.vault_address ?? escrow,
    }, {
      id: eventId,
      type: "REFUNDED",
      message: `Deadline missed. Buyer refunded ${money(amount)}, including the seller bond.`,
      tx: signature,
      at,
    });
    return name;
  }

  if (name === "DisputeOpened") {
    const escrow = pk(data, "escrow");
    const { data: existing } = await db.from("orders").select("*").eq("id", escrow).maybeSingle();
    if (!existing) return null;
    await upsertOrder(db, {
      id: escrow,
      listing_id: existing.listing_id,
      event_id: existing.event_id,
      buyer_id: existing.buyer_id,
      seller_id: existing.seller_id,
      amount_usd: Number(existing.amount_usd),
      tier: existing.tier === 1 ? 1 : 2,
      state: "DISPUTED",
      ship_deadline: existing.ship_deadline,
      confirm_deadline: existing.confirm_deadline,
      vault_address: existing.vault_address,
    }, {
      id: eventId,
      type: "DISPUTE_OPENED",
      message: "A dispute was opened. Funds stay locked.",
      tx: signature,
      at,
    });
    return name;
  }

  if (name === "DisputeResolved") {
    const escrow = pk(data, "escrow");
    const buyerAmount = usd(field(data, "buyer_amount"));
    const sellerAmount = usd(field(data, "seller_amount"));
    const { data: existing } = await db.from("orders").select("*").eq("id", escrow).maybeSingle();
    if (!existing) return null;
    const next: OrderState = buyerAmount > 0 && sellerAmount === 0 ? "REFUNDED" : "RELEASED";
    await upsertOrder(db, {
      id: escrow,
      listing_id: existing.listing_id,
      event_id: existing.event_id,
      buyer_id: existing.buyer_id,
      seller_id: existing.seller_id,
      amount_usd: Number(existing.amount_usd),
      tier: 2,
      state: next,
      ship_deadline: existing.ship_deadline,
      confirm_deadline: existing.confirm_deadline,
      vault_address: existing.vault_address,
    }, {
      id: eventId,
      type: "DISPUTE_RESOLVED",
      message: `Dispute resolved. Buyer ${money(buyerAmount)}, seller ${money(sellerAmount)}.`,
      tx: signature,
      at,
    });
    return name;
  }

  if (name === "StandingOrderOpened") {
    const id = pk(data, "standing_order");
    const owner = pk(data, "owner");
    const event = pk(data, "event");
    const maxPrice = usd(field(data, "max_price"));
    const quantity = num(field(data, "quantity"));
    await rememberUser(db, owner);
    const { data: draft } = await db
      .from("standing_order_drafts")
      .select("id, min_seller_rating")
      .eq("user_id", owner)
      .eq("event_id", event)
      .is("linked_order_id", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const minRating = draft ? Number(draft.min_seller_rating ?? 0) : 0;
    const { error } = await db.from("standing_orders").upsert({
      id,
      user_id: owner,
      event_id: event,
      quantity,
      max_price_usd: maxPrice,
      min_seller_rating: minRating,
      deadline: iso(field(data, "deadline")),
      budget_usd: usd(field(data, "budget")),
      status: "OPEN",
      filled: 0,
      spent_usd: 0,
    }, { onConflict: "id" });
    if (error) throw new Error(error.message);
    if (draft?.id) {
      await db.from("standing_order_drafts").update({ linked_order_id: id }).eq("id", draft.id);
    }
    await db.from("agent_log").upsert({
      id: eventId,
      standing_order_id: id,
      kind: "lock",
      message: `Locked ${money(usd(field(data, "budget")))} in the budget vault.`,
      at,
    }, { onConflict: "id", ignoreDuplicates: true });
    return name;
  }

  if (name === "StandingOrderFilled") {
    const id = pk(data, "standing_order");
    const filled = num(field(data, "filled"));
    const quantity = num(field(data, "quantity"));
    const price = usd(field(data, "price"));
    const { data: existing } = await db.from("standing_orders").select("spent_usd").eq("id", id).maybeSingle();
    const spent = Number(existing?.spent_usd ?? 0) + price;
    await db.from("standing_orders").update({
      filled,
      spent_usd: spent,
      status: filled >= quantity ? "FILLED" : "OPEN",
    }).eq("id", id);
    await db.from("agent_log").upsert({
      id: eventId,
      standing_order_id: id,
      kind: "filled",
      message: `Filled listing ${pk(data, "listing").slice(0, 4)} at ${money(price)} (${filled} of ${quantity}).`,
      at,
    }, { onConflict: "id", ignoreDuplicates: true });
    return name;
  }

  if (name === "StandingOrderClosed") {
    const id = pk(data, "standing_order");
    const filled = num(field(data, "filled"));
    const { data: existing } = await db.from("standing_orders").select("quantity").eq("id", id).maybeSingle();
    const quantity = Number(existing?.quantity ?? filled);
    await db.from("standing_orders").update({
      status: filled >= quantity && quantity > 0 ? "FILLED" : "CANCELLED",
      filled,
    }).eq("id", id);
    await db.from("agent_log").upsert({
      id: eventId,
      standing_order_id: id,
      kind: "lock",
      message: `Order closed. ${money(usd(field(data, "refunded")))} of unused budget returned.`,
      at,
    }, { onConflict: "id", ignoreDuplicates: true });
    return name;
  }

  return null;
}

export interface TxResult {
  signature: string;
  duplicate?: boolean;
  skipped?: boolean;
  applied: string[];
  error?: string;
}

/** Apply one transaction. A signature already in processed_signatures is a no-op. */
export async function processTransaction(tx: InboundTx): Promise<TxResult> {
  const db = supabaseAdmin();
  if (!db) return { signature: tx.signature, applied: [], error: "Supabase is not configured" };

  const { data: seen } = await db.from("processed_signatures").select("signature").eq("signature", tx.signature).maybeSingle();
  if (seen) return { signature: tx.signature, duplicate: true, applied: [] };

  const joined = tx.logs.join("\n");
  if (!joined.includes(PROGRAM_ID)) {
    return { signature: tx.signature, skipped: true, applied: [] };
  }

  const decoded = decodeProgramEvents(tx.logs);
  const applied: string[] = [];
  try {
    for (let i = 0; i < decoded.length; i++) {
      const name = await applyDecodedEvent(db, decoded[i]!, tx.signature, i);
      if (name) applied.push(name);
      // Added by A: Stream-triggered notifications (lib/server/notify.ts). Never fails the webhook.
      if (name) {
        await notifyForEvent(db, decoded[i]!, tx.signature).catch((err) =>
          console.warn("notify failed:", err instanceof Error ? err.message : err),
        );
      }
    }
    const { error } = await db.from("processed_signatures").insert({
      signature: tx.signature,
      slot: tx.slot ?? null,
      event_count: applied.length,
    });
    if (error && error.code !== "23505") throw new Error(error.message);
    return { signature: tx.signature, applied, duplicate: error?.code === "23505" };
  } catch (err) {
    return { signature: tx.signature, applied, error: err instanceof Error ? err.message : String(err) };
  }
}
