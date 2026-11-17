"use client";

// Owner: D. The live escrow tracker UI. Build it ONLY from useOrder(id).
// A coin shows where the money is (You / Vault / Seller) and slides between boxes as the state changes.
// Use the simulate buttons to walk through every state.

import { useSyncExternalStore } from "react";
import { useParams } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { useOrder } from "@/lib/hooks";
import { formatCountdown, formatDate, formatUsd } from "@/lib/format";
import type { OrderState } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

const STATES: OrderState[] = [
  "HELD",
  "IN_TRANSIT",
  "CONFIRMED",
  "RELEASED",
  "REFUNDED",
  "DISPUTED",
  "SWAPPED",
];

type Spot = "you" | "vault" | "seller";
type Tone = "vault" | "transit" | "released" | "disputed";

const SPOTS: { id: Spot; label: string }[] = [
  { id: "you", label: "You" },
  { id: "vault", label: "Vault" },
  { id: "seller", label: "Seller" },
];

/** Where the money sits in each state, how to color it, and what to tell the buyer. */
const STATE_VIEW: Record<OrderState, { spot: Spot; tone: Tone; title: string; countdown?: string }> = {
  HELD: { spot: "vault", tone: "vault", title: "Your payment is locked in the vault", countdown: "Seller must send the ticket in" },
  IN_TRANSIT: { spot: "vault", tone: "transit", title: "Ticket on its way. Check it and confirm", countdown: "Time left to confirm" },
  CONFIRMED: { spot: "vault", tone: "released", title: "Confirmed. Releasing payment to the seller" },
  RELEASED: { spot: "seller", tone: "released", title: "Payment released to the seller" },
  SWAPPED: { spot: "seller", tone: "released", title: "Ticket and payment swapped in one transaction" },
  REFUNDED: { spot: "you", tone: "released", title: "Refunded in full" },
  DISPUTED: { spot: "vault", tone: "disputed", title: "Dispute open. Funds stay locked" },
};

// Static class strings so Tailwind picks them up.
const TONE: Record<Tone, { text: string; border: string; bg: string; coin: string }> = {
  vault: { text: "text-vault", border: "border-vault", bg: "bg-vault/10", coin: "bg-vault" },
  transit: { text: "text-transit", border: "border-transit", bg: "bg-transit/10", coin: "bg-transit" },
  released: { text: "text-released", border: "border-released", bg: "bg-released/10", coin: "bg-released" },
  disputed: { text: "text-disputed", border: "border-disputed", bg: "bg-disputed/10", coin: "bg-disputed" },
};

// One shared 1 s clock for countdowns. Snapshot is whole seconds so it stays stable between ticks;
// the server snapshot is null so prerendered HTML never contains a stale time.
function subscribeClock(onTick: () => void) {
  const t = setInterval(onTick, 1000);
  return () => clearInterval(t);
}
const getClock = () => Math.floor(Date.now() / 1000) * 1000;
const getServerClock = () => null;

function useNow(): number | null {
  return useSyncExternalStore(subscribeClock, getClock, getServerClock);
}

export function OrderTracker() {
  const { id } = useParams<{ id: string }>();
  const { order, state, amount, deadline, events, loading, simulate } = useOrder(id);
  const now = useNow();

  if (loading) return <Skeleton className="h-40 rounded-xl" />;
  if (!order || !state) {
    return <p className="text-sm text-muted-foreground">No order with id “{id}”.</p>;
  }

  const view = STATE_VIEW[state];
  const tone = TONE[view.tone];
  const msLeft = deadline && now !== null ? new Date(deadline).getTime() - now : null;

  return (
    <div className="space-y-6 text-sm">
      <section className={`rounded-xl border p-4 transition-colors ${tone.border} ${tone.bg}`}>
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <AnimatePresence mode="wait" initial={false}>
            <motion.p
              key={state}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2 }}
              className={`font-medium ${tone.text}`}
            >
              {view.title}
            </motion.p>
          </AnimatePresence>
          <span className="font-mono text-xs text-muted-foreground">{state}</span>
        </div>

        <div className="grid grid-cols-3 gap-2 sm:gap-4">
          {SPOTS.map((s) => {
            const here = s.id === view.spot;
            return (
              <div
                key={s.id}
                className={`flex h-28 flex-col items-center gap-3 rounded-lg border bg-background p-3 transition-colors ${
                  here ? tone.border : "border-border"
                }`}
              >
                <span className={`text-xs font-medium ${here ? tone.text : "text-muted-foreground"}`}>
                  {s.label}
                </span>
                <div className="flex h-12 items-center justify-center">
                  {here && (
                    <motion.div
                      layoutId="escrow-coin"
                      transition={{ type: "spring", stiffness: 260, damping: 24 }}
                      className={`flex size-12 items-center justify-center rounded-full text-[10px] font-semibold text-white shadow-md ${tone.coin}`}
                    >
                      {state === "DISPUTED" ? (
                        <motion.span
                          animate={{ scale: [1, 1.12, 1] }}
                          transition={{ duration: 1.2, repeat: Infinity }}
                        >
                          {formatUsd(amount)}
                        </motion.span>
                      ) : (
                        formatUsd(amount)
                      )}
                    </motion.div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {view.countdown && deadline && (
          <div className="mt-4 flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-muted-foreground">{view.countdown}</span>
            <span className="text-right">
              <span className={`font-mono text-base tabular-nums ${tone.text}`}>
                {msLeft === null ? "--" : formatCountdown(msLeft)}
              </span>
              <span className="block text-xs text-muted-foreground">by {formatDate(deadline)}</span>
            </span>
          </div>
        )}
      </section>

      <ol className="space-y-2">
        {events.map((e) => (
          <motion.li
            key={e.id}
            layout
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            className="rounded-lg border border-border p-3"
          >
            <span className="font-mono text-xs text-muted-foreground">{e.type}</span>
            <p>{e.message}</p>
            <p className="text-xs text-muted-foreground">{formatDate(e.at)}</p>
          </motion.li>
        ))}
      </ol>

      <div>
        <p className="mb-2 text-xs text-muted-foreground">Demo: simulate (mock mode only)</p>
        <div className="flex flex-wrap gap-2">
          {STATES.map((s) => (
            <Button key={s} size="sm" variant="outline" onClick={() => simulate(s)}>
              {s}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
