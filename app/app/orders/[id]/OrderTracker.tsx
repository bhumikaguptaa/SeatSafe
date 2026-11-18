"use client";

// Owner: D. The live escrow tracker UI. Order data comes from useOrder(id); the real devnet actions
// (confirm, dispute, claim refund, release, mark sent) come from A's useOrderActions(id).
// Until B's Supabase useOrder() lands, real mode falls back to the devnet escrow for state/amount/deadline.
// In mock mode the same buttons drive simulate(), acting as the buyer.
// A coin shows where the money is (You / Vault / Seller) and slides between boxes as the state changes.
// Status tokens (vault/transit/released/disputed) are only ever outlines, glows and text here:
// filled blue is reserved for primary buttons.

import { useSyncExternalStore } from "react";
import { useParams } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowLeftRight,
  BadgeCheck,
  CircleCheck,
  Clock,
  Loader2,
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
import { USE_MOCK, type ChainEscrow } from "@/lib/chain";
import { formatCountdown, formatDate, formatUsd } from "@/lib/format";
import type { OrderEvent, OrderState, Tier } from "@/lib/types";
import { useOrderActions } from "@/components/OrderActions";
import { Button } from "@/components/ui/button";
import { GlassHero } from "@/components/GlassHero";
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

interface TrackerView {
  state: OrderState;
  amount: number;
  deadline: string | null;
  tier: Tier;
  events: OrderEvent[];
}

/** Devnet escrow -> tracker view (escrows are always Tier 2). Null while it's not an order yet. */
function fromEscrow(e: ChainEscrow): TrackerView | null {
  if (e.state === "LISTED" || e.state === "CANCELLED") return null;
  return {
    state: e.state,
    amount: e.priceUsd,
    deadline: e.state === "HELD" ? e.shipDeadline : e.confirmDeadline,
    tier: 2,
    events: [],
  };
}

type ActionKey = "confirm" | "dispute" | "refund" | "release" | "markSent";

interface Action {
  key: ActionKey;
  label: string;
  icon: LucideIcon;
  primary: boolean;
  run: () => void;
}

export function OrderTracker() {
  const { id } = useParams<{ id: string }>();
  const { order, state, amount, deadline, events, loading, simulate } = useOrder(id);
  const actions = useOrderActions(id);
  const now = useNow();

  const escrow = actions.escrow;
  const view: TrackerView | null =
    order && state
      ? { state, amount, deadline, tier: order.tier, events }
      : escrow
        ? fromEscrow(escrow)
        : null;

  if (loading || (!USE_MOCK && actions.loading && !view)) {
    return <Skeleton className="h-72 rounded-2xl" />;
  }
  if (!view) {
    return (
      <p className="text-sm text-muted-foreground">
        {escrow?.state === "LISTED"
          ? "This ticket is listed and waiting for a buyer."
          : escrow?.state === "CANCELLED"
            ? "The seller cancelled this listing."
            : `No order with id “${id}”.`}
      </p>
    );
  }

  const ui = STATE_VIEW[view.state];
  const tone = TONE[ui.tone];
  const msLeft = view.deadline && now !== null ? new Date(view.deadline).getTime() - now : null;
  const deadlinePassed = msLeft !== null && msLeft <= 0;
  const latestFirst = [...view.events].reverse();

  // Who am I on this order? Mock orders always belong to the mock buyer.
  const role: "buyer" | "seller" | null = USE_MOCK
    ? "buyer"
    : escrow && actions.me === escrow.buyer
      ? "buyer"
      : escrow && actions.me === escrow.seller
        ? "seller"
        : null;
  const live = !USE_MOCK && escrow !== null;
  const canAct = USE_MOCK || live;

  // Same rules as A's OrderActions panel. Real mode sends the tx; mock mode simulates the outcome.
  const available: Action[] = [];
  if (canAct && view.state === "HELD") {
    if (deadlinePassed) {
      available.push({ key: "refund", label: "Claim refund", icon: RotateCcw, primary: true, run: live ? actions.claimRefund : () => simulate("REFUNDED") });
    } else if (msLeft !== null) {
      if (role === "seller") {
        available.push({ key: "markSent", label: "I sent the ticket", icon: Send, primary: true, run: live ? actions.markSent : () => simulate("IN_TRANSIT") });
      }
      if (role) {
        available.push({ key: "dispute", label: "Report a problem", icon: ShieldAlert, primary: false, run: live ? actions.onDispute : () => simulate("DISPUTED") });
      }
    }
  }
  if (canAct && view.state === "IN_TRANSIT") {
    if (deadlinePassed) {
      available.push({ key: "release", label: "Release payment", icon: Wallet, primary: true, run: live ? actions.releasePayment : () => simulate("RELEASED") });
    } else if (msLeft !== null) {
      if (role === "buyer") {
        available.push({ key: "confirm", label: "Ticket works, release payment", icon: CircleCheck, primary: true, run: live ? actions.onConfirm : () => simulate("RELEASED") });
      }
      if (role) {
        available.push({ key: "dispute", label: "Report a problem", icon: ShieldAlert, primary: false, run: live ? actions.onDispute : () => simulate("DISPUTED") });
      }
    }
  }
  const busy = live ? actions.busy : null;

  return (
    <div className="space-y-4">
      {/* Hero: the amount is the focal point; status lives in the outlined pill and the coin. */}
      <section>
        <div className="flex items-center justify-between gap-3">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${tone.border} ${tone.text}`}
          >
            <span className={`size-1.5 rounded-full ${tone.border} border-2`} />
            {ui.pill}
          </span>
          <span className="text-xs text-muted-foreground">
            {live ? "Live on devnet · " : ""}
            {view.tier === 1 ? "SeatSafe ticket" : "Outside ticket · escrow"}
          </span>
        </div>

        <p className="mt-5 text-[15px] text-muted-foreground">Order amount</p>
        <p className="mt-1 text-[46px] leading-none font-bold tracking-tight tabular-nums">{formatUsd(view.amount)}</p>
        <AnimatePresence mode="wait" initial={false}>
          <motion.p
            key={view.state}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2 }}
            className={`mt-2 text-[15px] font-semibold ${tone.text}`}
          >
            {ui.title}
          </motion.p>
        </AnimatePresence>

        {/* Hero glass card: where the money is. */}
        <GlassHero as="div" className="mt-6 p-4 sm:p-5">
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            {SPOTS.map((s) => {
              const here = s.id === ui.spot;
              const Icon = s.icon;
              return (
                <div key={s.id} className="flex flex-col items-center gap-2">
                  <div
                    className={`flex h-24 w-full items-center justify-center rounded-2xl border bg-muted/60 transition-colors ${
                      here ? tone.border : "border-border"
                    }`}
                  >
                    {here ? (
                      <motion.div
                        layoutId="escrow-coin"
                        transition={{ type: "spring", stiffness: 260, damping: 24 }}
                        className={`flex size-14 items-center justify-center rounded-full border-2 bg-[#0b1430]/80 text-[11px] font-semibold tabular-nums ${tone.border} ${tone.text} ${tone.glow}`}
                      >
                        {view.state === "DISPUTED" ? (
                          <motion.span
                            animate={{ scale: [1, 1.12, 1] }}
                            transition={{ duration: 1.2, repeat: Infinity }}
                          >
                            {formatUsd(view.amount)}
                          </motion.span>
                        ) : (
                          formatUsd(view.amount)
                        )}
                      </motion.div>
                    ) : (
                      <Icon className="size-6 text-muted-foreground" />
                    )}
                  </div>
                  <span className={`text-[13px] font-semibold ${here ? tone.text : "text-muted-foreground"}`}>
                    {s.label}
                  </span>
                </div>
              );
            })}
          </div>
        </GlassHero>

        {/* Solid card: the deadline and the next action (important info, no gradient behind it). */}
        {((ui.countdown && view.deadline) || available.length > 0) && (
          <div className="surface-solid mt-4 space-y-4 rounded-3xl p-4 sm:p-5">
            {ui.countdown && view.deadline && (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-[15px] text-muted-foreground">
                  <Clock className="size-4" />
                  {ui.countdown}
                </span>
                <span className="text-right">
                  <span className={`text-xl font-bold tabular-nums ${tone.text}`}>
                    {msLeft === null ? "--" : formatCountdown(msLeft)}
                  </span>
                  <span className="block text-[13px] text-muted-foreground">by {formatDate(view.deadline)}</span>
                </span>
              </div>
            )}

            {available.length > 0 && (
              <div className="space-y-2">
                {available.map((a) => {
                  const Icon = a.icon;
                  return (
                    <Button
                      key={a.key}
                      size="lg"
                      variant={a.primary ? "default" : "outline"}
                      className="h-12 w-full rounded-2xl text-[15px] font-semibold"
                      disabled={busy !== null}
                      onClick={a.run}
                    >
                      {busy === a.key ? <Loader2 className="animate-spin" /> : <Icon />}
                      {a.label}
                    </Button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Activity, newest first. */}
      {latestFirst.length > 0 && (
        <section className="pt-2">
          <h2 className="text-lg font-bold">Activity</h2>
          <ol className="mt-3 space-y-3">
            {latestFirst.map((e) => {
              const Icon = EVENT_ICON[e.type];
              return (
                <motion.li
                  key={e.id}
                  layout
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-center gap-3.5 surface-solid rounded-2xl p-4"
                >
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <Icon className="size-[18px]" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[15px] leading-snug font-semibold">{e.message}</p>
                    <p className="mt-0.5 text-[13px] text-muted-foreground">{formatDate(e.at)}</p>
                  </div>
                </motion.li>
              );
            })}
          </ol>
        </section>
      )}

      {USE_MOCK && (
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
      )}
    </div>
  );
}
