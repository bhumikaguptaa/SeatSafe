"use client";

// Owner: D. The live escrow tracker UI. Build it ONLY from useOrder(id).
// Use the simulate buttons to walk through every state.

import { useParams } from "next/navigation";
import { useOrder } from "@/lib/hooks";
import { formatDate, formatUsd } from "@/lib/format";
import type { OrderState } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

const STATES: OrderState[] = [
  "HELD",
  "IN_TRANSIT",
  "CONFIRMED",
  "RELEASED",
  "REFUNDED",
  "DISPUTED",
  "SWAPPED",
];

export function OrderTracker() {
  const { id } = useParams<{ id: string }>();
  const { order, state, amount, deadline, events, loading, simulate } = useOrder(id);

  return (
    <>
      {loading ? (
        <Skeleton className="h-40 rounded-xl" />
      ) : !order ? (
        <p className="text-sm text-muted-foreground">No order with id “{id}”.</p>
      ) : (
        <div className="space-y-6 text-sm">
          <dl className="grid gap-1">
            <div>
              <dt className="inline text-muted-foreground">State: </dt>
              <dd className="inline font-mono">{state}</dd>
            </div>
            <div>
              <dt className="inline text-muted-foreground">Amount: </dt>
              <dd className="inline">{formatUsd(amount)}</dd>
            </div>
            <div>
              <dt className="inline text-muted-foreground">Deadline: </dt>
              <dd className="inline">{deadline ? formatDate(deadline) : "None"}</dd>
            </div>
          </dl>

          <ol className="space-y-2">
            {events.map((e) => (
              <li key={e.id} className="rounded-lg border border-border p-3">
                <span className="font-mono text-xs text-muted-foreground">{e.type}</span>
                <p>{e.message}</p>
                <p className="text-xs text-muted-foreground">{formatDate(e.at)}</p>
              </li>
            ))}
          </ol>

          <div>
            <p className="mb-2 text-xs text-muted-foreground">Demo: simulate (mock mode only)</p>
            <div className="flex flex-wrap gap-2">
              {STATES.map((s) => (
                <Button key={s} size="sm" variant="outline" onClick={() => simulate(s)}>
                  {s}
                </Button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
