// Owner: D. MOCK MODE ONLY (flag for A): a realistic seat mix for the seat map.
//
// In mock mode, lib/stadium-map.ts' mapSeats only has 120 inventory seats and no resale / escrow listings
// (mock listings carry no mint or escrow address), so the map would show a few official seats and nothing
// else. This dresses the deterministic layout with a believable, stable mix (same event → same seats):
// only ~10–15% of seats available, in small clusters (fewer in the popular sidelines), each cluster one seat
// type: official at the event price, protected resale at varied prices up to the cap, or an outside ticket
// in escrow. Everything else is taken or not on sale (drawn dim).
// Fake mint / escrow ids make the mock buy path (mockTx) work; nothing here runs in real mode.

import type { SeatState, SectionId, SectionLayout } from "./stadium-map";

const SELLERS = ["Jordan P.", "Priya S.", "Marcus T.", "Sam R.", "Alex K.", "Dana W.", "Chris L.", "Mei H.", "Riley B.", "Ola N."];

/** Popularity of a stand (share of seats already taken, before the front-row bonus). */
const TAKEN_BASE: Partial<Record<SectionId, number>> = { EL: 0.5, WL: 0.5, N: 0.38, S: 0.38, NE: 0.3, NW: 0.3, SE: 0.3, SW: 0.3, EU: 0.28, WU: 0.28 };

function hash01(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return (h % 100000) / 100000;
}

export function mockSeatMix(
  layout: SectionLayout[],
  states: Map<SectionId, SeatState[]>,
  ev: { id: string; priceUsd: number; capUsd: number | null },
): Map<SectionId, SeatState[]> {
  const out = new Map<SectionId, SeatState[]>();
  for (const l of layout) {
    const base = states.get(l.def.id) ?? [];
    if (l.def.id === "VIP") {
      out.set(l.def.id, base); // VIP isn't on sale (a view only)
      continue;
    }
    // Small clusters: blocks of ~2 rows × 5 seats. A block is "listed" with a probability that's higher in
    // cheaper areas (corners, upper tier) and lower in the popular ones; ~85% of a listed block's seats are
    // free. That lands around 10–15% of all seats available, the rest dim (taken / not on sale).
    const listedP = Math.min(0.24, 0.3 - (TAKEN_BASE[l.def.id] ?? 0.3) * 0.4);
    out.set(
      l.def.id,
      l.slots.map((slot) => {
        const block = `${ev.id}|${l.def.id}|${Math.floor((slot.row - 1) / 2)}|${Math.floor((slot.seat - 1) / 5)}`;
        const listed = hash01(block) < listedP;
        const seatKey = `${block}|${slot.index}`;
        if (!listed || hash01(seatKey) > 0.85) return (hash01(`${seatKey}|o`) < 0.12 ? { kind: "off" } : { kind: "taken" }) satisfies SeatState;
        // One seat type per cluster (like a real listing), price varies a little seat to seat.
        const kindRoll = hash01(`${block}|k`);
        const u = hash01(`${seatKey}|p`);
        const front = 1 - (slot.row - 1) / Math.max(1, l.def.rows - 1);
        const cap = ev.capUsd ?? Infinity;
        const seller = SELLERS[Math.floor(hash01(`${block}|s`) * SELLERS.length)];
        if (kindRoll < 0.55) return { kind: "available", priceUsd: ev.priceUsd, capUsd: ev.capUsd } satisfies SeatState;
        if (kindRoll < 0.88) {
          return {
            kind: "resale",
            priceUsd: Math.min(cap, Math.round(ev.priceUsd * (0.8 + 0.25 * hash01(`${block}|r`) + 0.15 * front + 0.04 * u))),
            capUsd: ev.capUsd,
            ticketMint: `mock-mint-${l.def.id}-${slot.index}`,
            listingId: `mock-lst-${l.def.id}-${slot.index}`,
            sellerName: seller,
          } satisfies SeatState;
        }
        return {
          kind: "outside",
          priceUsd: Math.round(ev.priceUsd * (0.75 + 0.6 * hash01(`${block}|r`) + 0.04 * u)),
          bondUsd: 0,
          escrow: `mock-escrow-${l.def.id}-${slot.index}`,
          sellerName: seller,
        } satisfies SeatState;
      }),
    );
  }
  return out;
}
