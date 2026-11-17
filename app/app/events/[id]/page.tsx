// Owner: A. Event detail: primary sale, capped resale listings, outside tickets with escrow.
// The <Suspense> is required: `params` is request-time data under Cache Components.
// id = event PDA in real mode (NEXT_PUBLIC_USE_MOCK=false), a mock id like "evt_neon_harbor" otherwise.
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { EventView } from "./EventView";

export default function EventPage({ params }: PageProps<"/events/[id]">) {
  return (
    <Suspense fallback={<EventSkeleton />}>
      <EventFromParams params={params} />
    </Suspense>
  );
}

async function EventFromParams({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EventView id={id} />;
}

function EventSkeleton() {
  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 px-4 py-8">
      <Skeleton className="h-40 rounded-xl" />
      <Skeleton className="h-24 rounded-xl" />
    </div>
  );
}
