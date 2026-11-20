// Owner: A. Deterministic seat map for the 3D stadium picker. Same input → same seat, on every device.
//
// Bowl: 10 named sections + a VIP box. Each section has fixed rows / seats per row (lib-level, no 3D here).
// Rule (documented in README):
//   - Inventory: an event's `supply` tickets are spread round-robin over the 10 sections (ticket index i →
//     section i mod 10), and inside a section they take the best seats first (front rows, centre outwards).
//     So ticket index i always maps to the same seat. Seats outside the inventory are "not on sale".
//   - Taken (blue): ticket index < event.sold (minted). A ticket bought in the 3D picker stores its stadium seat
//     code ("WL R3 S12") onchain (TicketRecord.seat), and is drawn at THAT seat (buy_primary always mints index
//     `sold`, not the clicked seat). Legacy seats ("Lawn GA 5") fall back to the index rule. Available seats
//     skip any seat a minted ticket already claims.
//   - Protected resale (green): a minted ticket whose mint (PDA of [event, index]) has an open Tier 1 listing.
//   - Outside ticket · escrow (amber): open Tier 2 escrow listings are not tied to a seat onchain, so each one
//     is placed by a hash of its escrow PDA onto a not-on-sale seat in a corner section.
//   - Available official (red): every other inventory seat (index >= sold). Buy → buy_primary.
// Prices: an event has ONE onchain primary price; a section's "from $X" is the cheapest real seat in it.

import { PublicKey } from "@solana/web3.js";
import { pdas } from "./program";

export type SectionId = "N" | "S" | "EL" | "EU" | "WL" | "WU" | "NE" | "NW" | "SE" | "SW" | "VIP";

export interface SectionDef {
  id: SectionId;
  name: string;
  short: string; // for the onchain seat string (≤ 32 bytes total)
  /** Angular span in degrees (0 = +x, counter-clockwise seen from above). */
  from: number;
  to: number;
  rows: number;
  /** Upper tiers start higher and further back. */
  tier: "lower" | "upper" | "vip";
  corner?: boolean;
}

export const SECTIONS: SectionDef[] = [
  { id: "N", name: "North Stand", short: "N", from: -28, to: 28, rows: 18, tier: "lower" },
  { id: "NE", name: "North-East Corner", short: "NE", from: 28, to: 62, rows: 14, tier: "lower", corner: true },
  { id: "EL", name: "East Lower", short: "EL", from: 62, to: 118, rows: 14, tier: "lower" },
  { id: "EU", name: "East Upper", short: "EU", from: 64, to: 116, rows: 14, tier: "upper" },
  { id: "SE", name: "South-East Corner", short: "SE", from: 118, to: 152, rows: 14, tier: "lower", corner: true },
  { id: "S", name: "South Stand", short: "S", from: 152, to: 208, rows: 18, tier: "lower" },
  { id: "SW", name: "South-West Corner", short: "SW", from: 208, to: 242, rows: 14, tier: "lower", corner: true },
  { id: "WL", name: "West Lower", short: "WL", from: 242, to: 298, rows: 14, tier: "lower" },
  { id: "WU", name: "West Upper", short: "WU", from: 244, to: 296, rows: 14, tier: "upper" },
  { id: "NW", name: "North-West Corner", short: "NW", from: 298, to: 332, rows: 14, tier: "lower", corner: true },
];
/** VIP box: glass-fronted hospitality box between West Lower and West Upper. Shown on "Upgrade to VIP". */
export const VIP: SectionDef = { id: "VIP", name: "VIP Box", short: "VIP", from: 262, to: 278, rows: 3, tier: "vip" };

const SEAT_PITCH_M = 0.62; // metres between seat centres along a row

/** Inner radius of the bowl (rounded rectangle around a 105 × 68 pitch) at angle θ, in metres. */
export function innerRadius(thetaDeg: number, tier: SectionDef["tier"]): number {
  const t = (thetaDeg * Math.PI) / 180;
  const a = tier === "upper" ? 72 : tier === "vip" ? 70 : 60; // half-length (x)
  const b = tier === "upper" ? 54 : tier === "vip" ? 52 : 43; // half-width (z)
  const n = 4; // superellipse exponent: rounded rectangle
  const c = Math.abs(Math.cos(t));
  const s = Math.abs(Math.sin(t));
  return 1 / Math.pow(Math.pow(c / a, n) + Math.pow(s / b, n), 1 / n);
}

export interface SeatSlot {
  section: SectionId;
  row: number; // 1-based, 1 = front
  seat: number; // 1-based
  /** Index of this slot inside the section's `slots` array (instance id in the 3D mesh). */
  index: number;
  /** Polar position: angle (deg), row distance outward. Used by the 3D layer. */
  theta: number;
}

export interface SectionLayout {
  def: SectionDef;
  slots: SeatSlot[];
  /** Seats per row (row 1 = front). */
  seatsPerRow: number[];
}

/** Seat layout of the whole bowl (deterministic; independent of the event). */
export function buildLayout(): SectionLayout[] {
  return [...SECTIONS, VIP].map((def) => {
    const slots: SeatSlot[] = [];
    const seatsPerRow: number[] = [];
    for (let r = 1; r <= def.rows; r++) {
      const mid = (def.from + def.to) / 2;
      const radius = innerRadius(mid, def.tier) + (r - 1) * 0.85;
      const spanRad = ((def.to - def.from) * Math.PI) / 180;
      const n = def.tier === "vip" ? 10 : Math.max(8, Math.floor((radius * spanRad) / SEAT_PITCH_M) - 2);
      seatsPerRow.push(n);
      for (let k = 0; k < n; k++) {
        const theta = def.from + ((k + 0.5) / n) * (def.to - def.from);
        slots.push({ section: def.id, row: r, seat: k + 1, index: slots.length, theta });
      }
    }
    return { def, slots, seatsPerRow };
  });
}

/** Best seats first inside a section: front rows, then closest to the centre of the row. */
function bestOrder(l: SectionLayout): number[] {
  const mid = (l.def.from + l.def.to) / 2;
  return l.slots
    .map((s) => s.index)
    .sort((a, b) => {
      const sa = l.slots[a];
      const sb = l.slots[b];
      return sa.row - sb.row || Math.abs(sa.theta - mid) - Math.abs(sb.theta - mid);
    });
}

export function seatLabel(s: Pick<SeatSlot, "section" | "row" | "seat">): string {
  const name = s.section === "VIP" ? VIP.name : SECTIONS.find((x) => x.id === s.section)!.name;
  return `${name} · Row ${s.row} · Seat ${s.seat}`;
}
/** Compact form stored onchain in TicketRecord.seat (≤ 32 bytes), e.g. "WL R3 S12". */
export function seatCode(s: Pick<SeatSlot, "section" | "row" | "seat">): string {
  return `${s.section} R${s.row} S${s.seat}`;
}
/** Parses "WL R3 S12" back (for labels on /tickets etc.). */
export function parseSeatCode(code: string): { section: SectionId; row: number; seat: number } | null {
  const m = /^(N|S|EL|EU|WL|WU|NE|NW|SE|SW|VIP) R(\d+) S(\d+)$/.exec(code.trim());
  return m ? { section: m[1] as SectionId, row: Number(m[2]), seat: Number(m[3]) } : null;
}
/** Human label for any stored seat string: stadium codes become "West Lower · Row 3 · Seat 12". */
export function prettySeat(stored: string): string {
  const p = parseSeatCode(stored);
  return p ? seatLabel(p) : stored;
}

export type SeatKind = "available" | "resale" | "outside" | "taken" | "off";

export interface SeatState {
  kind: SeatKind;
  /** Ticket index (inventory seats). */
  ticketIndex?: number;
  priceUsd?: number;
  capUsd?: number | null;
  /** Tier 1 listing: mint to swap. */
  ticketMint?: string;
  listingId?: string;
  /** Tier 2: escrow PDA to fund. */
  escrow?: string;
  bondUsd?: number;
  sellerName?: string;
}

export interface MapInput {
  eventId: string;
  programId: PublicKey | null; // null in mock mode (no PDAs)
  supply: number;
  sold: number;
  priceUsd: number;
  capUsd: number | null;
  /** Open Tier 1 listings: mint → listing. */
  resale: { ticketMint: string; listingId: string; priceUsd: number; sellerName: string }[];
  /** Open Tier 2 escrow listings. */
  outside: { escrow: string; priceUsd: number; bondUsd: number; sellerName: string }[];
  /** Onchain TicketRecord.seat per minted ticket mint (from the event's ticket records). */
  seatByMint?: Map<string, string>;
}

function fnv(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

/** Per-section seat states for one event. Returns states indexed like layout[k].slots. */
export function mapSeats(layout: SectionLayout[], m: MapInput): Map<SectionId, SeatState[]> {
  const out = new Map<SectionId, SeatState[]>();
  for (const l of layout) out.set(l.def.id, l.slots.map(() => ({ kind: "off" as SeatKind })));
  const main = layout.filter((l) => l.def.tier !== "vip");
  const orders = new Map(main.map((l) => [l.def.id, bestOrder(l)]));
  const used = new Map(main.map((l) => [l.def.id, 0]));
  const resaleByMint = new Map(m.resale.map((r) => [r.ticketMint, r]));

  const byId = new Map(layout.map((l) => [l.def.id, l]));
  const indexSeat = (): { id: SectionId; slot: number } | null => {
    // Next best free inventory seat, round-robin over the sections.
    for (let tries = 0; tries < main.length * 2; tries++) {
      const l = main[(rr++) % main.length];
      const order = orders.get(l.def.id)!;
      let n = used.get(l.def.id)!;
      while (n < order.length && out.get(l.def.id)![order[n]].kind !== "off") n++;
      used.set(l.def.id, n + 1);
      if (n < order.length) return { id: l.def.id, slot: order[n] };
    }
    return null;
  };
  let rr = 0;
  const mintOf = (i: number) => (m.programId ? pdas(m.programId).ticketMint(new PublicKey(m.eventId), i).toBase58() : null);

  // 1) Minted tickets that carry a stadium seat code are pinned to that seat.
  const pinned = new Set<number>();
  for (let i = 0; i < m.sold; i++) {
    const mint = mintOf(i);
    const code = mint ? m.seatByMint?.get(mint) : undefined;
    const p = code ? parseSeatCode(code) : null;
    const l = p ? byId.get(p.section) : undefined;
    const slot = p && l ? l.slots.find((x) => x.row === p.row && x.seat === p.seat) : undefined;
    if (!slot || !mint) continue;
    const listed = resaleByMint.get(mint);
    out.get(l!.def.id)![slot.index] = listed
      ? { kind: "resale", ticketIndex: i, priceUsd: listed.priceUsd, capUsd: m.capUsd, ticketMint: mint, listingId: listed.listingId, sellerName: listed.sellerName }
      : { kind: "taken", ticketIndex: i };
    pinned.add(i);
  }
  // 2) Everything else by index: legacy minted tickets (taken/resale), then unsold inventory (available).
  for (let i = 0; i < m.supply; i++) {
    if (pinned.has(i)) continue;
    const at = indexSeat();
    if (!at) break;
    const states = out.get(at.id)!;
    if (i >= m.sold) {
      states[at.slot] = { kind: "available", ticketIndex: i, priceUsd: m.priceUsd, capUsd: m.capUsd };
      continue;
    }
    const mint = mintOf(i);
    const listed = mint ? resaleByMint.get(mint) : undefined;
    states[at.slot] = listed
      ? { kind: "resale", ticketIndex: i, priceUsd: listed.priceUsd, capUsd: m.capUsd, ticketMint: listed.ticketMint, listingId: listed.listingId, sellerName: listed.sellerName }
      : { kind: "taken", ticketIndex: i };
  }

  // Outside tickets: hash each escrow onto a free (off) seat in a corner section.
  const corners = main.filter((l) => l.def.corner);
  for (const o of m.outside) {
    const h = fnv(o.escrow);
    const l = corners[h % corners.length];
    const states = out.get(l.def.id)!;
    const free = l.slots.filter((s) => states[s.index].kind === "off" && s.row <= 6);
    if (!free.length) continue;
    const slot = free[h % free.length];
    states[slot.index] = { kind: "outside", priceUsd: o.priceUsd, bondUsd: o.bondUsd, escrow: o.escrow, sellerName: o.sellerName };
  }
  return out;
}

/** Cheapest real seat for sale in a section (for the "from $X" pill), or null. */
export function fromPrice(states: SeatState[] | undefined): number | null {
  let best: number | null = null;
  for (const s of states ?? []) {
    if ((s.kind === "available" || s.kind === "resale" || s.kind === "outside") && s.priceUsd != null) best = best == null ? s.priceUsd : Math.min(best, s.priceUsd);
  }
  return best;
}
