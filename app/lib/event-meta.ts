// Owner: A. Display data the chain doesn't store.
//
// The program stores price, supply, cap, royalty and start time. Title, venue, gradient, etc. live
// here, keyed by event PDA. Tier 2 escrow orders don't record their event onchain at all, so the
// event + seat for each outside-ticket listing is kept here too, keyed by escrow PDA.
//
// Sources, merged in this order (later wins):
//   1. lib/event-meta.json   written by program/scripts/seed-devnet.ts (and by /api/event-meta in local dev)
//   2. GET /api/event-meta    Supabase table `event_meta` when B configures it
//   3. localStorage           entries this browser just saved, so they show before (2) catches up

import seeded from "./event-meta.json";
import type { Event } from "./types";

export interface EventMeta {
  title: string;
  category: Event["category"];
  venue: string;
  city: string;
  imageGradient: string;
  /** Optional event photo under /public, e.g. "/events/concert.jpg". */
  imageUrl?: string;
  organizerName: string;
  /** Test/smoke events: kept off Discover, /sell and other lists (still reachable by URL). */
  hidden?: boolean;
}

export interface EscrowMeta {
  /** Event PDA this outside ticket is for. */
  eventId: string;
  /** Free text, e.g. "Sec 112 Row 28 Seat 5". */
  seat: string;
  sellerName?: string;
}

export interface MetaMap {
  events: Record<string, EventMeta>;
  escrows: Record<string, EscrowMeta>;
}

export type MetaEntry =
  | { kind: "event"; id: string; data: EventMeta }
  | { kind: "escrow"; id: string; data: EscrowMeta };

export const DEFAULT_EVENT_META: EventMeta = {
  title: "Untitled event",
  category: "concert",
  venue: "Venue TBA",
  city: "",
  imageGradient: "bg-gradient-to-br from-slate-600 via-slate-800 to-slate-950",
  organizerName: "Independent organizer",
};

/** Gradients the creator form offers (Tailwind classes, no external images). */
export const GRADIENTS: Record<Event["category"], string> = {
  concert: "bg-gradient-to-br from-fuchsia-600 via-purple-700 to-indigo-900",
  sports: "bg-gradient-to-br from-orange-600 via-amber-700 to-red-950",
  campus: "bg-gradient-to-br from-sky-400 via-blue-600 to-indigo-950",
};

const LOCAL_KEY = "seatsafe:meta";

function readLocal(): MetaMap {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(LOCAL_KEY) : null;
    if (raw) return JSON.parse(raw) as MetaMap;
  } catch {
    // private mode / blocked storage: fine, the other sources still work
  }
  return { events: {}, escrows: {} };
}

function writeLocal(entry: MetaEntry) {
  try {
    const m = readLocal();
    if (entry.kind === "event") m.events[entry.id] = entry.data;
    else m.escrows[entry.id] = entry.data;
    window.localStorage.setItem(LOCAL_KEY, JSON.stringify(m));
  } catch {
    // ignore
  }
}

let remote: Promise<MetaMap> | null = null;

async function fetchRemote(): Promise<MetaMap> {
  if (typeof window === "undefined") return { events: {}, escrows: {} };
  if (!remote) {
    remote = fetch("/api/event-meta", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<MetaMap>) : { events: {}, escrows: {} }))
      .catch(() => ({ events: {}, escrows: {} }));
  }
  return remote;
}

/** All known display data. */
export async function getMetaMap(): Promise<MetaMap> {
  const s = seeded as MetaMap;
  const r = await fetchRemote();
  const l = readLocal();
  return {
    events: { ...s.events, ...r.events, ...l.events },
    escrows: { ...s.escrows, ...r.escrows, ...l.escrows },
  };
}

/** Saves display data via /api/event-meta and caches it in this browser right away. */
export async function saveMeta(entry: MetaEntry): Promise<{ stored: "supabase" | "file" | "local" }> {
  writeLocal(entry);
  remote = null; // refetch next time
  try {
    const res = await fetch("/api/event-meta", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(entry),
    });
    if (res.ok) {
      const body = (await res.json()) as { stored?: "supabase" | "file" | "none" };
      if (body.stored === "supabase" || body.stored === "file") return { stored: body.stored };
    }
  } catch {
    // fall through: at least this browser has it
  }
  return { stored: "local" };
}
