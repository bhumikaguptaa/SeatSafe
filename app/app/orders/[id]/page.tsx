// Owner: D. Route wrapper for the escrow tracker; the UI lives in ./OrderTracker.tsx.
// The <Suspense> is required: the order id is only known at request time (Cache Components).
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { PageShell } from "@/components/PageShell";
import { OrderTracker } from "./OrderTracker";
import { OrderActions } from "@/components/OrderActions";

export default function OrderPage() {
  return (
    <PageShell
      title="Your order"
      description="Where your money and your ticket are, at every moment."
      width="narrow"
    >
      <Suspense fallback={<Skeleton className="h-72 rounded-2xl" />}>
        <OrderTracker />
        {/* Added by A: real devnet actions (confirm, dispute, claim refund, release). Renders only when
            NEXT_PUBLIC_USE_MOCK=false. TODO(D): wire useOrderActions(id) into OrderTracker, then drop this. */}
        <OrderActions />
      </Suspense>
    </PageShell>
  );
}
