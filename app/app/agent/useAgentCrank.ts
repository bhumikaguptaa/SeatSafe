"use client";

// Owner: D. The in-browser agent crank (real mode only).
// While /agent is open and I have an Open standing order, it checks that event's resale listings every
// 10 s (or on "Check now"), picks the cheapest one my rules allow (./crank.ts), and PAUSES: nothing is
// bought until I approve in the VoiceApproval call. Approve sends fill_standing_order signed by my
// wallet as the crank, with the relayer as payer (via /api/relay).
// Limits: it only runs while this page is open, the log isn't saved, and the pause is an app-level
// step, not an onchain rule. The program itself enforces price, quantity, event and deadline.

import { useEffect, useRef, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { getListingsForEvent, USE_MOCK, type ChainListing } from "@/lib/chain";
import { fillStandingOrder } from "@/lib/program";
import { useRunTx } from "@/lib/tx";
import { formatUsd } from "@/lib/format";
import type { Event, StandingOrder } from "@/lib/types";
import type { AgentLogEntry } from "./useAgentDemo";
import { describeScan, matchListings } from "./crank";

const INTERVAL_MS = 10_000;

export interface PendingFill {
  order: StandingOrder;
  listing: ChainListing;
  eventTitle: string;
}

export function useAgentCrank({
  me,
  orders,
  events,
  refreshOrders,
}: {
  me: string | null;
  orders: StandingOrder[];
  events: Event[];
  refreshOrders: () => Promise<void>;
}) {
  const { run } = useRunTx();
  const [log, setLog] = useState<AgentLogEntry[]>([]);
  const [pending, setPending] = useState<PendingFill | null>(null);
  const [checking, setChecking] = useState(false);
  const [filling, setFilling] = useState(false);
  /** Listings I said no to (this session only). */
  const declined = useRef(new Set<string>());
  /** True while a check is running, a match awaits my answer, or a fill is in flight. */
  const busy = useRef(false);

  const openOrders = orders.filter((o) => o.status === "OPEN");
  const active = !USE_MOCK && me !== null && openOrders.length > 0;
  const titleOf = (eventId: string) => events.find((e) => e.id === eventId)?.title ?? "this event";

  function push(kind: AgentLogEntry["kind"], message: string) {
    const at = Date.now();
    setLog((l) => [...l, { id: `crank_${at}_${l.length}`, kind, message, at: new Date(at).toISOString() }]);
  }

  /** One summary line per order, replaced on every check so the log doesn't flood. */
  function upsertScan(orderId: string, message: string) {
    const entry: AgentLogEntry = { id: `scan_${orderId}`, kind: "seen", message, at: new Date().toISOString() };
    setLog((l) => (l.some((e) => e.id === entry.id) ? l.map((e) => (e.id === entry.id ? entry : e)) : [...l, entry]));
  }

  async function check() {
    if (!me || busy.current || openOrders.length === 0) return;
    busy.current = true;
    setChecking(true);
    try {
      for (const order of openOrders) {
        const title = titleOf(order.eventId);
        const r = matchListings(order, await getListingsForEvent(order.eventId), me, declined.current);
        upsertScan(order.id, `${title}: ${describeScan(r, order.maxPriceUsd)}`);
        if (r.match) {
          const seat = r.match.seat ? ` (${r.match.seat})` : "";
          push("found", `Found 1 for ${title} at ${formatUsd(r.match.priceUsd)}${seat}. Asking you before buying.`);
          setPending({ order, listing: r.match, eventTitle: title });
          return; // stay busy: no more checks until I answer
        }
      }
      busy.current = false;
    } catch (err) {
      console.error("agent check failed", err);
      push("waiting", "Couldn't read listings just now. Trying again in 10 s.");
      busy.current = false;
    } finally {
      setChecking(false);
    }
  }

  async function approve() {
    const p = pending;
    if (!p?.listing.ticketMint) return;
    const ticketMint = p.listing.ticketMint;
    setPending(null);
    setFilling(true);
    const sent = await run(
      (ctx) =>
        fillStandingOrder(ctx, {
          standingOrder: new PublicKey(p.order.id),
          ticketMint: new PublicKey(ticketMint),
        }),
      {
        pending: `Buying 1 ticket for ${formatUsd(p.listing.priceUsd)} from your budget vault…`,
        success: "Bought! The ticket is in My tickets.",
      },
    );
    setFilling(false);
    if (sent) {
      push("filled", `Bought 1 ticket for ${p.eventTitle} at ${formatUsd(p.listing.priceUsd)}. It's in My tickets.`);
      await refreshOrders();
    } else {
      push("waiting", "That purchase didn't go through (the listing may be gone). Still watching.");
    }
    busy.current = false;
  }

  function decline() {
    const p = pending;
    if (!p) return;
    declined.current.add(p.listing.id);
    push("declined", `You said no to ${formatUsd(p.listing.priceUsd)}. Still watching for another match.`);
    setPending(null);
    busy.current = false;
  }

  // Run on an interval while there's something to do. The ref keeps the interval on the latest check().
  const checkRef = useRef(check);
  useEffect(() => {
    checkRef.current = check;
  });
  useEffect(() => {
    if (!active) return;
    void checkRef.current();
    const t = setInterval(() => void checkRef.current(), INTERVAL_MS);
    return () => clearInterval(t);
  }, [active]);

  return {
    active,
    log,
    pending,
    checking,
    filling,
    checkNow: () => void check(),
    approve: () => void approve(),
    decline,
  };
}
