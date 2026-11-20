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
  /** Cheapest listing skipped only for being over the max (null if none). */
  cheapestOverMaxUsd: number | null;
}

/** Floating-point slack: USD amounts come from 6-decimal base units. */
const EPSILON = 1e-9;

export function matchListings(
  order: StandingOrder,
  listings: ChainListing[],
  me: string,
  declinedListingIds: ReadonlySet<string>,
): MatchResult {
  const result: MatchResult = { match: null, seen: 0, overMax: 0, own: 0, outside: 0, declined: 0, cheapestOverMaxUsd: null };
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
      if (result.cheapestOverMaxUsd === null || l.priceUsd < result.cheapestOverMaxUsd) result.cheapestOverMaxUsd = l.priceUsd;
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
  if (r.seen === 0) return "Checked: no resale listings for this event yet. Your agent keeps watching.";
  const summary = skipped.length ? `${head}: skipped ${skipped.join(", ")}.` : `${head}.`;
  // Nothing buyable but a ticket is listed just above the max: say how to get it, not just "skipped".
  if (!r.match && r.cheapestOverMaxUsd !== null) {
    const ask = Math.ceil(r.cheapestOverMaxUsd - EPSILON);
    return `${summary} The cheapest is $${r.cheapestOverMaxUsd}, above your $${maxPriceUsd} max. To buy it, Close & refund this order below and ask again "under $${ask}".`;
  }
  return summary;
}

/**
 * Live-mode suggestion cards, built from what's listed right now so the agent always finds a match:
 * per event, "1 ticket ... under $<cheapest>" and, with 2+ listings, "2 tickets ... under $<2nd cheapest>".
 * Skips my own listings and events not shown on Discover. Cheapest budgets first; when the wallet
 * balance is known, only budgets it can cover. cheapestBudgetUsd is the smallest budget overall (for
 * the "top up" note when none are affordable).
 */
export function buildSuggestions(
  listings: { eventId: string; priceUsd: number; sellerId: string }[],
  events: { id: string; title: string }[],
  me: string | null,
  balanceUsd: number | null,
): { suggestions: string[]; cheapestBudgetUsd: number | null } {
  // "Battle of the Bands: Dorm Edition" -> "Battle of the Bands" (still matches the parser).
  const names = new Map(events.map((e) => [e.id, e.title.split(":")[0].trim()]));
  const pricesByEvent = new Map<string, number[]>();
  for (const l of listings) {
    if (l.sellerId === me || !names.has(l.eventId)) continue;
    pricesByEvent.set(l.eventId, [...(pricesByEvent.get(l.eventId) ?? []), l.priceUsd]);
  }

  const options: { text: string; budget: number }[] = [];
  for (const [eventId, prices] of pricesByEvent) {
    prices.sort((a, b) => a - b);
    const name = names.get(eventId)!;
    const max1 = Math.ceil(prices[0] - EPSILON);
    options.push({ text: `1 ticket for ${name} under $${max1}`, budget: max1 });
    if (prices.length >= 2) {
      const max2 = Math.ceil(prices[1] - EPSILON);
      options.push({ text: `2 tickets for ${name} under $${max2}`, budget: 2 * max2 });
    }
  }
  options.sort((a, b) => a.budget - b.budget);
  const affordable = balanceUsd === null ? options : options.filter((o) => o.budget <= balanceUsd + EPSILON);
  return { suggestions: affordable.slice(0, 3).map((o) => o.text), cheapestBudgetUsd: options[0]?.budget ?? null };
}
