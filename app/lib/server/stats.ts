// Owner: B to review, added by A. Numbers for the live "protection" ticker on Discover, computed from the
// Supabase tables the QuickNode Stream fills (lib/server/apply-events.ts). Never throws: a missing table or an
// unconfigured Supabase counts as empty.
//
// Formula
//   protectedUsd  = primaryUsd + resaleUsd + escrowUsd
//     primaryUsd  = Σ over Tier 1 tickets (TicketMinted) of their event's face price (events.price_from_usd)
//     resaleUsd   = Σ orders.amount_usd where tier = 1 (TicketSwapped: the atomic swap price)
//     escrowUsd   = Σ orders.amount_usd where tier = 2 (an escrow order row exists once OrderFunded)
//   scamsRefunded = # order_events of type REFUNDED (seller missed the ship deadline, auto-refund)
//     refundedUsd = Σ over refunded orders of amount_usd + the escrow listing's bond_usd
//   fairResales   = # order_events of type SWAPPED
//     fairShare   = share of swapped orders priced ≤ their event's resale cap (program enforces it: 100%)
//   scalpersBlocked = # blocked_attempts (over-cap listings the program rejected; see supabase/blocked_attempts.sql)

import type { SupabaseClient } from "@supabase/supabase-js";
import { explorerTx } from "@/lib/solana";

export interface ActivityItem {
  id: string;
  kind: "resale" | "refund" | "escrow" | "delivered" | "dispute" | "blocked" | "sent";
  text: string;
  at: string;
  explorerUrl: string | null;
}

export interface Stats {
  source: "supabase" | "empty" | "mock";
  protectedUsd: number;
  primaryUsd: number;
  resaleUsd: number;
  escrowUsd: number;
  scamsRefunded: number;
  refundedUsd: number;
  fairResales: number;
  /** 0..1, null when no resale has a known cap. */
  fairShare: number | null;
  scalpersBlocked: number;
  recent: ActivityItem[];
  updatedAt: string;
}

export const EMPTY_STATS = (): Stats => ({
  source: "empty",
  protectedUsd: 0,
  primaryUsd: 0,
  resaleUsd: 0,
  escrowUsd: 0,
  scamsRefunded: 0,
  refundedUsd: 0,
  fairResales: 0,
  fairShare: null,
  scalpersBlocked: 0,
  recent: [],
  updatedAt: new Date().toISOString(),
});

const money = (n: number) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;
const num = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0)) || 0;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Rows of a table, or [] if it doesn't exist / can't be read. */
async function rows<T>(db: SupabaseClient, table: string, columns: string, limit = 5000): Promise<T[]> {
  const { data, error } = await db.from(table).select(columns).limit(limit);
  if (error) {
    console.warn(`stats: ${table} unavailable: ${error.message}`);
    return [];
  }
  return (data ?? []) as T[];
}

type EventRow = { id: string; title: string; price_from_usd: number; resale_cap_usd: number | null };
type MetaRow = { id: string; kind: string; data: { title?: string } };
type TicketRow = { id: string; event_id: string; tier: number };
type OrderRow = { id: string; listing_id: string; event_id: string; amount_usd: number; tier: number; state: string };
type ListingRow = { id: string; bond_usd: number; event_id: string };
type OrderEventRow = { id: string; order_id: string; type: string; tx_signature: string | null; at: string };
type BlockedRow = { id: string; event_id: string | null; price_usd: number | null; cap_usd: number | null; at: string };

export async function computeStats(db: SupabaseClient | null): Promise<Stats> {
  if (!db) return EMPTY_STATS();
  try {
    const [events, meta, tickets, orders, listings, orderEvents, blocked] = await Promise.all([
      rows<EventRow>(db, "events", "id, title, price_from_usd, resale_cap_usd"),
      rows<MetaRow>(db, "event_meta", "id, kind, data"),
      rows<TicketRow>(db, "tickets", "id, event_id, tier"),
      rows<OrderRow>(db, "orders", "id, listing_id, event_id, amount_usd, tier, state"),
      rows<ListingRow>(db, "listings", "id, bond_usd, event_id"),
      rows<OrderEventRow>(db, "order_events", "id, order_id, type, tx_signature, at"),
      rows<BlockedRow>(db, "blocked_attempts", "id, event_id, price_usd, cap_usd, at"),
    ]);

    const eventById = new Map(events.map((e) => [e.id, e]));
    const titleOf = (id: string | null | undefined) =>
      (id && (eventById.get(id)?.title || meta.find((m) => m.id === id && m.kind === "event")?.data?.title)) || null;
    const orderById = new Map(orders.map((o) => [o.id, o]));
    const bondOf = (o: OrderRow | undefined) => num(listings.find((l) => l.id === (o?.listing_id ?? ""))?.bond_usd);

    const primaryUsd = tickets
      .filter((t) => t.tier === 1)
      .reduce((s, t) => s + num(eventById.get(t.event_id)?.price_from_usd), 0);
    const resaleOrders = orders.filter((o) => o.tier === 1);
    const resaleUsd = resaleOrders.reduce((s, o) => s + num(o.amount_usd), 0);
    const escrowUsd = orders.filter((o) => o.tier === 2).reduce((s, o) => s + num(o.amount_usd), 0);

    const refundEvents = orderEvents.filter((e) => e.type === "REFUNDED");
    const refundedUsd = refundEvents.reduce((s, e) => {
      const o = orderById.get(e.order_id);
      return s + num(o?.amount_usd) + bondOf(o);
    }, 0);
    const swapEvents = orderEvents.filter((e) => e.type === "SWAPPED");
    const capped = resaleOrders.filter((o) => eventById.get(o.event_id)?.resale_cap_usd != null);
    const fair = capped.filter((o) => num(o.amount_usd) <= num(eventById.get(o.event_id)!.resale_cap_usd) + 1e-9);

    const describe = (e: OrderEventRow): ActivityItem | null => {
      const o = orderById.get(e.order_id);
      const title = titleOf(o?.event_id);
      const at = title ? ` · ${title}` : "";
      const amount = num(o?.amount_usd);
      const base = { id: e.id, at: e.at, explorerUrl: e.tx_signature ? explorerTx(e.tx_signature) : null };
      switch (e.type) {
        case "SWAPPED":
          return { ...base, kind: "resale", text: `Ticket resold at a fair ${money(amount)}${at}` };
        case "REFUNDED":
          return { ...base, kind: "refund", text: `Scam stopped: ${money(round2(amount + bondOf(o)))} auto-refunded${at}` };
        case "FUNDED":
          return { ...base, kind: "escrow", text: `${money(amount)} locked in a SeatSafe vault${at}` };
        case "TICKET_SENT":
          return { ...base, kind: "sent", text: `Seller sent an outside ticket${at}` };
        case "RELEASED":
        case "CONFIRMED":
          return { ...base, kind: "delivered", text: `Ticket delivered, seller paid${at}` };
        case "DISPUTE_OPENED":
        case "DISPUTE_RESOLVED":
          return { ...base, kind: "dispute", text: `${e.type === "DISPUTE_OPENED" ? "Dispute opened, funds frozen" : "Dispute resolved"}${at}` };
        default:
          return null;
      }
    };
    const blockedItems: ActivityItem[] = blocked.map((b) => {
      const title = titleOf(b.event_id);
      const over = b.price_usd != null && b.cap_usd != null ? `${money(num(b.price_usd))} over the ${money(num(b.cap_usd))} cap` : "listing over the cap";
      return { id: `blocked:${b.id}`, kind: "blocked", at: b.at, explorerUrl: null, text: `Scalper blocked: ${over}${title ? ` · ${title}` : ""}` };
    });
    const recent = [...orderEvents.map(describe).filter((x): x is ActivityItem => x !== null), ...blockedItems]
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 8);

    const empty = tickets.length + orders.length + orderEvents.length + blocked.length === 0;
    return {
      source: empty ? "empty" : "supabase",
      protectedUsd: round2(primaryUsd + resaleUsd + escrowUsd),
      primaryUsd: round2(primaryUsd),
      resaleUsd: round2(resaleUsd),
      escrowUsd: round2(escrowUsd),
      scamsRefunded: refundEvents.length,
      refundedUsd: round2(refundedUsd),
      fairResales: swapEvents.length,
      fairShare: capped.length ? fair.length / capped.length : null,
      scalpersBlocked: blocked.length,
      recent,
      updatedAt: new Date().toISOString(),
    };
  } catch (err) {
    console.warn("stats failed:", err instanceof Error ? err.message : err);
    return EMPTY_STATS();
  }
}
