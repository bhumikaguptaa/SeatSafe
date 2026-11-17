"use client";

// Owner: D. DEMO ONLY: the agent console's state, simulated in the browser.
// Events come from useEvents(); everything else (parsing, the scan, the decision log, the budget)
// is faked here so the UI can be built and demoed with zero backend.
//
// Real wiring (see the PR description for owners):
//   parseRequest()  -> an LLM call behind an API route that returns StandingOrder fields
//   approveRules()  -> openStandingOrder() in lib/program.ts (locks the budget in the vault)
//   the scan + log  -> a backend crank that calls fill_standing_order and writes decisions to Supabase,
//                      read through new hooks in lib/hooks.ts (e.g. useStandingOrders / useAgentLog)
//   approveFill()   -> the crank waits for the user's yes (VoiceApproval) before it fills
// The local types below would move to lib/types.ts with A's OK.

import { useCallback, useEffect, useRef, useState } from "react";
import { useEvents } from "@/lib/hooks";
import type { Event } from "@/lib/types";

/** What the agent understood from the plain-English request. Mirrors StandingOrder's fields. */
export interface ParsedRules {
  event: Event | null;
  quantity: number;
  maxPriceUsd: number | null;
  minSellerRating: number | null;
  /** ISO, or null when no deadline was given */
  deadline: string | null;
  budgetUsd: number | null;
}

export interface AgentLogEntry {
  id: string;
  kind: "lock" | "seen" | "skip" | "found" | "filled" | "declined" | "waiting";
  message: string;
  at: string; // ISO
}

export interface FillProposal {
  quantity: number;
  priceUsd: number;
  totalUsd: number;
  section: string;
  sellerRating: number;
}

export type AgentPhase = "idle" | "review" | "running" | "awaiting" | "filled";

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
const STOPWORDS = new Set(["tickets", "ticket", "for", "under", "the", "and", "seats", "seat", "before", "star", "stars", "sellers", "seller", "vs", "game", "max"]);

function words(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
}

/** Best event whose title shares at least two meaningful words with the request. */
function matchEvent(text: string, events: Event[]): Event | null {
  const asked = new Set(words(text));
  let best: Event | null = null;
  let bestScore = 1;
  for (const e of events) {
    const score = words(e.title).filter((w) => asked.has(w)).length;
    if (score > bestScore) {
      best = e;
      bestScore = score;
    }
  }
  return best;
}

/** "before Friday" -> the next Friday at 00:00 local time. */
function parseDeadline(text: string, nowMs: number): string | null {
  const m = text.toLowerCase().match(/(?:before|by)\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)/);
  if (!m) return null;
  const target = WEEKDAYS.indexOf(m[1]);
  const d = new Date(nowMs);
  const ahead = (target - d.getDay() + 7) % 7 || 7;
  d.setDate(d.getDate() + ahead);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

/** Tiny rule-based stand-in for the LLM parser. */
export function parseRequest(text: string, events: Event[], nowMs: number): ParsedRules {
  const lower = text.toLowerCase();
  const qtyMatch = lower.match(/\b(\d+|one|two|three|four|five|six)\s+(?:tickets?|seats?)/);
  const quantity = qtyMatch ? (NUMBER_WORDS[qtyMatch[1]] ?? Number(qtyMatch[1])) : 1;
  const priceMatch = lower.match(/(?:under|below|max|up to|<)\s*\$?\s*(\d+(?:\.\d+)?)/);
  const maxPriceUsd = priceMatch ? Number(priceMatch[1]) : null;
  const ratingMatch = lower.match(/(\d(?:\.\d)?)\s*\+?\s*(?:-|\s)?(?:stars?|★)/);
  const minSellerRating = ratingMatch ? Math.min(5, Number(ratingMatch[1])) : null;
  return {
    event: matchEvent(text, events),
    quantity,
    maxPriceUsd,
    minSellerRating,
    deadline: parseDeadline(text, nowMs),
    budgetUsd: maxPriceUsd !== null ? maxPriceUsd * quantity : null,
  };
}

export function useAgentDemo() {
  const { events, loading } = useEvents();
  const [phase, setPhase] = useState<AgentPhase>("idle");
  const [rules, setRules] = useState<ParsedRules | null>(null);
  const [log, setLog] = useState<AgentLogEntry[]>([]);
  const [spentUsd, setSpentUsd] = useState(0);
  const [proposal, setProposal] = useState<FillProposal | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);
  useEffect(() => clearTimers, [clearTimers]);

  const push = useCallback((kind: AgentLogEntry["kind"], message: string) => {
    const at = Date.now();
    setLog((l) => [...l, { id: `log_${at}_${l.length}`, kind, message, at: new Date(at).toISOString() }]);
  }, []);

  const submit = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      clearTimers();
      setRules(parseRequest(text, events, Date.now()));
      setLog([]);
      setSpentUsd(0);
      setProposal(null);
      setPhase("review");
    },
    [events, clearTimers],
  );

  /** Lock the budget and start the (simulated) scan. */
  const approveRules = useCallback(() => {
    if (!rules?.event || rules.maxPriceUsd === null || rules.budgetUsd === null) return;
    const { event, quantity, maxPriceUsd, budgetUsd } = rules;
    const minRating = rules.minSellerRating ?? 0;
    setPhase("running");

    const steps: [number, () => void][] = [
      [400, () => push("lock", `Locked $${budgetUsd} in your SeatSafe budget vault.`)],
      [1600, () => push("seen", `Seen 14 listings for ${event.title}.`)],
      [2800, () => minRating > 0 && push("skip", `Skipped 3 listings from sellers under ${minRating}★.`)],
      [4000, () => push("skip", `Skipped 9 listings over $${maxPriceUsd} each.`)],
      [
        5200,
        () => {
          if (event.priceFromUsd > maxPriceUsd) {
            push("waiting", `Nothing under $${maxPriceUsd} yet. Still watching.`);
            return;
          }
          const priceUsd = event.priceFromUsd;
          push("found", `Found ${quantity} at $${priceUsd} each (Sec 112, seller 4.8★). Asking you to approve.`);
          setProposal({ quantity, priceUsd, totalUsd: priceUsd * quantity, section: "Sec 112", sellerRating: 4.8 });
          setPhase("awaiting");
        },
      ],
    ];
    timers.current = steps.map(([ms, fn]) => setTimeout(fn, ms));
  }, [rules, push]);

  const approveFill = useCallback(() => {
    if (!proposal || !rules?.budgetUsd) return;
    setSpentUsd(proposal.totalUsd);
    push(
      "filled",
      `Filled ${proposal.quantity} at $${proposal.priceUsd}. $${rules.budgetUsd - proposal.totalUsd} stays in the vault until the order closes.`,
    );
    setProposal(null);
    setPhase("filled");
  }, [proposal, rules, push]);

  const declineFill = useCallback(() => {
    push("declined", "You declined that match. Still watching for a better one.");
    setProposal(null);
    setPhase("running");
  }, [push]);

  const reset = useCallback(() => {
    clearTimers();
    setRules(null);
    setLog([]);
    setSpentUsd(0);
    setProposal(null);
    setPhase("idle");
  }, [clearTimers]);

  return {
    eventsLoading: loading,
    phase,
    rules,
    log,
    spentUsd,
    proposal,
    submit,
    approveRules,
    approveFill,
    declineFill,
    reset,
  };
}
