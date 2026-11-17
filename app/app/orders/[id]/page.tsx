// Owner: D. Route wrapper for the escrow tracker; the UI lives in ./OrderTracker.tsx.
// The <Suspense> is required: the order id is only known at request time (Cache Components).
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { PagePlaceholder } from "@/components/PagePlaceholder";
import { OrderTracker } from "./OrderTracker";
import { OrderActions } from "@/components/OrderActions";

export default function OrderPage() {
  return (
    <PagePlaceholder
      title="Order tracker"
      description="Live escrow tracker: where the money and the ticket are at every moment."
      owner="D"
    >
      <Suspense fallback={<Skeleton className="h-40 rounded-xl" />}>
        <OrderTracker />
        {/* Added by A: real devnet actions (confirm, dispute, claim refund, release). Renders only when
            NEXT_PUBLIC_USE_MOCK=false. TODO(D): wire useOrderActions(id) into OrderTracker, then drop this. */}
        <OrderActions />
      </Suspense>
    </PagePlaceholder>
  );
}
