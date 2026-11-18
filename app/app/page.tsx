"use client";

// Owner: D. Discover: featured event, category chips, and an "Upcoming" list of event rows.
// Data comes ONLY from useEvents() (mock today, Supabase later).
// Colours come from the global theme; event art is <EventArt> (palette shades + category icon).
// The featured card is one of the three places that use the branding gradient.

import { useState } from "react";
import Link from "next/link";
import { ChevronRight, ShieldCheck } from "lucide-react";
import { useEvents } from "@/lib/hooks";
import { formatDate, formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Event } from "@/lib/types";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EventArt } from "@/components/EventArt";
import { PageShell } from "@/components/PageShell";

type Filter = "all" | Event["category"];

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "concert", label: "Concerts" },
  { id: "sports", label: "Sports" },
  { id: "campus", label: "Campus" },
];

function FeaturedEvent({ event }: { event: Event }) {
  return (
    <Link href={`/events/${event.id}`} className="group relative block overflow-hidden rounded-3xl border border-border">
      <EventArt event={event} featured className="h-64 sm:h-72" />

      <div className="absolute top-4 left-4 flex gap-2">
        <span className="rounded-full bg-black/40 px-2.5 py-1 text-xs font-semibold text-white capitalize">
          Featured · {event.category}
        </span>
        <span className="inline-flex items-center gap-1 rounded-full bg-black/40 px-2.5 py-1 text-xs font-semibold text-white">
          <ShieldCheck className="size-3.5" />
          Protected
        </span>
      </div>

      <div className="absolute inset-x-0 bottom-0 p-5 sm:p-6">
        <h2 className="text-[22px] leading-tight font-bold tracking-tight text-white sm:text-[26px]">{event.title}</h2>
        <p className="mt-1 text-sm text-white/75">
          {formatDate(event.startsAt)} · {event.venue}
        </p>
        <div className="mt-3 flex items-end justify-between gap-4">
          <div>
            <p className="text-xs text-white/70">From</p>
            <p className="text-[34px] leading-none font-bold tracking-tight text-white tabular-nums">
              {formatUsd(event.priceFromUsd)}
            </p>
          </div>
          <span
            className={cn(buttonVariants(), "h-11 shrink-0 rounded-2xl px-5 text-[15px] font-semibold ring-1 ring-white/40")}
          >
            Get tickets
          </span>
        </div>
      </div>
    </Link>
  );
}

function EventRow({ event }: { event: Event }) {
  return (
    <Link
      href={`/events/${event.id}`}
      className="group flex items-center gap-4 rounded-2xl py-3.5 transition-colors hover:bg-muted/40"
    >
      <EventArt event={event} size="tile" className="size-14 shrink-0 rounded-2xl" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-base leading-snug font-semibold">{event.title}</p>
        <p className="truncate text-sm text-muted-foreground">
          {formatDate(event.startsAt)} · {event.venue}
        </p>
        <p className="mt-0.5 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
          <ShieldCheck className="size-3.5" />
          Protected
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-xs text-muted-foreground">From</p>
        <p className="text-base font-bold tabular-nums">{formatUsd(event.priceFromUsd)}</p>
      </div>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

export default function DiscoverPage() {
  const { events, loading } = useEvents();
  const [filter, setFilter] = useState<Filter>("all");

  const shown = filter === "all" ? events : events.filter((e) => e.category === filter);
  const [featured, ...rest] = shown;

  return (
    <PageShell title="Discover" description="Concerts, games and campus events. Every purchase is payment-protected.">
      <div className="space-y-5">
        <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Filter by category">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={cn(
                "h-9 shrink-0 rounded-full px-4 text-sm font-semibold transition-colors",
                filter === f.id
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:text-foreground",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        {loading ? (
          <>
            <Skeleton className="h-64 rounded-3xl sm:h-72" />
            <Skeleton className="h-80 rounded-2xl" />
          </>
        ) : !featured ? (
          <p className="rounded-2xl border border-border bg-card p-5 text-[15px] text-muted-foreground">
            No {FILTERS.find((f) => f.id === filter)?.label.toLowerCase()} events right now.
          </p>
        ) : (
          <>
            <FeaturedEvent event={featured} />
            {rest.length > 0 && (
              <section className="rounded-2xl border border-border bg-card px-5 pt-5 pb-2">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-bold">Upcoming</h2>
                  <span className="text-sm text-muted-foreground">
                    {rest.length} {rest.length === 1 ? "event" : "events"}
                  </span>
                </div>
                <div className="mt-1 grid divide-y divide-border lg:grid-cols-2 lg:gap-x-10 lg:divide-y-0">
                  {rest.map((event) => (
                    <EventRow key={event.id} event={event} />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </PageShell>
  );
}
