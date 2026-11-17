"use client";

// Owner: D. Discover: featured hero for the first event, category chips, event card grid.
// Data comes ONLY from useEvents() (mock today, Supabase later).
// Filled blue is reserved for the one primary action (the hero's "Get tickets").

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { useEvents } from "@/lib/hooks";
import { formatDate, formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Event } from "@/lib/types";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PageShell } from "@/components/PageShell";

type Filter = "all" | Event["category"];

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "concert", label: "Concerts" },
  { id: "sports", label: "Sports" },
  { id: "campus", label: "Campus" },
];

/** Glassy pill that sits on top of the gradient art. */
function GlassBadge({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-white/20 bg-black/35 px-2.5 py-0.5 text-xs font-medium text-white capitalize backdrop-blur-md">
      {children}
    </span>
  );
}

function ProtectedBadge() {
  return (
    <GlassBadge>
      <ShieldCheck className="size-3.5" />
      Protected
    </GlassBadge>
  );
}

/** Gradient art with a soft diagonal sheen, like the glass cards in the inspo. */
function EventArt({ event, className }: { event: Event; className?: string }) {
  return (
    <div className={cn("relative overflow-hidden", event.imageGradient, className)}>
      <div className="absolute inset-0 bg-linear-to-br from-white/25 via-white/0 to-transparent" />
      <div className="absolute -top-1/2 -right-1/4 size-[120%] rounded-full bg-white/10 blur-3xl" />
    </div>
  );
}

function FeaturedEvent({ event }: { event: Event }) {
  return (
    <Link
      href={`/events/${event.id}`}
      className="group relative block overflow-hidden rounded-3xl border border-border"
    >
      <EventArt event={event} className="h-80 transition-transform duration-500 group-hover:scale-[1.02] sm:h-96" />
      <div className="absolute inset-0 bg-linear-to-t from-black/85 via-black/30 to-transparent" />

      <div className="absolute top-4 left-4 flex gap-2">
        <GlassBadge>Featured · {event.category}</GlassBadge>
        <ProtectedBadge />
      </div>

      <div className="absolute inset-x-0 bottom-0 flex flex-col gap-4 p-5 sm:flex-row sm:items-end sm:justify-between sm:p-7">
        <div className="min-w-0">
          <h2 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">{event.title}</h2>
          <p className="mt-1 text-sm text-white/70">
            {formatDate(event.startsAt)} · {event.venue}, {event.city}
          </p>
          {event.resaleCapUsd !== null && (
            <p className="mt-1 text-xs text-white/60">Resale capped at {formatUsd(event.resaleCapUsd)}</p>
          )}
        </div>
        <div className="flex items-end justify-between gap-4 sm:flex-col sm:items-end">
          <div className="sm:text-right">
            <p className="text-xs text-white/60">From</p>
            <p className="text-4xl font-bold tracking-tight text-white tabular-nums">
              {formatUsd(event.priceFromUsd)}
            </p>
          </div>
          <span className={cn(buttonVariants({ size: "lg" }), "h-11 rounded-xl px-5")}>Get tickets</span>
        </div>
      </div>
    </Link>
  );
}

function EventCard({ event }: { event: Event }) {
  return (
    <Link
      href={`/events/${event.id}`}
      className="group flex flex-col overflow-hidden rounded-2xl border border-border bg-card transition-all hover:-translate-y-0.5 hover:border-foreground/20"
    >
      <div className="relative">
        <EventArt event={event} className="h-36" />
        <div className="absolute top-3 left-3 flex gap-2">
          <GlassBadge>{event.category}</GlassBadge>
          <ProtectedBadge />
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-1 p-4">
        <h3 className="leading-tight font-semibold">{event.title}</h3>
        <p className="text-sm text-muted-foreground">
          {formatDate(event.startsAt)} · {event.venue}, {event.city}
        </p>
        <p className="mt-auto flex items-baseline gap-1.5 pt-3">
          <span className="text-sm text-muted-foreground">From</span>
          <span className="text-2xl font-bold tracking-tight tabular-nums">{formatUsd(event.priceFromUsd)}</span>
        </p>
      </div>
    </Link>
  );
}

export default function DiscoverPage() {
  const { events, loading } = useEvents();
  const [filter, setFilter] = useState<Filter>("all");

  const shown = filter === "all" ? events : events.filter((e) => e.category === filter);
  const [featured, ...rest] = shown;

  return (
    <PageShell
      title="Discover"
      description="Concerts, games and campus events. Every purchase is payment-protected."
    >
      <div className="space-y-6">
        <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Filter by category">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={cn(
                "shrink-0 rounded-full border px-4 py-1.5 text-sm font-medium transition-colors",
                filter === f.id
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        {loading ? (
          <>
            <Skeleton className="h-80 rounded-3xl sm:h-96" />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-64 rounded-2xl" />
              ))}
            </div>
          </>
        ) : !featured ? (
          <p className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
            No {FILTERS.find((f) => f.id === filter)?.label.toLowerCase()} events right now.
          </p>
        ) : (
          <>
            <FeaturedEvent event={featured} />
            {rest.length > 0 && (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {rest.map((event) => (
                  <EventCard key={event.id} event={event} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </PageShell>
  );
}
