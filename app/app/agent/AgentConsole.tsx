"use client";

// Owner: D. The agent console: plain-English request -> parsed rules -> one-tap approval ->
// budget vault + live decision log -> voice approval before a fill.
// State comes from useAgentDemo() (simulated); see that file for the real wiring.
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
import { formatDate, formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { VoiceApproval } from "@/components/VoiceApproval";
import { useAgentDemo, type AgentLogEntry, type ParsedRules } from "./useAgentDemo";

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
        "flex items-center gap-3 rounded-2xl border bg-background/50 p-3",
        missing ? "border-dashed border-border" : "border-border",
      )}
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        <Icon className="size-4" />
      </span>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={cn("truncate text-sm font-semibold", missing && "font-normal text-muted-foreground")}>
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

export function AgentConsole() {
  const agent = useAgentDemo();
  const [text, setText] = useState("");
  const { phase, rules, log, spentUsd, proposal } = agent;

  const ready = rules?.event && rules.maxPriceUsd !== null && rules.budgetUsd !== null;
  const started = phase === "running" || phase === "awaiting" || phase === "filled";

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    agent.submit(text);
  }

  return (
    <div className="space-y-4">
      {/* Prompt: plain-English request, like the voice-assistant home screen. */}
      <section className="rounded-3xl border border-border bg-card bg-linear-to-b from-foreground/[0.04] to-transparent p-5 sm:p-6">
        <h2 className="text-2xl font-bold tracking-tight">What should your agent buy?</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Say it in plain English. Your agent only buys inside the rules you approve, from a budget you lock.
        </p>

        <div className="-mx-1 mt-4 flex gap-2 overflow-x-auto px-1 pb-1">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setText(s)}
              className="w-56 shrink-0 rounded-2xl border border-border bg-background/50 p-3 text-left text-xs text-muted-foreground transition-colors hover:border-foreground/20 hover:text-foreground"
            >
              <Sparkles className="mb-2 size-4" />
              {s}
            </button>
          ))}
        </div>

        <form
          onSubmit={onSubmit}
          className="mt-4 flex items-center gap-2 rounded-full border border-border bg-background/60 py-1.5 pr-1.5 pl-4 focus-within:border-ring"
        >
          <label htmlFor="agent-request" className="sr-only">
            Your request
          </label>
          <input
            id="agent-request"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="2 tickets for UT vs A&M under $90, 4+ star sellers, before Friday"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <Button
            type="submit"
            size="icon"
            variant={phase === "idle" ? "default" : "outline"}
            className="size-10 shrink-0 rounded-full"
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
            <section className="rounded-3xl border border-border bg-card p-5 sm:p-6">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="text-base font-semibold">Your rules</h2>
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
                    className="h-12 w-full rounded-xl text-base"
                    disabled={!ready}
                    onClick={agent.approveRules}
                  >
                    <Lock />
                    {ready ? `Approve rules & lock ${formatUsd(rules.budgetUsd!)}` : "Approve rules"}
                  </Button>
                  {!ready && (
                    <p className="mt-2 text-center text-xs text-muted-foreground">
                      Add an event and a max price to your request, then send it again.
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
                className="rounded-3xl border border-border bg-card p-5 sm:p-6"
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
                <p className="mt-4 flex items-baseline gap-2">
                  <span className="text-5xl font-bold tracking-tight tabular-nums">{formatUsd(spentUsd)}</span>
                  <span className="text-muted-foreground tabular-nums">/ {formatUsd(rules.budgetUsd)} used</span>
                </p>
                <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted">
                  <motion.div
                    className="h-full rounded-full bg-foreground"
                    initial={false}
                    animate={{ width: `${Math.min(100, (spentUsd / rules.budgetUsd) * 100)}%` }}
                    transition={{ type: "spring", stiffness: 120, damping: 20 }}
                  />
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  Locked in your SeatSafe vault. Anything unused comes back to you when the order closes.
                </p>
              </motion.section>
            )}
          </div>

          {/* Live decision log. */}
          <section className="rounded-3xl border border-border bg-card p-5 sm:p-6">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold">Decision log</h2>
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
                          <p className="text-sm">{entry.message}</p>
                          <p className="text-xs text-muted-foreground">{formatTime(entry.at)}</p>
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
        </div>
      )}

      <VoiceApproval
        request={
          proposal && rules?.event
            ? {
                prompt: `Found ${proposal.quantity} ${proposal.quantity === 1 ? "ticket" : "tickets"} for ${rules.event.title} at ${formatUsd(proposal.priceUsd)} each. Buy them?`,
                totalUsd: proposal.totalUsd,
                detail: `${proposal.section} · seller ${proposal.sellerRating}★ · paid from your budget vault`,
              }
            : null
        }
        onApprove={agent.approveFill}
        onDecline={agent.declineFill}
      />
    </div>
  );
}
