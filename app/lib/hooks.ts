"use client";

// Data hooks for the UI. Pages and components should get data ONLY through these hooks,
// so swapping mock -> Supabase never touches UI code.

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { getEscrowOrder, getEvents as getChainEvents } from "./chain";
import {
  chatFromRow,
  eventFromRow,
  orderEventFromRow,
  orderFromRow,
  standingOrderFromRow,
  type AgentLogRow,
  type ApprovalRow,
  type ChatRow,
  type EventRow,
  type OrderEventRow,
  type OrderRow,
  type StandingOrderRow,
} from "./db-map";
import { events as mockEvents, orders as mockOrders } from "./mock";
import { canAdvance } from "./order-state";
import { supabase } from "./supabase";
import type { ChatMessage, Event, Order, OrderEvent, OrderState, StandingOrder } from "./types";

// ===========================================================================
// THE SWITCH: mock data unless NEXT_PUBLIC_USE_MOCK is exactly "false".
// ===========================================================================
export const USE_MOCK = process.env.NEXT_PUBLIC_USE_MOCK !== "false";

// Supabase returns the SAME channel object for a repeated topic name, and adding .on() listeners to an
// already-subscribed channel throws ("cannot add `postgres_changes` callbacks ... after `subscribe()`"),
// crashing the page. /orders/[id] mounts useOrder twice (tracker + chat), so give every hook instance
// its own topic. (A, Nov 18 production fix.)
let channelSeq = 0;
const uniqueTopic = (name: string) => `${name}#${++channelSeq}`;

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

function isPubkey(value: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
}

function mergeOrders(dbOrder: Order | null, chainOrder: Order | null): Order | null {
  if (!dbOrder) return chainOrder;
  if (!chainOrder) return dbOrder;
  if (!canAdvance(dbOrder.state, chainOrder.state)) return dbOrder;
  const seen = new Set(chainOrder.events.map((e) => e.id));
  const events = [...chainOrder.events, ...dbOrder.events.filter((e) => !seen.has(e.id))]
    .sort((a, b) => a.at.localeCompare(b.at));
  return { ...chainOrder, eventId: chainOrder.eventId || dbOrder.eventId, events };
}

/** chain | supabase | auto (default). auto prefers devnet events when the RPC returns any. */
function eventsSource(): "chain" | "supabase" | "auto" {
  const raw = process.env.NEXT_PUBLIC_EVENTS_SOURCE;
  if (raw === "chain" || raw === "supabase") return raw;
  return "auto";
}

function useEventsSupabase(): UseEventsResult {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const source = eventsSource();

    const loadDb = async (): Promise<Event[]> => {
      if (!supabase) return [];
      const { data, error } = await supabase.from("events").select("*").order("starts_at", { ascending: true });
      if (error) {
        console.warn("events read failed:", error.message);
        return [];
      }
      return ((data ?? []) as EventRow[]).map(eventFromRow);
    };

    const load = async () => {
      const fromDb = await loadDb();
      let next = fromDb;
      if (source !== "supabase") {
        try {
          const chain = await getChainEvents();
          if (source === "chain" || (source === "auto" && chain.length > 0)) next = chain;
          else if (fromDb.length === 0) next = chain;
        } catch (err) {
          console.warn("chain events failed:", err);
        }
      }
      if (!cancelled) {
        setEvents(next);
        setLoading(false);
      }
    };

    void load();
    const db = supabase;
    if (!db) return () => { cancelled = true; };

    const channel = db
      .channel(uniqueTopic("events-live"))
      .on("postgres_changes", { event: "*", schema: "public", table: "events" }, () => { void load(); })
      .subscribe();
    return () => {
      cancelled = true;
      void db.removeChannel(channel);
    };
  }, []);

  return { events, loading };
}

function useOrderSupabase(orderId: string): UseOrderResult {
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let dbOrder: Order | null = null;
    let chainOrder: Order | null = null;

    const publish = () => {
      if (!cancelled) setOrder(mergeOrders(dbOrder, chainOrder));
    };

    const loadDb = async () => {
      if (!supabase) {
        dbOrder = null;
        return;
      }
      const { data, error } = await supabase
        .from("orders")
        .select("*, order_events(*)")
        .eq("id", orderId)
        .maybeSingle();
      if (error) console.warn("order read failed:", error.message);
      dbOrder = data ? orderFromRow(data as OrderRow) : null;
    };

    const loadChain = async () => {
      if (!isPubkey(orderId)) {
        chainOrder = null;
        return;
      }
      chainOrder = await getEscrowOrder(orderId).catch(() => null);
    };

    const load = async () => {
      await Promise.all([loadDb(), loadChain()]);
      if (!cancelled) {
        publish();
        setLoading(false);
      }
    };

    void load();
    const poll = isPubkey(orderId) ? setInterval(() => { void loadChain().then(publish); }, 2000) : null;

    const db = supabase;
    if (!db) {
      return () => {
        cancelled = true;
        if (poll) clearInterval(poll);
      };
    }

    const channel = db
      .channel(uniqueTopic(`order:${orderId}`))
      .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: `id=eq.${orderId}` }, () => {
        void loadDb().then(publish);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "order_events", filter: `order_id=eq.${orderId}` }, (payload) => {
        const row = orderEventFromRow(payload.new as OrderEventRow);
        if (dbOrder) {
          const events = dbOrder.events.some((e) => e.id === row.id) ? dbOrder.events : [...dbOrder.events, row];
          dbOrder = { ...dbOrder, events };
          publish();
        } else {
          void loadDb().then(publish);
        }
      })
      .subscribe();

    return () => {
      cancelled = true;
      if (poll) clearInterval(poll);
      void db.removeChannel(channel);
    };
  }, [orderId]);

  return toOrderResult(loading ? null : order, loading, simulateDisabled);
}

export interface UseOrderChatResult {
  messages: ChatMessage[];
  loading: boolean;
  send: (body: string, senderId: string) => Promise<void>;
}

/** Live thread for one order. Sends go through POST /api/chat so the scam check runs on the server. */
export function useOrderChat(orderId: string | null): UseOrderChatResult {
  const key = orderId && supabase ? orderId : null;
  const [query, setQuery] = useState<{ key: string | null; messages: ChatMessage[]; loading: boolean }>({
    key: null,
    messages: [],
    loading: false,
  });
  if (query.key !== key) {
    setQuery({ key, messages: [], loading: key !== null });
  }

  useEffect(() => {
    if (!key || !supabase) return;
    const db = supabase;
    let cancelled = false;
    void db
      .from("chat_messages")
      .select("*")
      .eq("order_id", key)
      .order("at", { ascending: true })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) console.warn("chat read failed:", error.message);
        setQuery({ key, messages: ((data ?? []) as ChatRow[]).map(chatFromRow), loading: false });
      });
    const channel = db
      .channel(uniqueTopic(`chat:${key}`))
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages", filter: `order_id=eq.${key}` }, (payload) => {
        const row = chatFromRow(payload.new as ChatRow);
        setQuery((prev) => prev.key !== key || prev.messages.some((m) => m.id === row.id)
          ? prev
          : { ...prev, messages: [...prev.messages, row] });
      })
      .subscribe();
    return () => {
      cancelled = true;
      void db.removeChannel(channel);
    };
  }, [key]);

  const send = useCallback(async (body: string, senderId: string) => {
    if (!key) return;
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orderId: key, senderId, body }),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(err?.error ?? "Could not send");
    }
    const json = (await res.json()) as { message: ChatMessage };
    setQuery((prev) => prev.messages.some((m) => m.id === json.message.id)
      ? prev
      : { ...prev, key, messages: [...prev.messages, json.message] });
  }, [key]);

  return { messages: query.messages, loading: query.loading, send };
}

export interface AgentLogEntry {
  id: string;
  kind: string;
  message: string;
  at: string;
}

/** Decision log written by the matcher. Subscribes to agent_log. */
export function useAgentLog(standingOrderId: string | null): { entries: AgentLogEntry[]; loading: boolean } {
  const key = standingOrderId && supabase ? standingOrderId : null;
  const [query, setQuery] = useState<{ key: string | null; entries: AgentLogEntry[]; loading: boolean }>({
    key: null,
    entries: [],
    loading: false,
  });
  if (query.key !== key) setQuery({ key, entries: [], loading: key !== null });

  useEffect(() => {
    if (!key || !supabase) return;
    const db = supabase;
    let cancelled = false;
    const map = (rows: AgentLogRow[]) => rows.map((r) => ({ id: r.id, kind: r.kind, message: r.message, at: r.at }));
    void db
      .from("agent_log")
      .select("*")
      .eq("standing_order_id", key)
      .order("at", { ascending: true })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) console.warn("agent_log read failed:", error.message);
        setQuery({ key, entries: map((data ?? []) as AgentLogRow[]), loading: false });
      });
    const channel = db
      .channel(uniqueTopic(`agent:${key}`))
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "agent_log", filter: `standing_order_id=eq.${key}` }, (payload) => {
        const row = payload.new as AgentLogRow;
        const entry = { id: row.id, kind: row.kind, message: row.message, at: row.at };
        setQuery((prev) => prev.key !== key || prev.entries.some((e) => e.id === entry.id)
          ? prev
          : { ...prev, entries: [...prev.entries, entry] });
      })
      .subscribe();
    return () => {
      cancelled = true;
      void db.removeChannel(channel);
    };
  }, [key]);

  return { entries: query.entries, loading: query.loading };
}

export interface PendingApproval {
  id: string;
  prompt: string;
  totalUsd: number;
  detail: string;
  listingId: string;
  priceUsd: number;
  sellerRating: number;
}

/** The voice-call card. Null when nothing is waiting. */
export function usePendingApproval(standingOrderId: string | null): PendingApproval | null {
  const key = standingOrderId && supabase ? standingOrderId : null;
  const [query, setQuery] = useState<{ key: string | null; approval: PendingApproval | null }>({
    key: null,
    approval: null,
  });
  if (query.key !== key) setQuery({ key, approval: null });

  useEffect(() => {
    if (!key || !supabase) return;
    const db = supabase;
    let cancelled = false;
    const pick = (rows: ApprovalRow[]): PendingApproval | null => {
      const pending = rows.find((r) => r.status === "pending");
      return pending ? {
        id: pending.id,
        prompt: pending.prompt,
        totalUsd: Number(pending.total_usd),
        detail: pending.detail,
        listingId: pending.listing_id,
        priceUsd: Number(pending.price_usd),
        sellerRating: Number(pending.seller_rating),
      } : null;
    };
    const load = () => db
      .from("approval_requests")
      .select("*")
      .eq("standing_order_id", key)
      .order("created_at", { ascending: false })
      .then(({ data }) => { if (!cancelled) setQuery({ key, approval: pick((data ?? []) as ApprovalRow[]) }); });
    void load();
    const channel = db
      .channel(uniqueTopic(`approval:${key}`))
      .on("postgres_changes", { event: "*", schema: "public", table: "approval_requests", filter: `standing_order_id=eq.${key}` }, () => {
        void load();
      })
      .subscribe();
    return () => {
      cancelled = true;
      void db.removeChannel(channel);
    };
  }, [key]);

  return query.approval;
}

/** Standing orders for one user. Drafts are omitted; those exist only until the budget is locked. */
export function useStandingOrders(userId: string | null): { orders: StandingOrder[]; loading: boolean } {
  const key = userId && supabase ? userId : null;
  const [query, setQuery] = useState<{ key: string | null; orders: StandingOrder[]; loading: boolean }>({
    key: null,
    orders: [],
    loading: false,
  });
  if (query.key !== key) setQuery({ key, orders: [], loading: key !== null });

  useEffect(() => {
    if (!key || !supabase) return;
    const db = supabase;
    let cancelled = false;
    const load = async () => {
      const { data, error } = await db
        .from("standing_orders")
        .select("*")
        .eq("user_id", key)
        .order("created_at", { ascending: false });
      if (cancelled) return;
      if (error) console.warn("standing_orders read failed:", error.message);
      setQuery({
        key,
        orders: ((data ?? []) as StandingOrderRow[]).map(standingOrderFromRow).filter((o): o is StandingOrder => o !== null),
        loading: false,
      });
    };
    void load();
    const channel = db
      .channel(uniqueTopic(`standing:${key}`))
      .on("postgres_changes", { event: "*", schema: "public", table: "standing_orders", filter: `user_id=eq.${key}` }, () => { void load(); })
      .subscribe();
    return () => {
      cancelled = true;
      void db.removeChannel(channel);
    };
  }, [key]);

  return { orders: query.orders, loading: query.loading };
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
