// Forward-only order states. Shared by the stream webhook, the reconciler and the UI
// so a late or duplicated event can never move a tracker backwards.

import type { OrderState } from "./types";

/** Higher means further along. Terminal success and refund share a rank; they are not interchangeable. */
const RANK: Record<OrderState, number> = {
  HELD: 10,
  IN_TRANSIT: 20,
  CONFIRMED: 30,
  DISPUTED: 25,
  RELEASED: 40,
  SWAPPED: 40,
  REFUNDED: 40,
};

const TERMINAL = new Set<OrderState>(["RELEASED", "SWAPPED", "REFUNDED"]);

/**
 * True when `next` is a legal move from `current`.
 * `current === null` means the order does not exist yet.
 * Equal states and any move out of a terminal state are rejected.
 * DISPUTED is a side path from HELD / IN_TRANSIT / CONFIRMED, and can settle to RELEASED or REFUNDED.
 * Skipping ahead is allowed: a missed "sent" event must not block a later release.
 */
export function canAdvance(current: OrderState | null, next: OrderState): boolean {
  if (current === null) return true;
  if (current === next) return false;
  if (TERMINAL.has(current)) return false;
  if (current === "DISPUTED") return next === "RELEASED" || next === "REFUNDED";
  if (next === "DISPUTED") return current === "HELD" || current === "IN_TRANSIT" || current === "CONFIRMED";
  return RANK[next] > RANK[current];
}
