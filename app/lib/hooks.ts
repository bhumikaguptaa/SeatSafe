"use client";

// Data hooks for the UI. Pages and components should get data ONLY through these hooks,
// so swapping mock -> Supabase never touches UI code.

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { events as mockEvents, orders as mockOrders } from "./mock";
import type { Event, Order, OrderEvent, OrderState } from "./types";

// ===========================================================================
// THE SWITCH: mock data unless NEXT_PUBLIC_USE_MOCK is exactly "false".
// ===========================================================================
const USE_MOCK = process.env.NEXT_PUBLIC_USE_MOCK !== "false";

/** Fake network latency in mock mode so loading/skeleton states get built. */
const MOCK_DELAY_MS = 300;

export interface UseEventsResult {
  events: Event[];
  loading: boolean;
}

export interface UseOrderResult {
  order: Order | null;
  state: OrderState | null;
  amount: number;
  /** shipDeadline while HELD, else confirmDeadline */
  deadline: string | null;
  events: OrderEvent[];
  loading: boolean;
  /** Demo helper: move the mock order to a new state and append an OrderEvent. Mock mode only. */
  simulate: (next: OrderState) => void;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Returns true until MOCK_DELAY_MS has passed for this key (re-arms when the key changes). */
function useMockDelay(key: string): boolean {
  const [readyKey, setReadyKey] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setReadyKey(key), MOCK_DELAY_MS);
    return () => clearTimeout(t);
  }, [key]);
  return readyKey !== key;
}

function toOrderResult(
  order: Order | null,
  loading: boolean,
  simulate: (next: OrderState) => void,
): UseOrderResult {
  return {
    order,
    state: order?.state ?? null,
    amount: order?.amountUsd ?? 0,
    deadline: order
      ? order.state === "HELD"
        ? order.shipDeadline
        : order.confirmDeadline
      : null,
    events: order?.events ?? [],
    loading,
    simulate,
  };
}

// ---------------------------------------------------------------------------
// Mock implementation
// ---------------------------------------------------------------------------

// In-memory order store so simulate() updates every component using useOrder(id).
// Resets on page reload.
let mockOrderStore: Record<string, Order> = Object.fromEntries(
  mockOrders.map((o) => [o.id, o]),
);
const listeners = new Set<() => void>();

function subscribeOrders(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getOrdersSnapshot() {
  return mockOrderStore;
}

const SIMULATED_EVENT: Record<OrderState, { type: OrderEvent["type"]; message: string }> = {
  HELD: { type: "FUNDED", message: "Payment locked in the SeatSafe vault." },
  IN_TRANSIT: { type: "TICKET_SENT", message: "Seller sent the ticket." },
  CONFIRMED: { type: "CONFIRMED", message: "Buyer confirmed the ticket works." },
  RELEASED: { type: "RELEASED", message: "Payment released to the seller." },
  REFUNDED: { type: "REFUNDED", message: "Deadline missed. Buyer refunded in full." },
  DISPUTED: { type: "DISPUTE_OPENED", message: "Buyer opened a dispute. Funds stay locked." },
  SWAPPED: { type: "SWAPPED", message: "Ticket and payment swapped in one transaction." },
};

function simulateMockOrder(orderId: string, next: OrderState) {
  const current = mockOrderStore[orderId];
  if (!current) return;
  const nowMs = Date.now();
  const event: OrderEvent = {
    id: `oe_sim_${nowMs}`,
    orderId,
    ...SIMULATED_EVENT[next],
    at: new Date(nowMs).toISOString(),
  };
  const updated: Order = {
    ...current,
    state: next,
    // Fresh deadlines so countdowns are meaningful after a simulated transition.
    ...(next === "HELD" && { shipDeadline: new Date(nowMs + 2 * 3_600_000).toISOString() }),
    ...(next === "IN_TRANSIT" && { confirmDeadline: new Date(nowMs + 24 * 3_600_000).toISOString() }),
    events: [...current.events, event],
  };
  mockOrderStore = { ...mockOrderStore, [orderId]: updated };
  listeners.forEach((l) => l());
}

function useEventsMock(): UseEventsResult {
  const loading = useMockDelay("events");
  return { events: loading ? [] : mockEvents, loading };
}

function useOrderMock(orderId: string): UseOrderResult {
  const store = useSyncExternalStore(subscribeOrders, getOrdersSnapshot, getOrdersSnapshot);
  const loading = useMockDelay(orderId);
  const simulate = useCallback(
    (next: OrderState) => simulateMockOrder(orderId, next),
    [orderId],
  );
  return toOrderResult(loading ? null : (store[orderId] ?? null), loading, simulate);
}

// ---------------------------------------------------------------------------
// Real implementation (Supabase)
// ---------------------------------------------------------------------------

function simulateDisabled() {
  console.warn("simulate() only works in mock mode (NEXT_PUBLIC_USE_MOCK != 'false').");
}

function useEventsSupabase(): UseEventsResult {
  // TODO(B): replace with Supabase query + Realtime subscription
  // (use `supabase` from ./supabase; it is null when keys are missing). Keep this return shape.
  return { events: [], loading: false };
}

function useOrderSupabase(orderId: string): UseOrderResult {
  // TODO(B): replace with Supabase query + Realtime subscription on orders/order_events
  // filtered by orderId. Keep this return shape.
  void orderId;
  return toOrderResult(null, false, simulateDisabled);
}

// ---------------------------------------------------------------------------
// Public hooks (chosen once at module load, so hook order never changes)
// ---------------------------------------------------------------------------

export const useEvents: () => UseEventsResult = USE_MOCK
  ? useEventsMock
  : useEventsSupabase;

export const useOrder: (orderId: string) => UseOrderResult = USE_MOCK
  ? useOrderMock
  : useOrderSupabase;
