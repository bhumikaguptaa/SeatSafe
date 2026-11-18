// Owner: D. Route wrapper for the escrow tracker; the UI lives in ./OrderTracker.tsx.
// The <Suspense> is required: the order id is only known at request time (Cache Components).
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { PageShell } from "@/components/PageShell";
import { OrderTracker } from "./OrderTracker";
import { OrderChat } from "@/components/OrderChat";
import { OrderVault } from "@/components/OrderVault"; // added by A: live escrow vault (real chain data)

export default function OrderPage() {
  return (
    <PageShell
      title="Your order"
      description="Where your money and your ticket are, at every moment."
      width="narrow"
    >
      <Suspense fallback={<Skeleton className="h-72 rounded-2xl" />}>
        {/* Real devnet actions (A's useOrderActions) are wired into the tracker's buttons. */}
        <OrderVault /> {/* added by A: live vault + Got my ticket / Claim refund */}
        <OrderTracker />
        <OrderChat />
      </Suspense>
    </PageShell>
  );
}
