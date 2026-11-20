"use client";

// Owner: A. Live "protection" ticker on Discover: what SeatSafe has protected, from onchain events the
// QuickNode Stream writes into Supabase (/api/stats, lib/server/stats.ts). Realtime: any insert into
// order_events or blocked_attempts refetches the stats (debounced 1 s); polls every 15 s when Realtime isn't
// connected. Mock mode shows fixed sample numbers. Counters count up; reduced-motion users see final values.

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ExternalLink, ShieldCheck } from "lucide-react";
import { USE_MOCK } from "@/lib/chain";
import { supabase } from "@/lib/supabase";
import { useNow } from "@/lib/use-chain";
import type { ActivityItem, Stats } from "@/lib/server/stats";
import { timeAgo } from "@/lib/format";
import { cleanFeed } from "@/lib/feed";

const MOCK_STATS: Stats = {
  source: "mock",
  protectedUsd: 1240,
  primaryUsd: 860,
  resaleUsd: 300,
  escrowUsd: 80,
  scamsRefunded: 3,
  refundedUsd: 66,
  fairResales: 12,
  fairShare: 1,
  scalpersBlocked: 2,
  updatedAt: "1970-01-01T00:00:00.000Z",
  recent: [
    { id: "m1", kind: "resale", text: "Ticket resold at a fair $14 · Battle of the Bands: Dorm Edition", at: "2026-11-18T19:40:00Z", explorerUrl: null },
    { id: "m2", kind: "refund", text: "Scam stopped: $22 auto-refunded · Battle of the Bands: Dorm Edition", at: "2026-11-18T19:30:00Z", explorerUrl: null },
    { id: "m3", kind: "blocked", text: "Scalper blocked: $50 over the $15 cap · Battle of the Bands: Dorm Edition", at: "2026-11-18T19:20:00Z", explorerUrl: null },
    { id: "m4", kind: "escrow", text: "$20 locked in a SeatSafe vault · Neon Harbor: Midnight Tides Tour", at: "2026-11-18T19:10:00Z", explorerUrl: null },
  ],
};

/** Counts from the previous value to `value` (400 ms, ease-out); shows the final value instantly with reduced motion. */
function useCountUp(value: number, reduced: boolean): number {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    if (reduced || from.current === value) {
      from.current = value;
      setShown(value);
      return;
    }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / 400);
      setShown(a + (value - a) * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, reduced]);
  return shown;
}

function Counter({ value, label, money = false, reduced }: { value: number; label: string; money?: boolean; reduced: boolean }) {
  const shown = useCountUp(value, reduced);
  // A zero stat reads as broken on a demo screen: show a quiet dash instead.
  const text = value === 0 ? "—" : money ? `$${Math.round(shown).toLocaleString("en-US")}` : Math.round(shown).toLocaleString("en-US");
  const final = value === 0 ? "none yet" : money ? `$${Math.round(value).toLocaleString("en-US")}` : value.toLocaleString("en-US");
  return (
    <div className="min-w-0">
      {/* Screen readers get the final value, not every animation frame. */}
      <p className="text-2xl font-bold tabular-nums tracking-tight md:text-3xl" aria-hidden>{text}</p>
      <p className="sr-only">{final} {label}</p>
      <p className="truncate text-xs text-white/70" aria-hidden>{label}</p>
    </div>
  );
}


export function ProtectionTicker() {
  const reduced = useReducedMotion() ?? false;
  const now = useNow();
  const [stats, setStats] = useState<Stats | null>(USE_MOCK ? MOCK_STATS : null);
  const [live, setLive] = useState(false);

  useEffect(() => {
    if (USE_MOCK) return;
    let alive = true;
    let debounce: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      const res = await fetch("/api/stats", { cache: "no-store" }).catch(() => null);
      const next = res?.ok ? ((await res.json()) as Stats) : null;
      if (alive && next) setStats(next);
    };
    const refetchSoon = () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => void load(), 1000);
    };
    void load();

    let subscribed = false;
    const channel = supabase
      ?.channel(`protection-ticker#${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "order_events" }, refetchSoon)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "blocked_attempts" }, refetchSoon)
      .subscribe((status) => {
        subscribed = status === "SUBSCRIBED";
        if (alive) setLive(subscribed);
      });
    // Fallback when Realtime isn't connected.
    const poll = setInterval(() => {
      if (!subscribed) void load();
    }, 15_000);

    return () => {
      alive = false;
      clearTimeout(debounce);
      clearInterval(poll);
      if (channel && supabase) void supabase.removeChannel(channel);
    };
  }, []);

  if (!stats) return <div className="mb-6 h-28 animate-pulse rounded-2xl bg-white/5" aria-hidden />;

  return (
    <section aria-label="SeatSafe protection, live" className="mb-6 overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-vault/25 via-white/[0.04] to-released/10 p-4 text-white md:p-5">
      <div className="mb-3 flex items-center justify-between gap-2 text-xs text-white/70">
        <span className="flex items-center gap-1.5 font-medium text-white">
          <span className="relative flex size-2">
            {!reduced && <span className="absolute inline-flex size-full animate-ping rounded-full bg-released opacity-75" />}
            <span className="relative inline-flex size-2 rounded-full bg-released" />
          </span>
          {USE_MOCK ? "Sample data" : live ? "Live" : "Updating"}
        </span>
        <span className="flex items-center gap-1 truncate">
          <ShieldCheck className="size-3.5 shrink-0" aria-hidden /> Powered by onchain events (QuickNode Streams)
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4" aria-live="polite">
        <Counter value={stats.protectedUsd} label="protected" money reduced={reduced} />
        <Counter value={stats.scamsRefunded} label="scams auto-refunded" reduced={reduced} />
        <Counter value={stats.fairResales} label="fair resales" reduced={reduced} />
        <Counter value={stats.scalpersBlocked} label="scalpers blocked" reduced={reduced} />
      </div>

      {stats.recent.length > 0 && (
        <ul className="no-scrollbar -mx-4 mt-4 flex snap-x gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:grid md:grid-cols-2 md:overflow-visible md:px-0" aria-label="Recent activity">
          <AnimatePresence initial={false}>
            {cleanFeed(stats.recent).map((item: ActivityItem) => (
              <motion.li
                key={item.id}
                layout={!reduced}
                initial={reduced ? false : { opacity: 0, y: -6, boxShadow: "0 0 0 1.5px #E5383B" }}
                animate={{ opacity: 1, y: 0, boxShadow: "0 0 0 0px rgba(229,56,59,0)" }}
                transition={{ duration: 0.4, ease: "easeOut", boxShadow: { duration: 1.6, ease: "easeOut" } }}
                className="flex min-w-[16rem] shrink-0 snap-start items-center gap-2 rounded-lg bg-secondary px-3 py-2 text-xs md:min-w-0"
              >
                <span className="min-w-0 flex-1 truncate" title={item.text}>{item.text}</span>
                <time dateTime={item.at} title={new Date(item.at).toLocaleString("en-US")} className="shrink-0 text-white/60 tabular-nums">{timeAgo(item.at, now)}</time>
                {item.explorerUrl && (
                  <a href={item.explorerUrl} target="_blank" rel="noopener noreferrer" className="shrink-0 text-white/70 hover:text-white" aria-label="View transaction on Solana Explorer">
                    <ExternalLink className="size-3.5" />
                  </a>
                )}
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
    </section>
  );
}
