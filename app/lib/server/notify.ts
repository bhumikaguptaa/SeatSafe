// Owner: B to review, added by A. Stream-triggered notifications: for each decoded SeatSafe event the
// QuickNode Stream delivers (apply-events.ts processTransaction), write in-app notifications for the people
// affected. Idempotent: unique (tx_signature, wallet, kind), inserted with ignoreDuplicates, so repeated
// deliveries never double-notify. Never throws into the webhook (the caller catches and logs).
// Titles never contain full wallet addresses.

import type { SupabaseClient } from "@supabase/supabase-js";
import { PublicKey } from "@solana/web3.js";
import { chainProgram } from "@/lib/chain";
import { pdas } from "@/lib/program";
import { formatDate } from "@/lib/format";
import bundledMeta from "@/lib/event-meta.json";
import type { DecodedEvent } from "@/lib/server/apply-events";

export interface NotificationRow {
  wallet: string;
  kind: string;
  title: string;
  body: string;
  url: string | null;
  tx_signature: string;
}

function field(data: Record<string, unknown>, snake: string): unknown {
  if (snake in data) return data[snake];
  return data[snake.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())];
}
function key(data: Record<string, unknown>, name: string): string {
  const v = field(data, name) as { toBase58?: () => string } | string | undefined;
  if (!v) return "";
  return typeof v === "string" ? v : v.toBase58?.() ?? String(v);
}
function usd(data: Record<string, unknown>, name: string): number {
  const v = field(data, name) as { toString(): string } | number | undefined;
  return v == null ? 0 : Number(v.toString()) / 1_000_000;
}
function when(data: Record<string, unknown>, name: string): string {
  const v = field(data, name) as { toString(): string } | number | undefined;
  return v == null ? "" : formatDate(new Date(Number(v.toString()) * 1000).toISOString());
}
const money = (n: number) => `$${n.toFixed(2)}`;

type Meta = { events?: Record<string, { title?: string }>; escrows?: Record<string, { eventId?: string; seat?: string }> };
const bundled = bundledMeta as Meta;

async function eventTitle(db: SupabaseClient, eventId: string): Promise<string> {
  if (!eventId) return "";
  const { data } = await db.from("events").select("title").eq("id", eventId).maybeSingle();
  if (data?.title) return data.title as string;
  const { data: m } = await db.from("event_meta").select("data").eq("id", eventId).maybeSingle();
  return ((m?.data as { title?: string } | undefined)?.title ?? bundled.events?.[eventId]?.title ?? "") as string;
}

/** Event id for an escrow (orders row written by apply-events, else event-meta). */
async function escrowEvent(db: SupabaseClient, escrow: string): Promise<string> {
  const { data } = await db.from("orders").select("event_id").eq("id", escrow).maybeSingle();
  if (data?.event_id) return data.event_id as string;
  const { data: m } = await db.from("event_meta").select("data").eq("id", escrow).maybeSingle();
  return ((m?.data as { eventId?: string } | undefined)?.eventId ?? bundled.escrows?.[escrow]?.eventId ?? "") as string;
}

const suffix = (t: string) => (t ? ` · ${t}` : "");

/** Pure-ish mapping: which notifications one decoded event produces (reads names/prices from Supabase). */
export async function notificationsFor(db: SupabaseClient, ev: DecodedEvent, signature: string): Promise<NotificationRow[]> {
  const d = ev.data;
  const row = (wallet: string, kind: string, title: string, body: string, url: string | null): NotificationRow | null =>
    wallet ? { wallet, kind, title, body, url, tx_signature: signature } : null;
  const out: (NotificationRow | null)[] = [];

  switch (ev.name) {
    case "TicketMinted": {
      const title = await eventTitle(db, key(d, "event"));
      const seat = String(field(d, "seat") ?? "");
      out.push(row(key(d, "buyer"), "minted", `You're in! Ticket for ${title || "your event"}`, `${seat ? `${seat}. ` : ""}Find it in My tickets.`, "/tickets"));
      break;
    }
    case "TicketSwapped": {
      const title = await eventTitle(db, key(d, "event"));
      const { data: t } = await db.from("tickets").select("seat").eq("id", key(d, "ticket_mint")).maybeSingle();
      // Tickets minted before the Stream existed have no row: read the seat from the onchain TicketRecord.
      let seat = (t?.seat as string | undefined) || "";
      if (!seat) {
        const program = chainProgram();
        const record = await program.account.ticketRecord
          .fetchNullable(pdas(program.programId).ticketRecord(new PublicKey(key(d, "ticket_mint"))))
          .catch(() => null);
        seat = record?.seat || "Your ticket";
      }
      out.push(row(key(d, "seller"), "sold", `Your ticket sold: ${money(usd(d, "seller_amount"))} received`, `Resold at ${money(usd(d, "price"))}${suffix(title)}. Paid in the same transaction.`, "/tickets"));
      out.push(row(key(d, "buyer"), "bought", `Ticket bought: ${seat}${suffix(title)}`, "It's in My tickets. Add it to your calendar from there.", "/tickets"));
      break;
    }
    case "OrderFunded": {
      const escrow = key(d, "escrow");
      const title = await eventTitle(db, await escrowEvent(db, escrow));
      out.push(row(key(d, "seller"), "escrow_funded", `Someone bought your outside ticket: send it by ${when(d, "ship_deadline")}`, `${money(usd(d, "price"))} is locked in the SeatSafe vault${suffix(title)}. Mark it sent under My escrow sales.`, "/sell"));
      break;
    }
    case "TicketSent": {
      const escrow = key(d, "escrow");
      out.push(row(key(d, "buyer"), "ticket_sent", "Your ticket is on its way: confirm when it arrives", `Confirm or open a dispute by ${when(d, "confirm_deadline")}, or the payment is released to the seller.`, `/orders/${escrow}`));
      break;
    }
    case "OrderCompleted": {
      const escrow = key(d, "escrow");
      const paid = usd(d, "seller_amount");
      const bond = usd(d, "bond_returned");
      out.push(row(key(d, "seller"), "released", `Payment released: ${money(paid)}`, `${bond ? `Your ${money(bond)} bond is back too. ` : ""}${field(d, "auto") ? "The buyer's confirm window ended." : "The buyer confirmed the ticket."}`, `/orders/${escrow}`));
      break;
    }
    case "OrderRefunded": {
      const escrow = key(d, "escrow");
      const total = usd(d, "amount");
      const { data: o } = await db.from("orders").select("amount_usd").eq("id", escrow).maybeSingle();
      const price = Number(o?.amount_usd ?? 0);
      const split = price > 0 && price < total ? `your ${money(price)} (+ ${money(total - price)} bond)` : `your ${money(total)}`;
      out.push(row(key(d, "buyer"), "refunded", `Seller didn't deliver: ${split} is back`, "The ship deadline passed, so SeatSafe refunded you automatically.", `/orders/${escrow}`));
      break;
    }
    case "StandingOrderFilled": {
      const filled = Number(field(d, "filled") ?? 0);
      const quantity = Number(field(d, "quantity") ?? 0);
      out.push(row(key(d, "owner"), "agent_filled", `Your agent bought a ticket for ${money(usd(d, "price"))}`, quantity ? `${filled} of ${quantity} filled.` : "", "/agent"));
      break;
    }
    case "DisputeOpened": {
      const escrow = key(d, "escrow");
      const { data: o } = await db.from("orders").select("buyer_id, seller_id").eq("id", escrow).maybeSingle();
      const text = `Funds stay locked until it's settled (by ${when(d, "dispute_deadline")}).`;
      out.push(row((o?.buyer_id as string) ?? "", "dispute_opened", "A dispute was opened on your order", text, `/orders/${escrow}`));
      out.push(row((o?.seller_id as string) ?? "", "dispute_opened", "A dispute was opened on your sale", text, `/orders/${escrow}`));
      break;
    }
    case "DisputeResolved": {
      const escrow = key(d, "escrow");
      out.push(row(key(d, "buyer"), "dispute_resolved", `Dispute settled: you received ${money(usd(d, "buyer_amount"))}`, "", `/orders/${escrow}`));
      out.push(row(key(d, "seller"), "dispute_resolved", `Dispute settled: you received ${money(usd(d, "seller_amount"))}`, "", `/orders/${escrow}`));
      break;
    }
  }
  return out.filter((r): r is NotificationRow => r !== null);
}

/** Insert this event's notifications once. Returns how many rows were new. */
export async function notifyForEvent(db: SupabaseClient, ev: DecodedEvent, signature: string): Promise<number> {
  const rows = await notificationsFor(db, ev, signature);
  if (!rows.length) return 0;
  const { data, error } = await db
    .from("notifications")
    .upsert(rows, { onConflict: "tx_signature,wallet,kind", ignoreDuplicates: true })
    .select("id");
  if (error) throw new Error(`notifications: ${error.message}`);
  return data?.length ?? 0;
}
