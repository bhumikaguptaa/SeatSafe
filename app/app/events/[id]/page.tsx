// Owner: A. Event detail: primary sale, capped resale listings, outside tickets with escrow.
// The <Suspense> is required: `params` is request-time data under Cache Components.
// `?calendar=1` opens the Add to calendar menu on load (shareable link, e.g. from the Grok bot).
// id = event PDA in real mode (NEXT_PUBLIC_USE_MOCK=false), a mock id like "evt_neon_harbor" otherwise.
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { EventView } from "./EventView";

export default function EventPage({ params, searchParams }: PageProps<"/events/[id]">) {
  return (
    <Suspense fallback={<EventSkeleton />}>
      <EventFromParams params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function EventFromParams({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  return <EventView id={id} openCalendar={sp.calendar === "1"} />;
}

function EventSkeleton() {
  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 px-4 py-8">
      <Skeleton className="h-40 rounded-xl" />
      <Skeleton className="h-24 rounded-xl" />
    </div>
  );
}
