"use client";

// Owner: D. The live escrow tracker UI. Build it ONLY from useOrder(id).
// A coin shows where the money is (You / Vault / Seller) and slides between boxes as the state changes.
// Status tokens (vault/transit/released/disputed) are only ever outlines, glows and text here:
// filled blue is reserved for primary buttons. Use the simulate buttons to walk through every state.

import { useSyncExternalStore } from "react";
import { useParams } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowLeftRight,
  BadgeCheck,
  CircleCheck,
  Clock,
  Lock,
  RotateCcw,
  Send,
  ShieldAlert,
  Store,
  User,
  Vault,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { useOrder } from "@/lib/hooks";
import { formatCountdown, formatDate, formatUsd } from "@/lib/format";
import type { OrderEvent, OrderState } from "@/lib/types";
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

const SPOTS: { id: Spot; label: string; icon: LucideIcon }[] = [
  { id: "you", label: "You", icon: User },
  { id: "vault", label: "Vault", icon: Vault },
  { id: "seller", label: "Seller", icon: Store },
];

/** Where the money sits in each state, how to color it, and what to tell the buyer. */
const STATE_VIEW: Record<
  OrderState,
  { spot: Spot; tone: Tone; pill: string; title: string; countdown?: string }
> = {
  HELD: { spot: "vault", tone: "vault", pill: "In the vault", title: "Your payment is locked in the vault", countdown: "Seller must send the ticket in" },
  IN_TRANSIT: { spot: "vault", tone: "transit", pill: "Ticket on the way", title: "Ticket sent. Check it and confirm", countdown: "Time left to confirm" },
  CONFIRMED: { spot: "vault", tone: "released", pill: "Confirmed", title: "Confirmed. Releasing payment to the seller" },
  RELEASED: { spot: "seller", tone: "released", pill: "Released", title: "Payment released to the seller" },
  SWAPPED: { spot: "seller", tone: "released", pill: "Swapped", title: "Ticket and payment swapped in one transaction" },
  REFUNDED: { spot: "you", tone: "released", pill: "Refunded", title: "Refunded in full" },
  DISPUTED: { spot: "vault", tone: "disputed", pill: "Disputed", title: "Dispute open. Funds stay locked" },
};

// Static class strings so Tailwind picks them up.
const TONE: Record<Tone, { text: string; border: string; glow: string; tint: string }> = {
  vault: { text: "text-vault", border: "border-vault", glow: "shadow-[0_0_28px_-6px_var(--vault)]", tint: "bg-vault/10" },
  transit: { text: "text-transit", border: "border-transit", glow: "shadow-[0_0_28px_-6px_var(--transit)]", tint: "bg-transit/10" },
  released: { text: "text-released", border: "border-released", glow: "shadow-[0_0_28px_-6px_var(--released)]", tint: "bg-released/10" },
  disputed: { text: "text-disputed", border: "border-disputed", glow: "shadow-[0_0_28px_-6px_var(--disputed)]", tint: "bg-disputed/10" },
};

const EVENT_ICON: Record<OrderEvent["type"], LucideIcon> = {
  FUNDED: Lock,
  TICKET_SENT: Send,
  CONFIRMED: CircleCheck,
  RELEASED: Wallet,
  REFUNDED: RotateCcw,
  DISPUTE_OPENED: ShieldAlert,
  DISPUTE_RESOLVED: BadgeCheck,
  SWAPPED: ArrowLeftRight,
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

  if (loading) return <Skeleton className="h-72 rounded-2xl" />;
  if (!order || !state) {
    return <p className="text-sm text-muted-foreground">No order with id “{id}”.</p>;
  }

  const view = STATE_VIEW[state];
  const tone = TONE[view.tone];
  const msLeft = deadline && now !== null ? new Date(deadline).getTime() - now : null;
  const latestFirst = [...events].reverse();

  return (
    <div className="space-y-4">
      {/* Hero: the amount is the focal point; status lives in the outlined pill and the coin. */}
      <section className="rounded-2xl border border-border bg-card bg-linear-to-b from-foreground/[0.04] to-transparent p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${tone.border} ${tone.text}`}
          >
            <span className={`size-1.5 rounded-full ${tone.border} border-2`} />
            {view.pill}
          </span>
          <span className="text-xs text-muted-foreground">
            {order.tier === 1 ? "SeatSafe ticket" : "Outside ticket · escrow"}
          </span>
        </div>

        <p className="mt-5 text-sm text-muted-foreground">Order amount</p>
        <p className="text-5xl font-bold tracking-tight tabular-nums">{formatUsd(amount)}</p>
        <AnimatePresence mode="wait" initial={false}>
          <motion.p
            key={state}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2 }}
            className={`mt-1 text-sm font-medium ${tone.text}`}
          >
            {view.title}
          </motion.p>
        </AnimatePresence>

        <div className="mt-6 grid grid-cols-3 gap-2 sm:gap-3">
          {SPOTS.map((s) => {
            const here = s.id === view.spot;
            const Icon = s.icon;
            return (
              <div
                key={s.id}
                className={`flex h-32 flex-col items-center justify-center gap-2 rounded-2xl border bg-background/50 transition-colors ${
                  here ? tone.border : "border-border"
                }`}
              >
                <div className="flex size-14 items-center justify-center">
                  {here ? (
                    <motion.div
                      layoutId="escrow-coin"
                      transition={{ type: "spring", stiffness: 260, damping: 24 }}
                      className={`flex size-14 items-center justify-center rounded-full border-2 bg-card text-[11px] font-semibold tabular-nums ${tone.border} ${tone.text} ${tone.glow}`}
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
                  ) : (
                    <span className="flex size-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                      <Icon className="size-5" />
                    </span>
                  )}
                </div>
                <span className={`text-xs font-medium ${here ? tone.text : "text-muted-foreground"}`}>
                  {s.label}
                </span>
              </div>
            );
          })}
        </div>

        {view.countdown && deadline && (
          <div className={`mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl px-4 py-3 ${tone.tint}`}>
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="size-4" />
              {view.countdown}
            </span>
            <span className="text-right">
              <span className={`font-mono text-lg font-semibold tabular-nums ${tone.text}`}>
                {msLeft === null ? "--" : formatCountdown(msLeft)}
              </span>
              <span className="block text-xs text-muted-foreground">by {formatDate(deadline)}</span>
            </span>
          </div>
        )}
      </section>

      {/* Activity, newest first. */}
      <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
        <h2 className="text-base font-semibold">Activity</h2>
        <ol className="mt-3 divide-y divide-border">
          {latestFirst.map((e) => {
            const Icon = EVENT_ICON[e.type];
            return (
              <motion.li
                key={e.id}
                layout
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-start gap-3 py-3"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                  <Icon className="size-4" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium">{e.message}</p>
                  <p className="text-xs text-muted-foreground">{formatDate(e.at)}</p>
                </div>
              </motion.li>
            );
          })}
        </ol>
      </section>

      <section className="rounded-2xl border border-dashed border-border p-4">
        <p className="mb-2 text-xs text-muted-foreground">Demo: simulate a state change (mock mode only)</p>
        <div className="flex flex-wrap gap-2">
          {STATES.map((s) => (
            <Button key={s} size="sm" variant="outline" className="rounded-full" onClick={() => simulate(s)}>
              {s}
            </Button>
          ))}
        </div>
      </section>
    </div>
  );
}
