// Owner: D. Route wrapper for the gate pass; the UI lives in ./GatePass.tsx.
// The <Suspense> is required: the ticket id is only known at request time (Cache Components).
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { GatePass } from "./GatePass";

export default function TicketPassPage() {
  return (
    // No page header: the ticket is the whole screen. Colours and glow come from the global theme.
    <section className="flex-1 px-5 py-6">
      <Suspense fallback={<Skeleton className="mx-auto h-[36rem] w-full max-w-sm rounded-3xl" />}>
        <GatePass />
      </Suspense>
    </section>
  );
}
