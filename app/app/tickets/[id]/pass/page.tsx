// Owner: D. Route wrapper for the gate pass; the UI lives in ./GatePass.tsx.
// The <Suspense> is required: the ticket id is only known at request time (Cache Components).
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { GatePass } from "./GatePass";

export default function TicketPassPage() {
  return (
    <section className="relative isolate flex-1">
      {/* Stronger version of PageShell's glow; the pass has no page header. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[32rem] bg-[radial-gradient(70%_100%_at_50%_0%,color-mix(in_oklch,var(--primary)_40%,transparent),transparent)]"
      />
      <div className="px-4 py-6">
        <Suspense fallback={<Skeleton className="mx-auto h-[36rem] w-full max-w-sm rounded-3xl" />}>
          <GatePass />
        </Suspense>
      </div>
    </section>
  );
}
