"use client";

// Owner: A. Real escrow actions for /orders/[id] (id = escrow PDA), shown under D's tracker.
//
// TODO(D): OrderTracker doesn't take callbacks yet. When you redesign it, call useOrderActions(id)
// and wire onConfirm / onDispute / claimRefund / releasePayment / markSent into your buttons;
// then this panel can go. It only renders in real mode (NEXT_PUBLIC_USE_MOCK=false); in mock mode
// your simulate buttons drive the tracker as before.

import { useState } from "react";
import { useParams } from "next/navigation";
import { CheckCircle2, Clock, Loader2, RotateCcw, Send, ShieldAlert, Wallet } from "lucide-react";
import { PublicKey } from "@solana/web3.js";
import { getEscrow, USE_MOCK, type ChainEscrow } from "@/lib/chain";
import { confirmReceipt, markSent, openDispute, refundExpired, releaseExpired } from "@/lib/program";
import { useRunTx } from "@/lib/tx";
import { useAsyncData, useNow } from "@/lib/use-chain";
import { formatCountdown, formatUsd } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

type ActionName = "confirm" | "dispute" | "refund" | "release" | "markSent";

/** Escrow state from devnet (polled) plus the five actions. For D to use in the tracker. */
export function useOrderActions(escrowId: string) {
  const { run, wallet } = useRunTx();
  const escrow = useAsyncData(USE_MOCK ? null : `escrow:${escrowId}`, () => getEscrow(escrowId), { pollMs: 5_000 });
  const [busy, setBusy] = useState<ActionName | null>(null);
  const key = () => new PublicKey(escrowId);

  const act = async (name: ActionName, fn: Parameters<typeof run>[0], pending: string, success: string, action?: "refund" | "release" | "markSent" | "dispute") => {
    setBusy(name);
    const sent = await run(fn, { pending, success, errorContext: { action } });
    setBusy(null);
    if (sent) await escrow.refresh();
    return sent;
  };

  return {
    escrow: escrow.data ?? null,
    loading: escrow.loading,
    busy,
    me: wallet?.address.toBase58() ?? null,
    onConfirm: () => act("confirm", (ctx) => confirmReceipt(ctx, { escrow: key() }), "Releasing payment…", "Confirmed. Payment released to the seller."),
    onDispute: () => act("dispute", (ctx) => openDispute(ctx, { escrow: key() }), "Opening a dispute…", "Dispute opened. Funds stay locked.", "dispute"),
    claimRefund: () => act("refund", (ctx) => refundExpired(ctx, { escrow: key() }), "Claiming your refund…", "Refunded: price and seller bond are back in your wallet.", "refund"),
    releasePayment: () => act("release", (ctx) => releaseExpired(ctx, { escrow: key() }), "Releasing payment…", "Payment released to the seller.", "release"),
    markSent: () => act("markSent", (ctx) => markSent(ctx, { escrow: key() }), "Marking as sent…", "Marked as sent.", "markSent"),
  };
}

const STATE_TEXT: Record<ChainEscrow["state"], string> = {
  LISTED: "Listed, waiting for a buyer",
  CANCELLED: "Cancelled by the seller",
  HELD: "Payment locked in the vault. Waiting for the seller to send the ticket.",
  IN_TRANSIT: "Seller sent the ticket. Buyer: check it and confirm.",
  CONFIRMED: "Confirmed. Payment released to the seller.",
  RELEASED: "Payment released to the seller.",
  REFUNDED: "Refunded: the buyer got the price and the seller's bond.",
  DISPUTED: "Disputed. Funds stay locked until the arbiter decides.",
  SWAPPED: "Swapped",
};

export function OrderActions() {
  const { id } = useParams<{ id: string }>();
  if (USE_MOCK) return null;
  return <OrderActionsPanel id={id} />;
}

function OrderActionsPanel({ id }: { id: string }) {
  const a = useOrderActions(id);
  const now = useNow();
  const e = a.escrow;

  if (a.loading && !e) {
    return <Card className="mt-6 h-28 animate-pulse p-4" />;
  }
  if (!e) return null;

  const isBuyer = a.me !== null && a.me === e.buyer;
  const isSeller = a.me !== null && a.me === e.seller;
  const ship = e.shipDeadline ? new Date(e.shipDeadline).getTime() : 0;
  const confirm = e.confirmDeadline ? new Date(e.confirmDeadline).getTime() : 0;
  const shipPassed = now > 0 && ship > 0 && now > ship;
  const confirmPassed = now > 0 && confirm > 0 && now > confirm;
  const deadline = e.state === "HELD" ? ship : e.state === "IN_TRANSIT" ? confirm : 0;

  return (
    <Card className="mt-6 gap-3 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold">Live on devnet</p>
        <p className="font-semibold tabular-nums">{formatUsd(e.priceUsd)}</p>
      </div>
      <p className="text-sm">{STATE_TEXT[e.state]}</p>
      {deadline > 0 && now > 0 && (
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground tabular-nums">
          <Clock className="size-4" />
          {e.state === "HELD" ? "Ship deadline" : "Confirm deadline"}: {formatCountdown(deadline - now)}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {e.state === "HELD" && shipPassed && (
          <Button onClick={a.claimRefund} disabled={a.busy !== null}>
            {a.busy === "refund" ? <Loader2 className="animate-spin" /> : <RotateCcw />} Claim refund
          </Button>
        )}
        {e.state === "IN_TRANSIT" && isBuyer && !confirmPassed && (
          <Button onClick={a.onConfirm} disabled={a.busy !== null}>
            {a.busy === "confirm" ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} Ticket works, release payment
          </Button>
        )}
        {e.state === "IN_TRANSIT" && confirmPassed && (
          <Button onClick={a.releasePayment} disabled={a.busy !== null}>
            {a.busy === "release" ? <Loader2 className="animate-spin" /> : <Wallet />} Release payment
          </Button>
        )}
        {((e.state === "HELD" && !shipPassed) || (e.state === "IN_TRANSIT" && !confirmPassed)) && (isBuyer || isSeller) && (
          <Button variant="outline" onClick={a.onDispute} disabled={a.busy !== null}>
            {a.busy === "dispute" ? <Loader2 className="animate-spin" /> : <ShieldAlert />} Report a problem
          </Button>
        )}
        {e.state === "HELD" && !shipPassed && isSeller && (
          <Button variant="outline" onClick={a.markSent} disabled={a.busy !== null}>
            {a.busy === "markSent" ? <Loader2 className="animate-spin" /> : <Send />} I sent the ticket
          </Button>
        )}
      </div>
    </Card>
  );
}
