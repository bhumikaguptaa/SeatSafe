"use client";

// Owner: D. Basic version for the skeleton; D will redesign.
// Data comes ONLY from useEvents() (mock today, Supabase later).

import Link from "next/link";
import { useEvents } from "@/lib/hooks";
import { formatDate, formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PagePlaceholder } from "@/components/PagePlaceholder";

export default function DiscoverPage() {
  const { events, loading } = useEvents();

  return (
    <PagePlaceholder
      title="Discover"
      description="Browse upcoming concerts, games and campus events with fair-price resale."
      owner="D"
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {loading
          ? Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-64 rounded-xl" />
            ))
          : events.map((event) => (
              <Link key={event.id} href={`/events/${event.id}`} className="group">
                <Card className="gap-0 overflow-hidden p-0 transition-transform group-hover:-translate-y-0.5">
                  <div className={cn("relative h-36", event.imageGradient)}>
                    <Badge className="absolute top-3 left-3 bg-black/50 text-white capitalize">
                      {event.category}
                    </Badge>
                  </div>
                  <div className="space-y-1 p-4">
                    <h2 className="leading-tight font-semibold">{event.title}</h2>
                    <p className="text-sm text-muted-foreground">
                      {formatDate(event.startsAt)} · {event.venue}, {event.city}
                    </p>
                    <p className="pt-1 text-sm">
                      From <span className="font-semibold">{formatUsd(event.priceFromUsd)}</span>
                    </p>
                  </div>
                </Card>
              </Link>
            ))}
      </div>
    </PagePlaceholder>
  );
}
