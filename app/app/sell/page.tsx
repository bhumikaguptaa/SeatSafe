"use client";

// Owner: A. List an OUTSIDE ticket (Tier 2 escrow) and manage escrow sales. The seller bond defaults to 0
// (the program only requires price > 0 and both windows > 0); an optional bond sits under "Advanced".
// SeatSafe tickets (Tier 1) are resold from My tickets -> Resell.

import Link from "next/link";
import { useState } from "react";
import { Loader2, Send, ShieldCheck } from "lucide-react";
import { PublicKey } from "@solana/web3.js";
import { events as mockEvents } from "@/lib/mock";
import { getEvents, getMyEscrowSales, USE_MOCK, type ChainEscrow } from "@/lib/chain";
import { createEscrowListing, markSent } from "@/lib/program";
import { saveMeta } from "@/lib/event-meta";
import { mockTx, useRunTx, useTxWallet } from "@/lib/tx";
import { useAsyncData, useNow } from "@/lib/use-chain";
import { formatDate, formatUsd } from "@/lib/format";
import type { Event } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, Field, NativeSelect, Toggle } from "@/components/form";

const HOUR = 3600;
const DEMO_WINDOW = 60;

export default function SellPage() {
  const wallet = useTxWallet();
  const owner = wallet?.address.toBase58() ?? null;
  const events = useAsyncData("sell:events", async (): Promise<Event[]> => (USE_MOCK ? mockEvents : getEvents()));
  const sales = useAsyncData(
    USE_MOCK ? null : owner ? `sales:${owner}` : null,
    () => getMyEscrowSales(owner!),
    { pollMs: 10_000 },
  );

  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-6 md:py-8">
      <h1 className="text-2xl font-bold tracking-tight">Sell an outside ticket</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Got a ticket from another site? List it here. The buyer&apos;s payment waits in a SeatSafe vault until they
        confirm it works, and it comes back to them automatically if you don&apos;t deliver. Selling a SeatSafe ticket?{" "}
        <Link href="/tickets" className="underline">Resell it from My tickets</Link>.
      </p>

      <ListingForm events={events.data ?? []} loadingEvents={events.loading} onListed={sales.refresh} />

      <div className="mt-10">
        <h2 className="text-lg font-semibold">My escrow sales</h2>
        <div className="mt-3">
          {USE_MOCK ? (
            <EmptyState title="Escrow sales appear here with live data">
              Mock mode. Set NEXT_PUBLIC_USE_MOCK=false to use devnet.
            </EmptyState>
          ) : !owner ? (
            <EmptyState title="Log in to see your sales" />
          ) : sales.loading && !sales.data ? (
            <Skeleton className="h-20 rounded-xl" />
          ) : !sales.data?.length ? (
            <EmptyState title="No escrow sales yet">
              <a href="#sell-form" className="mt-1 inline-block font-semibold text-foreground underline underline-offset-4">List an outside ticket</a>
            </EmptyState>
          ) : (
            <ul className="space-y-2">
              {sales.data.map((s) => (
                <SaleRow key={s.id} sale={s} events={events.data ?? []} onDone={sales.refresh} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

function ListingForm({
  events,
  loadingEvents,
  onListed,
}: {
  events: Event[];
  loadingEvents: boolean;
  onListed: () => Promise<void>;
}) {
  const { run } = useRunTx();
  const [eventId, setEventId] = useState("");
  const [seat, setSeat] = useState("");
  const [price, setPrice] = useState("");
  const [bond, setBond] = useState("");
  const [shipHours, setShipHours] = useState("24");
  const [confirmHours, setConfirmHours] = useState("24");
  const [demo, setDemo] = useState(true);
  const [busy, setBusy] = useState(false);

  const selectedEvent = eventId || events[0]?.id || "";
  const p = Number(price);
  // Bond is optional: empty = 0 (the program accepts 0).
  const b = bond === "" ? 0 : Number(bond);
  const shipSecs = demo ? DEMO_WINDOW : Math.round(Number(shipHours) * HOUR);
  const confirmSecs = demo ? DEMO_WINDOW : Math.round(Number(confirmHours) * HOUR);
  const priceError = price !== "" && !(p > 0) ? "Enter a price above $0." : null;
  const bondError = bond !== "" && !(b >= 0) ? "Bond can't be negative." : null;
  const valid = selectedEvent && seat.trim() && p > 0 && b >= 0 && shipSecs > 0 && confirmSecs > 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    const opts = { pending: b > 0 ? "Posting your bond and listing…" : "Listing your ticket…", success: "Listed! Buyers can now pay into escrow." };
    if (USE_MOCK) {
      await mockTx(opts);
    } else {
      const sent = await run(
        (ctx) => createEscrowListing(ctx, { priceUsd: p, bondUsd: b, shipWindowSecs: shipSecs, confirmWindowSecs: confirmSecs }),
        opts,
      );
      if (sent?.address) {
        await saveMeta({ kind: "escrow", id: sent.address.toBase58(), data: { eventId: selectedEvent, seat: seat.trim() } });
        setSeat("");
        setPrice("");
        setBond("");
        await onListed();
      }
    }
    setBusy(false);
  };

  return (
    <Card variant="solid" id="sell-form" className="mt-6 scroll-mt-20 p-4 md:p-6">
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label="Event" htmlFor="sell-event" className="sm:col-span-2">
          <NativeSelect id="sell-event" value={selectedEvent} onChange={(e) => setEventId(e.target.value)} disabled={loadingEvents}>
            {loadingEvents && <option>Loading events…</option>}
            {events.map((ev) => (
              <option key={ev.id} value={ev.id}>
                {ev.title} · {formatDate(ev.startsAt)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Seat" htmlFor="sell-seat" hint="As printed on the ticket, e.g. Sec 112 Row 28 Seat 5" className="sm:col-span-2">
          <Input id="sell-seat" value={seat} onChange={(e) => setSeat(e.target.value)} maxLength={80} />
        </Field>
        <Field label="Price (USD)" htmlFor="sell-price" className="sm:col-span-2" hint={priceError ? <span className="text-disputed">{priceError}</span> : "e.g. 90"}>
          <Input id="sell-price" type="number" inputMode="decimal" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} aria-invalid={!!priceError || undefined} />
        </Field>
        <details className="group sm:col-span-2">
          <summary className="cursor-pointer list-none text-sm font-medium text-[#A1A1AA] hover:text-foreground">
            <span className="mr-1 inline-block transition-transform group-open:rotate-90">›</span> Advanced
          </summary>
          <Field label="Optional seller bond (shows buyers you're serious)" htmlFor="sell-bond" className="mt-3" hint={bondError ? <span className="text-disputed">{bondError}</span> : "Leave empty for no bond. If set, it goes to the buyer if you don't deliver, and back to you when the sale completes."}>
            <Input id="sell-bond" type="number" inputMode="decimal" min="0" step="0.01" value={bond} onChange={(e) => setBond(e.target.value)} aria-invalid={!!bondError || undefined} />
          </Field>
        </details>
        <div className="sm:col-span-2">
          <Toggle
            id="sell-demo"
            checked={demo}
            onChange={setDemo}
            label="Demo mode: 60-second windows"
            hint="Ship and confirm windows of 60 s, so refunds and auto-release happen during a demo."
          />
        </div>
        {!demo && (
          <>
            <Field label="Ship window (hours)" htmlFor="sell-ship" hint="Send the ticket within this time or the buyer gets a refund.">
              <Input id="sell-ship" type="number" min="0.1" step="0.1" value={shipHours} onChange={(e) => setShipHours(e.target.value)} />
            </Field>
            <Field label="Confirm window (hours)" htmlFor="sell-confirm" hint="Buyer's time to confirm before payment auto-releases.">
              <Input id="sell-confirm" type="number" min="0.1" step="0.1" value={confirmHours} onChange={(e) => setConfirmHours(e.target.value)} />
            </Field>
          </>
        )}
        <Button type="submit" className="h-10 sm:col-span-2" disabled={!valid || busy}>
          {busy ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
          {b > 0 ? `List with ${formatUsd(b)} bond` : "List with escrow protection"}
        </Button>
      </form>
    </Card>
  );
}

const STATE_LABEL: Record<ChainEscrow["state"], { text: string; className: string }> = {
  LISTED: { text: "Listed", className: "" },
  CANCELLED: { text: "Cancelled", className: "text-muted-foreground" },
  HELD: { text: "Paid · send the ticket", className: "border-vault text-vault" },
  IN_TRANSIT: { text: "Sent · waiting for buyer", className: "border-transit text-transit" },
  CONFIRMED: { text: "Confirmed", className: "border-released text-released" },
  RELEASED: { text: "Paid out", className: "border-released text-released" },
  REFUNDED: { text: "Refunded to buyer", className: "border-disputed text-disputed" },
  DISPUTED: { text: "Disputed", className: "border-disputed text-disputed" },
  SWAPPED: { text: "Swapped", className: "" },
};

function SaleRow({ sale, events, onDone }: { sale: ChainEscrow; events: Event[]; onDone: () => Promise<void> }) {
  const { run } = useRunTx();
  const [busy, setBusy] = useState(false);
  const ev = events.find((e) => e.id === sale.eventId);
  const label = STATE_LABEL[sale.state];
  const now = useNow();
  const shipPassed = now > 0 && sale.shipDeadline ? new Date(sale.shipDeadline).getTime() < now : false;

  const send = async () => {
    setBusy(true);
    const sent = await run((ctx) => markSent(ctx, { escrow: new PublicKey(sale.id) }), {
      pending: "Marking as sent…",
      success: "Marked as sent. The buyer has been asked to confirm.",
      errorContext: { action: "markSent" },
    });
    if (sent) await onDone();
    setBusy(false);
  };

  return (
    <li className="rounded-xl border border-border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium">{ev?.title ?? "Outside ticket"}</p>
          <p className="truncate text-xs text-muted-foreground">
            {sale.seat || "Seat not recorded"} · {formatUsd(sale.priceUsd)}{sale.bondUsd > 0 && ` · bond ${formatUsd(sale.bondUsd)}`}
          </p>
          {sale.state === "HELD" && sale.shipDeadline && (
            <p className="text-xs text-muted-foreground">Send by {formatDate(sale.shipDeadline)}</p>
          )}
        </div>
        <Badge variant="outline" className={label.className}>{label.text}</Badge>
      </div>
      {(sale.state === "HELD" || sale.state === "IN_TRANSIT" || sale.state === "DISPUTED") && (
        <div className="mt-3 flex flex-wrap gap-2">
          {sale.state === "HELD" && (
            <Button size="sm" disabled={busy || shipPassed} onClick={send}>
              {busy ? <Loader2 className="animate-spin" /> : <Send />}
              {shipPassed ? "Ship window passed" : "Mark as sent"}
            </Button>
          )}
          <Link href={`/orders/${sale.id}`} className="text-sm underline underline-offset-4 self-center">
            Track order
          </Link>
        </div>
      )}
    </li>
  );
}
