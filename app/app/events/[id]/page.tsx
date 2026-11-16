// Owner: A. Event detail + listings + buy flow will go here.
// The <Suspense> is required: `params` is request-time data under Cache Components.
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getEvent } from "@/lib/mock";
import { formatDate, formatUsd } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { PagePlaceholder } from "@/components/PagePlaceholder";

export default function EventPage({ params }: PageProps<"/events/[id]">) {
  return (
    <Suspense
      fallback={
        <div className="mx-auto w-full max-w-6xl px-4 py-8">
          <Skeleton className="h-32 rounded-xl" />
        </div>
      }
    >
      <EventDetails params={params} />
    </Suspense>
  );
}

async function EventDetails({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const event = getEvent(id);
  if (!event) notFound();

  return (
    <PagePlaceholder
      title={event.title}
      description="Event details, resale listings and the buy flow will go here."
      owner="A"
    >
      <dl className="grid gap-1 text-sm">
        <div>
          <dt className="inline text-muted-foreground">When: </dt>
          <dd className="inline">{formatDate(event.startsAt)}</dd>
        </div>
        <div>
          <dt className="inline text-muted-foreground">Where: </dt>
          <dd className="inline">
            {event.venue}, {event.city}
          </dd>
        </div>
        <div>
          <dt className="inline text-muted-foreground">Price from: </dt>
          <dd className="inline">{formatUsd(event.priceFromUsd)}</dd>
        </div>
      </dl>
    </PagePlaceholder>
  );
}
