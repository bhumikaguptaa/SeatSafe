// Owner: C. Route wrapper for the escrow tracker; the UI lives in ./OrderTracker.tsx.
// The <Suspense> is required: the order id is only known at request time (Cache Components).
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { PagePlaceholder } from "@/components/PagePlaceholder";
import { OrderTracker } from "./OrderTracker";

export default function OrderPage() {
  return (
    <PagePlaceholder
      title="Order tracker"
      description="Live escrow tracker: where the money and the ticket are at every moment."
      owner="C"
    >
      <Suspense fallback={<Skeleton className="h-40 rounded-xl" />}>
        <OrderTracker />
      </Suspense>
    </PagePlaceholder>
  );
}
