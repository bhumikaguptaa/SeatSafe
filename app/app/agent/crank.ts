// Owner: D. The agent crank's matcher: pure (no React, no network), so the in-browser crank uses it
// today and an always-on server crank can reuse it later.
//
// Mirrors fill_standing_order's onchain checks so we only propose fills that can land:
//   order Open (status OPEN covers filled < quantity and now <= deadline), same event,
//   price <= max price, seller != owner. Only Tier 1 listings can be filled (escrow tickets can't).
// The program re-checks all of this; the matcher just picks the cheapest valid listing and explains why
// it skipped the rest. Seller rating isn't enforced: there's no rating data onchain yet.

import type { ChainListing } from "@/lib/chain";
import type { StandingOrder } from "@/lib/types";

export interface MatchResult {
  /** Cheapest listing the order can buy, or null. */
  match: ChainListing | null;
  seen: number;
  overMax: number;
  own: number;
  outside: number;
  declined: number;
}

/** Floating-point slack: USD amounts come from 6-decimal base units. */
const EPSILON = 1e-9;

export function matchListings(
  order: StandingOrder,
  listings: ChainListing[],
  me: string,
  declinedListingIds: ReadonlySet<string>,
): MatchResult {
  const result: MatchResult = { match: null, seen: 0, overMax: 0, own: 0, outside: 0, declined: 0 };
  const candidates: ChainListing[] = [];

  for (const l of listings) {
    if (l.eventId !== order.eventId) continue;
    result.seen++;
    if (l.tier !== 1 || !l.ticketMint) {
      result.outside++;
    } else if (l.sellerId === me) {
      result.own++;
    } else if (l.priceUsd > order.maxPriceUsd + EPSILON) {
      result.overMax++;
    } else if (declinedListingIds.has(l.id)) {
      result.declined++;
    } else {
      candidates.push(l);
    }
  }

  candidates.sort((a, b) => a.priceUsd - b.priceUsd);
  result.match = candidates[0] ?? null;
  return result;
}

/**
 * Listings a new order with these rules could buy right now, cheapest first. Same rules as matchListings
 * (Tier 1, not mine, at or under the max), used to warn before locking a budget the agent can't spend.
 */
export function buyableListings(
  listings: ChainListing[],
  rules: { eventId: string; maxPriceUsd: number },
  me: string,
): ChainListing[] {
  const order = { eventId: rules.eventId, maxPriceUsd: rules.maxPriceUsd } as StandingOrder;
  const buyable: ChainListing[] = [];
  const seenIds = new Set<string>();
  // matchListings returns the cheapest candidate; peel candidates off one at a time.
  for (;;) {
    const { match } = matchListings(order, listings, me, seenIds);
    if (!match) break;
    buyable.push(match);
    seenIds.add(match.id);
  }
  return buyable;
}

/** One-line summary for the decision log, e.g. "Checked 3 listings: 1 over $15, 1 yours." */
export function describeScan(r: MatchResult, maxPriceUsd: number): string {
  const skipped = [
    r.overMax && `${r.overMax} over $${maxPriceUsd}`,
    r.own && `${r.own} yours`,
    r.outside && `${r.outside} outside ${r.outside === 1 ? "ticket" : "tickets"} (agent can't buy those)`,
    r.declined && `${r.declined} you declined`,
  ].filter(Boolean);
  const head = `Checked ${r.seen} ${r.seen === 1 ? "listing" : "listings"}`;
  if (r.seen === 0) return "Checked: no resale listings for this event yet.";
  return skipped.length ? `${head}: skipped ${skipped.join(", ")}.` : `${head}.`;
}
