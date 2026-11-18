"use client";

// Owner: D. The agent console: plain-English request -> parsed rules -> one-tap approval ->
// budget vault + live decision log -> voice approval before a fill.
// Mock mode: everything is simulated by useAgentDemo(). Real mode (USE_MOCK false): approving locks the
// budget onchain via useAgentChain(), "Your standing orders" lists them with Close & refund, and the
// decision log says the agent isn't running yet (no crank on devnet).
// Filled blue is reserved for the one primary action on screen at a time.

import { useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowUp,
  Ban,
  CalendarClock,
  Check,
  CircleCheck,
  DollarSign,
  Eye,
  Loader2,
  Lock,
  Search,
  Sparkles,
  Star,
  Ticket,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { USE_MOCK } from "@/lib/chain";
import { formatDate, formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Event, StandingOrder } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { VoiceApproval } from "@/components/VoiceApproval";
import { useAgentDemo, type AgentLogEntry, type ParsedRules } from "./useAgentDemo";
import { useAgentChain } from "./useAgentChain";
import { useAgentCrank } from "./useAgentCrank";

const SUGGESTIONS = [
  "2 tickets for UT vs A&M under $90, 4+ star sellers, before Friday",
  "1 ticket for Neon Harbor under $100, 4.5+ star sellers",
  "4 tickets for Battle of the Bands under $20",
];

const LOG_ICON: Record<AgentLogEntry["kind"], LucideIcon> = {
  lock: Lock,
  seen: Eye,
  skip: Ban,
  found: Search,
  filled: CircleCheck,
  declined: X,
  waiting: Eye,
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "America/Chicago",
  });
}

function RuleCard({
  icon: Icon,
  label,
  value,
  missing,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  missing?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-2xl border bg-muted p-3",
        missing ? "border-dashed border-border" : "border-border",
      )}
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white/[0.06] text-muted-foreground">
        <Icon className="size-4" />
      </span>
      <div className="min-w-0">
        <p className="text-[13px] text-muted-foreground">{label}</p>
        <p className={cn("truncate text-[15px] font-semibold", missing && "font-normal text-muted-foreground")}>
          {value}
        </p>
      </div>
    </div>
  );
}

function RulesGrid({ rules }: { rules: ParsedRules }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <RuleCard
        icon={Ticket}
        label="Event"
        value={rules.event?.title ?? "Which event? Name it in your request"}
        missing={!rules.event}
      />
      <RuleCard icon={Users} label="Tickets" value={`${rules.quantity}`} />
      <RuleCard
        icon={DollarSign}
        label="Max price"
        value={rules.maxPriceUsd !== null ? `${formatUsd(rules.maxPriceUsd)} each` : "Add a max, e.g. “under $90”"}
        missing={rules.maxPriceUsd === null}
      />
      <RuleCard
        icon={Star}
        label="Sellers"
        value={rules.minSellerRating !== null ? `${rules.minSellerRating}★ and up` : "Any rating"}
      />
      <RuleCard
        icon={CalendarClock}
        label="Deadline"
        value={rules.deadline ? `Before ${formatDate(rules.deadline)}` : "Until the event"}
      />
      <RuleCard
        icon={Lock}
        label="Budget to lock"
        value={rules.budgetUsd !== null ? formatUsd(rules.budgetUsd) : "Needs a max price"}
        missing={rules.budgetUsd === null}
      />
    </div>
  );
}

/** Real mode only: the in-browser crank's status, live decision log and "Check now". */
function AgentRunCard({ crank }: { crank: ReturnType<typeof useAgentCrank> }) {
  const busy = crank.checking || crank.filling || crank.pending !== null;
  return (
    <section className="surface-solid rounded-3xl p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          Your agent
          {crank.active && (
            <span className="inline-flex items-center gap-1.5 text-xs font-normal text-muted-foreground">
              <motion.span
                className="size-1.5 rounded-full bg-foreground"
                animate={{ opacity: [1, 0.2, 1] }}
                transition={{ duration: 1.2, repeat: Infinity }}
              />
              Live
            </span>
          )}
        </h2>
        <Button
          variant="outline"
          size="sm"
          className="rounded-full"
          disabled={!crank.active || busy}
          onClick={crank.checkNow}
        >
          {crank.checking ? <Loader2 className="animate-spin" /> : <Search />}
          Check now
        </Button>
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Runs in this browser while this page is open. Checks resale listings every 10 s and asks you before
        buying.
      </p>

      {!crank.active && crank.log.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          No open standing orders. Lock a budget above and your agent starts watching.
        </p>
      ) : (
        <ol className="mt-3 divide-y divide-border">
          <AnimatePresence initial={false}>
            {[...crank.log].reverse().map((entry) => {
              const Icon = LOG_ICON[entry.kind];
              return (
                <motion.li
                  key={entry.id}
                  layout
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-start gap-3 py-3"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                    <Icon className="size-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[15px]">{entry.message}</p>
                    <p className="text-[13px] text-muted-foreground">{formatTime(entry.at)}</p>
                  </div>
                </motion.li>
              );
            })}
          </AnimatePresence>
          {(crank.checking || crank.filling) && (
            <li className="flex items-center gap-3 py-3 text-sm text-muted-foreground">
              <span className="flex size-9 items-center justify-center">
                <Loader2 className="size-4 animate-spin" />
              </span>
              {crank.filling ? "Buying…" : "Checking listings…"}
            </li>
          )}
        </ol>
      )}
    </section>
  );
}

const ORDER_STATUS: Record<StandingOrder["status"], { label: string; className: string }> = {
  OPEN: { label: "Open", className: "border-vault text-vault" },
  FILLED: { label: "Filled", className: "border-released text-released" },
  EXPIRED: { label: "Expired", className: "border-border text-muted-foreground" },
  CANCELLED: { label: "Closed", className: "border-border text-muted-foreground" },
};

/** Real mode only: my standing orders from devnet, with Close & refund. */
function StandingOrdersCard({
  chain,
  events,
}: {
  chain: ReturnType<typeof useAgentChain>;
  events: Event[];
}) {
  const sorted = [...chain.orders].sort((a, b) => b.deadline.localeCompare(a.deadline));

  return (
    <section className="surface-solid rounded-3xl p-5 sm:p-6">
      <h2 className="text-lg font-bold">Your standing orders</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Live on devnet. Seller-rating rules aren&apos;t stored onchain yet, so they aren&apos;t enforced.
      </p>

      {!chain.me ? (
        <p className="mt-4 text-sm text-muted-foreground">Log in to see your standing orders.</p>
      ) : chain.ordersLoading && sorted.length === 0 ? (
        <Skeleton className="mt-4 h-20 rounded-2xl" />
      ) : sorted.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">No standing orders yet.</p>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {sorted.map((o) => {
            const status = ORDER_STATUS[o.status];
            const title = events.find((e) => e.id === o.eventId)?.title ?? `Event ${o.eventId.slice(0, 4)}…${o.eventId.slice(-4)}`;
            const leftover = o.status === "FILLED" ? (chain.leftoverUsd[o.id] ?? 0) : 0;
            const closable = o.status === "OPEN" || o.status === "EXPIRED" || leftover > 0;
            const closing = chain.busy === o.id;
            return (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{title}</p>
                  <p className="text-xs text-muted-foreground">
                    {o.quantity} × up to {formatUsd(o.maxPriceUsd)} · {formatUsd(o.budgetUsd)} budget · until{" "}
                    {formatDate(o.deadline)}
                  </p>
                  {leftover > 0 && (
                    <p className="text-xs text-muted-foreground">{formatUsd(leftover)} left in your vault</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className={cn("rounded-full border px-2.5 py-0.5 text-xs font-medium", status.className)}>
                    {status.label}
                  </span>
                  {closable && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="rounded-full"
                      disabled={chain.busy !== null}
                      onClick={() => void chain.close(o.id)}
                    >
                      {closing && <Loader2 className="animate-spin" />}
                      Close &amp; refund
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function AgentConsole() {
  const agent = useAgentDemo();
  const [text, setText] = useState("");
  const { phase, rules, log, spentUsd, proposal } = agent;

  const chain = useAgentChain();
  const crank = useAgentCrank({
    me: chain.me,
    orders: chain.orders,
    events: agent.events,
    refreshOrders: chain.refresh,
  });

  const ready = rules?.event && rules.maxPriceUsd !== null && rules.budgetUsd !== null;
  const started = phase === "running" || phase === "awaiting" || phase === "filled" || phase === "locked";
  const needsLogin = !USE_MOCK && !chain.me;
  const locking = chain.busy === "open";

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    agent.submit(text);
  }

  // Mock: simulate the scan. Real: lock the budget onchain, then show the honest "not running" state.
  async function onApproveRules() {
    if (USE_MOCK) {
      agent.approveRules();
      return;
    }
    if (rules && (await chain.open(rules))) agent.markLocked();
  }

  return (
    <div className="space-y-4">
      {/* Prompt: plain-English request, like the voice-assistant home screen. */}
      <section className="pb-2">
        <h2 className="text-[28px] leading-tight font-bold tracking-tight">What should your agent buy?</h2>
        <p className="mt-2 text-[15px] text-muted-foreground">
          Say it in plain English. Your agent only buys inside the rules you approve, from a budget you lock.
        </p>

        <div className="-mx-1 mt-4 flex gap-2 overflow-x-auto px-1 pb-1">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setText(s)}
              className="w-48 shrink-0 rounded-2xl glass p-3.5 text-left text-[13px] leading-snug text-foreground/85 transition-colors hover:border-muted-foreground/40"
            >
              <span className="mb-3 flex size-8 items-center justify-center rounded-full bg-muted">
                <Sparkles className="size-4 text-muted-foreground" />
              </span>
              {s}
            </button>
          ))}
        </div>

        <form
          onSubmit={onSubmit}
          className="mt-4 flex items-center gap-2 rounded-full glass py-1.5 pr-1.5 pl-5 focus-within:border-ring"
        >
          <label htmlFor="agent-request" className="sr-only">
            Your request
          </label>
          <input
            id="agent-request"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="2 tickets for UT vs A&M under $90, 4+ star sellers, before Friday"
            className="h-10 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground"
          />
          <Button
            type="submit"
            size="icon"
            variant={phase === "idle" ? "default" : "outline"}
            className="size-11 shrink-0 rounded-full"
            aria-label="Read my request"
            disabled={!text.trim() || agent.eventsLoading}
          >
            <ArrowUp className="size-5" />
          </Button>
        </form>
      </section>

      {agent.eventsLoading && <Skeleton className="h-40 rounded-3xl" />}

      {rules && (
        <div className="space-y-4">
          <div className="space-y-4">
            {/* Parsed rules, approved with one tap. */}
            <section className="surface-solid rounded-3xl p-5 sm:p-6">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="text-lg font-bold">Your rules</h2>
                {started ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-0.5 text-xs font-medium">
                    <Check className="size-3.5" />
                    Approved
                  </span>
                ) : (
                  <Button variant="ghost" size="sm" onClick={agent.reset}>
                    Start over
                  </Button>
                )}
              </div>
              <RulesGrid rules={rules} />
              {phase === "review" && (
                <div className="mt-5">
                  <Button
                    size="lg"
                    className="h-12 w-full rounded-2xl text-[15px] font-semibold"
                    disabled={!ready || needsLogin || locking}
                    onClick={onApproveRules}
                  >
                    {locking ? <Loader2 className="animate-spin" /> : <Lock />}
                    {needsLogin
                      ? "Log in to lock a budget"
                      : ready
                        ? `Approve rules & lock ${formatUsd(rules.budgetUsd!)}`
                        : "Approve rules"}
                  </Button>
                  {!ready && (
                    <p className="mt-2 text-center text-xs text-muted-foreground">
                      Add an event and a max price to your request, then send it again.
                    </p>
                  )}
                  {ready && !USE_MOCK && (
                    <p className="mt-2 text-center text-xs text-muted-foreground">
                      Moves {formatUsd(rules.budgetUsd!)} of devnet USDC from your wallet into a budget vault.
                    </p>
                  )}
                </div>
              )}
            </section>

            {/* Budget vault: money is the focal point. Status colors only on the outlined pill. */}
            {started && rules.budgetUsd !== null && (
              <motion.section
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="surface-solid rounded-3xl p-5 sm:p-6"
              >
                <div className="flex items-center justify-between gap-3">
                  <h2 className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Lock className="size-4" />
                    Budget vault
                  </h2>
                  <span
                    className={cn(
                      "rounded-full border px-2.5 py-0.5 text-xs font-medium",
                      phase === "filled" ? "border-released text-released" : "border-vault text-vault",
                    )}
                  >
                    {phase === "filled" ? "Filled" : "Budget locked"}
                  </span>
                </div>
                {phase === "locked" ? (
                  <p className="mt-4 flex items-baseline gap-2">
                    <span className="text-5xl font-bold tracking-tight tabular-nums">{formatUsd(rules.budgetUsd)}</span>
                    <span className="text-muted-foreground">locked</span>
                  </p>
                ) : (
                  <p className="mt-4 flex items-baseline gap-2">
                    <span className="text-5xl font-bold tracking-tight tabular-nums">{formatUsd(spentUsd)}</span>
                    <span className="text-muted-foreground tabular-nums">/ {formatUsd(rules.budgetUsd)} used</span>
                  </p>
                )}
                <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted">
                  <motion.div
                    className="h-full rounded-full bg-foreground"
                    initial={false}
                    animate={{ width: `${Math.min(100, (spentUsd / rules.budgetUsd) * 100)}%` }}
                    transition={{ type: "spring", stiffness: 120, damping: 20 }}
                  />
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  {phase === "locked"
                    ? "Locked in your SeatSafe vault on devnet. Your agent checks listings every 10 s while this page is open and asks you before it buys."
                    : "Locked in your SeatSafe vault. Anything unused comes back to you when the order closes."}
                </p>
              </motion.section>
            )}
          </div>

          {/* Simulated decision log (mock mode). Real mode shows AgentRunCard below. */}
          {USE_MOCK && (
            <section className="surface-solid rounded-3xl p-5 sm:p-6">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-lg font-bold">Decision log</h2>
                {phase === "running" && (
                  <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                    <motion.span
                      className="size-1.5 rounded-full bg-foreground"
                      animate={{ opacity: [1, 0.2, 1] }}
                      transition={{ duration: 1.2, repeat: Infinity }}
                    />
                    Live
                  </span>
                )}
              </div>
  
              {log.length === 0 && phase !== "running" ? (
                <p className="text-sm text-muted-foreground">
                  Approve your rules to start the agent. Every decision it makes shows up here.
                </p>
              ) : (
                <ol className="divide-y divide-border">
                  <AnimatePresence initial={false}>
                    {[...log].reverse().map((entry) => {
                      const Icon = LOG_ICON[entry.kind];
                      return (
                        <motion.li
                          key={entry.id}
                          layout
                          initial={{ opacity: 0, y: -6 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="flex items-start gap-3 py-3"
                        >
                          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                            <Icon className="size-4" />
                          </span>
                          <div className="min-w-0">
                            <p className="text-[15px]">{entry.message}</p>
                            <p className="text-[13px] text-muted-foreground">{formatTime(entry.at)}</p>
                          </div>
                        </motion.li>
                      );
                    })}
                  </AnimatePresence>
                  {phase === "running" && (
                    <li className="flex items-center gap-3 py-3 text-sm text-muted-foreground">
                      <span className="flex size-9 items-center justify-center">
                        <Loader2 className="size-4 animate-spin" />
                      </span>
                      Scanning listings…
                    </li>
                  )}
                </ol>
              )}
            </section>
          )}
        </div>
      )}

      {!USE_MOCK && chain.me && <AgentRunCard crank={crank} />}
      {!USE_MOCK && <StandingOrdersCard chain={chain} events={agent.events} />}

      {USE_MOCK ? (
        <VoiceApproval
          request={
            proposal && rules?.event
              ? {
                  prompt: `Found ${proposal.quantity} ${proposal.quantity === 1 ? "ticket" : "tickets"} for ${rules.event.title} at ${formatUsd(proposal.priceUsd)} each. Buy them?`,
                  totalUsd: proposal.totalUsd,
                  detail: `${proposal.section} · seller ${proposal.sellerRating}★ · paid from your budget vault`,
                  voice: {
                    event_title: rules.event.title,
                    seat: proposal.section,
                    price: `${formatUsd(proposal.priceUsd)} each`,
                    max_price: formatUsd(rules.maxPriceUsd ?? proposal.priceUsd),
                    seller_rating: `${proposal.sellerRating} stars`,
                    quantity: proposal.quantity,
                  },
                }
              : null
          }
          onApprove={agent.approveFill}
          onDecline={agent.declineFill}
        />
      ) : (
        <VoiceApproval
          request={
            crank.pending
              ? {
                  prompt: `Found a ticket for ${crank.pending.eventTitle} at ${formatUsd(crank.pending.listing.priceUsd)} (your max is ${formatUsd(crank.pending.order.maxPriceUsd)}). Buy it?`,
                  totalUsd: crank.pending.listing.priceUsd,
                  detail: `${crank.pending.listing.seat || "Seat on the ticket"} · seller ${crank.pending.listing.sellerName} · paid from your budget vault`,
                  voice: {
                    event_title: crank.pending.eventTitle,
                    seat: crank.pending.listing.seat || "general admission",
                    price: formatUsd(crank.pending.listing.priceUsd),
                    max_price: formatUsd(crank.pending.order.maxPriceUsd),
                    seller_rating: "not rated yet",
                    quantity: 1,
                  },
                }
              : null
          }
          onApprove={crank.approve}
          onDecline={crank.decline}
        />
      )}
    </div>
  );
}
