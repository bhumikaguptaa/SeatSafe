"use client";

// Owner: D. Real-mode (devnet) side of the agent console: lock a budget with openStandingOrder,
// list my standing orders with getMyStandingOrders, and Close & refund with closeStandingOrder.
// Only loads anything when USE_MOCK is false; in mock mode it stays idle and the console uses
// useAgentDemo's simulation instead.
// Note: like A's pages, this reads lib/chain + lib/program directly, because lib/hooks.ts has no
// standing-order hook yet (TODO(B): useStandingOrders()).

import { useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { toast } from "sonner";
import { getMyStandingOrders, USE_MOCK } from "@/lib/chain";
import { closeStandingOrder, openStandingOrder } from "@/lib/program";
import { useRunTx } from "@/lib/tx";
import { useAsyncData } from "@/lib/use-chain";
import { formatUsd } from "@/lib/format";
import type { ParsedRules } from "./useAgentDemo";

export function useAgentChain() {
  const { run, wallet } = useRunTx();
  const me = wallet?.address.toBase58() ?? null;
  const orders = useAsyncData(
    !USE_MOCK && me ? `agent:standing:${me}` : null,
    () => getMyStandingOrders(me!),
    { pollMs: 10_000 },
  );
  /** "open" while locking a budget, or the standing order id being closed. */
  const [busy, setBusy] = useState<string | null>(null);

  /** Lock max price × quantity in a new standing order. Resolves true when the tx landed. */
  async function open(rules: ParsedRules): Promise<boolean> {
    const event = rules.event;
    if (!event || rules.maxPriceUsd === null || rules.budgetUsd === null) return false;
    // The program takes a duration, not a date. No deadline given = until the event starts.
    const until = new Date(rules.deadline ?? event.startsAt).getTime();
    const deadlineSecs = Math.floor((until - Date.now()) / 1000);
    if (deadlineSecs <= 0) {
      toast.error("That deadline has already passed. Pick a later one.");
      return false;
    }
    const maxPriceUsd = rules.maxPriceUsd;
    setBusy("open");
    const sent = await run(
      (ctx) =>
        openStandingOrder(ctx, {
          event: new PublicKey(event.id),
          maxPriceUsd,
          quantity: rules.quantity,
          deadlineSecs,
        }),
      {
        pending: `Locking ${formatUsd(rules.budgetUsd)} in your budget vault…`,
        success: "Budget locked. Your standing order is open.",
      },
    );
    setBusy(null);
    if (sent) await orders.refresh();
    return sent !== null;
  }

  /** Close a standing order and send whatever budget is left back to my wallet. */
  async function close(standingOrderId: string): Promise<void> {
    setBusy(standingOrderId);
    const sent = await run((ctx) => closeStandingOrder(ctx, { standingOrder: new PublicKey(standingOrderId) }), {
      pending: "Closing and refunding your budget…",
      success: "Closed. Your unused budget is back in your wallet.",
    });
    setBusy(null);
    if (sent) await orders.refresh();
  }

  return {
    me,
    orders: orders.data ?? [],
    ordersLoading: orders.loading,
    busy,
    open,
    close,
  };
}
