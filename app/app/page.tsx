"use client";

// Owner: D. Discover: featured event, category chips, and an "Upcoming" list of event rows.
// Data comes from useEvents() (mock or devnet + event-meta). Polish pass (A, approved override):
// - Featured hero with real art (public/events/, original renders), a dark overlay on the left for the text,
//   the venue city, and "Resale capped at $X" / "Artist earns Y% on resales" chips.
// - "See it live on Solana →" (Live Lab) next to the page intro.
// - Skeletons that match the final layout (hero, ticker, rows) with reserved heights: no layout shift.
// - Category chips show counts and hide when empty; rows get a thumbnail and a "Resale from $X" chip.
// - The animated wireframe background lives here only (40% opacity), not behind content-heavy pages.

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, ChevronRight, MapPin, ShieldCheck } from "lucide-react";
import { useEvents } from "@/lib/hooks";
import { USE_MOCK, getListingsForEvent } from "@/lib/chain";
import { getListingsForEvent as getMockListings } from "@/lib/mock";
import { useAsyncData } from "@/lib/use-chain";
import { formatDate, formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Event } from "@/lib/types";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EventArt } from "@/components/EventArt";
import { WaveBackground } from "@/components/WaveBackground";
import { FirstVisitIntro } from "@/components/FirstVisitIntro";
// Added by A: live protection ticker (QuickNode-fed stats). Self-contained; remove this import + the one line below to drop it.
import { ProtectionTicker } from "@/components/ProtectionTicker";

type Filter = "all" | Event["category"];

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "concert", label: "Concerts" },
  { id: "sports", label: "Sports" },
  { id: "campus", label: "Campus" },
];

/** Cheapest open resale (Tier 1) listing per event, or nothing. */
function useResaleFrom(events: Event[]): Record<string, number> {
  const ids = events.map((e) => e.id).join(",");
  const { data } = useAsyncData(ids ? `resale-from:${ids}` : null, async () => {
    const out: Record<string, number> = {};
    await Promise.all(
      events.map(async (e) => {
        const ls = USE_MOCK ? getMockListings(e.id) : await getListingsForEvent(e.id).catch(() => []);
        const prices = ls.filter((l) => l.tier === 1).map((l) => l.priceUsd);
        if (prices.length) out[e.id] = Math.min(...prices);
      }),
    );
    return out;
  });
  return data ?? {};
}

function Chip({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold", className)}>{children}</span>;
}

function FeaturedEvent({ event }: { event: Event }) {
  return (
    <Link href={`/events/${event.id}`} className="group block rounded-3xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
      <article className="relative isolate h-72 overflow-hidden rounded-3xl border border-[#26262E] bg-[#15151B] sm:h-80">
        <EventArt event={event} priority className="absolute inset-0 -z-10 transition-transform duration-700 group-hover:scale-[1.02]" />
        {/* Dark overlay on the left (and bottom on phones) so the text stays readable. */}
        <div className="absolute inset-0 -z-10 bg-gradient-to-r from-[#0B0B0F] via-[#0B0B0F]/85 to-transparent max-sm:bg-gradient-to-t max-sm:via-[#0B0B0F]/80" />
        <div className="absolute top-4 left-4 flex flex-wrap gap-2 pr-4">
          <Chip className="bg-white text-black capitalize">Featured · {event.category}</Chip>
          {event.resaleCapUsd != null && (
            <Chip className="bg-[#0B0B0F]/90 text-white ring-1 ring-[#26262E]">
              <ShieldCheck className="size-3.5 text-released" aria-hidden /> Resale capped at {formatUsd(event.resaleCapUsd)}
            </Chip>
          )}
          {event.royaltyBps > 0 && (
            <Chip className="bg-[#0B0B0F]/90 text-white ring-1 ring-[#26262E]">Artist earns {event.royaltyBps / 100}% on resales</Chip>
          )}
        </div>

        <div className="absolute inset-x-0 bottom-0 max-w-xl p-5 sm:p-6">
          <h2 className="text-[24px] leading-tight font-bold tracking-tight text-white sm:text-[30px]">{event.title}</h2>
          <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-sm text-[#D4D4D8]">
            <span>{formatDate(event.startsAt)}</span>
            <span aria-hidden>·</span>
            <span className="inline-flex items-center gap-1">
              <MapPin className="size-3.5" aria-hidden />
              {event.venue}
              {event.city ? `, ${event.city}` : ""}
            </span>
          </p>
          <div className="mt-4 flex items-end gap-5">
            <div>
              <p className="text-xs text-[#A1A1AA]">From</p>
              <p className="text-[34px] leading-none font-bold tracking-tight text-white tabular-nums">{formatUsd(event.priceFromUsd)}</p>
            </div>
            <span className={cn(buttonVariants(), "h-11 shrink-0 rounded-2xl px-5 text-[15px] font-semibold")}>Get tickets</span>
          </div>
        </div>
      </article>
    </Link>
  );
}

function EventRow({ event, resaleFrom }: { event: Event; resaleFrom?: number }) {
  return (
    <Link
      href={`/events/${event.id}`}
      className="group flex min-w-0 items-center gap-4 rounded-2xl py-3.5 transition-colors hover:bg-white/[0.03] focus-visible:outline-2 focus-visible:outline-primary"
    >
      <EventArt event={event} size="tile" className="size-14 shrink-0 rounded-2xl" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-base leading-snug font-semibold">{event.title}</p>
        <p className="truncate text-sm text-[#A1A1AA]">
          {formatDate(event.startsAt)} · {event.venue}
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs font-medium text-[#A1A1AA]">
          <span className="inline-flex items-center gap-1">
            <ShieldCheck className="size-3.5 text-released" aria-hidden /> Protected
          </span>
          {resaleFrom != null && (
            <span className="rounded-full bg-released/15 px-2 py-0.5 font-semibold text-released tabular-nums">Resale from {formatUsd(resaleFrom)}</span>
          )}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-xs text-[#A1A1AA]">From</p>
        <p className="text-base font-bold tabular-nums">{formatUsd(event.priceFromUsd)}</p>
      </div>
      <ChevronRight className="size-4 shrink-0 text-[#A1A1AA] transition-transform group-hover:translate-x-0.5" aria-hidden />
    </Link>
  );
}

/** Same boxes as the loaded page, so nothing jumps when data arrives. */
function DiscoverSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading events" className="space-y-5">
      <div className="flex gap-2">
        {[52, 92, 76, 80].map((w) => (
          <Skeleton key={w} className="h-9 rounded-full" style={{ width: w }} />
        ))}
      </div>
      <Skeleton className="h-72 rounded-3xl sm:h-80" />
      <div className="rounded-2xl border border-[#26262E] bg-[#15151B] px-5 pt-5 pb-2">
        <Skeleton className="h-6 w-28" />
        <div className="mt-1 grid grid-cols-1 lg:grid-cols-2 lg:gap-x-10">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="flex items-center gap-4 py-3.5">
              <Skeleton className="size-14 shrink-0 rounded-2xl" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
                <Skeleton className="h-3 w-1/4" />
              </div>
              <Skeleton className="h-9 w-12" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function DiscoverPage() {
  const { events, loading } = useEvents();
  const [filter, setFilter] = useState<Filter>("all");
  const resaleFrom = useResaleFrom(events);

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: events.length, concert: 0, sports: 0, campus: 0 };
    for (const e of events) c[e.category] += 1;
    return c;
  }, [events]);
  const filters = FILTERS.filter((f) => f.id === "all" || counts[f.id] > 0);
  const active = counts[filter] > 0 ? filter : "all";
  const shown = active === "all" ? events : events.filter((e) => e.category === active);
  const [featured, ...rest] = shown;

  return (
    <section className="flex-1">
      <WaveBackground />
      <FirstVisitIntro />
      <div className="mx-auto w-full max-w-6xl px-5 pt-8 pb-10">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-[26px] leading-tight font-bold tracking-tight">Discover</h1>
            <p className="mt-1 text-[15px] text-[#A1A1AA]">Concerts, games and campus events. Every purchase is payment-protected.</p>
          </div>
          <Link href="/simulator" className={cn(buttonVariants({ variant: "outline" }), "h-10 rounded-xl border-[#26262E] bg-[#15151B] px-4")}>
            See it live on Solana <ArrowRight aria-hidden />
          </Link>
        </div>
        <div className="mt-6">
          <ProtectionTicker /> {/* Added by A */}
          {loading ? (
            <DiscoverSkeleton />
          ) : (
            <div className="space-y-5">
              <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by category">
                {filters.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    aria-pressed={active === f.id}
                    onClick={() => setFilter(f.id)}
                    className={cn(
                      "h-9 shrink-0 rounded-full px-4 text-sm font-semibold transition-colors",
                      active === f.id ? "bg-primary text-black" : "bg-[#15151B] text-[#A1A1AA] ring-1 ring-[#26262E] hover:text-white",
                    )}
                  >
                    {f.label} <span className="ml-0.5 tabular-nums opacity-70">{counts[f.id]}</span>
                  </button>
                ))}
              </div>

              {!featured ? (
                <div className="rounded-2xl border border-[#26262E] bg-[#15151B] p-6 text-center">
                  <p className="font-semibold">No events yet</p>
                  <p className="mt-1 text-sm text-[#A1A1AA]">Artists can create one in a minute.</p>
                  <Link href="/creator" className={cn(buttonVariants({ size: "sm" }), "mt-3")}>Create an event</Link>
                </div>
              ) : (
                <>
                  <FeaturedEvent event={featured} />
                  {rest.length > 0 && (
                    <section className="rounded-2xl border border-[#26262E] bg-[#15151B] px-5 pt-5 pb-2">
                      <div className="flex items-center justify-between">
                        <h2 className="text-lg font-bold">Upcoming</h2>
                        <span className="text-sm text-[#A1A1AA] tabular-nums">
                          {rest.length} {rest.length === 1 ? "event" : "events"}
                        </span>
                      </div>
                      <div className="mt-1 grid grid-cols-1 divide-y divide-[#26262E] lg:grid-cols-2 lg:gap-x-10 lg:divide-y-0">
                        {rest.map((event) => (
                          <EventRow key={event.id} event={event} resaleFrom={resaleFrom[event.id]} />
                        ))}
                      </div>
                    </section>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
