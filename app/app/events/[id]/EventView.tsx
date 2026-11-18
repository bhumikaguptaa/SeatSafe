"use client";

// Owner: A. Event detail view. Real mode reads devnet through lib/chain.ts; mock mode uses lib/mock.ts.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, ShieldCheck, Ticket as TicketIcon } from "lucide-react";
import { PublicKey } from "@solana/web3.js";
import { getEvent as getMockEvent, getListingsForEvent as getMockListings, MOCK_USER_ID, tickets as mockTickets } from "@/lib/mock";
import { getEvent, getListingsForEvent, getMyTickets, seatLabel, USE_MOCK, type ChainEvent, type ChainListing } from "@/lib/chain";
import { buyPrimary, fundEscrow, swapResale } from "@/lib/program";
import { saveMeta } from "@/lib/event-meta";
import { mockTx, useRunTx } from "@/lib/tx";
import { useAsyncData } from "@/lib/use-chain";
import { formatDate, formatUsd } from "@/lib/format";
import type { Event } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/form";
import { EventArt } from "@/components/EventArt";
import { AddToCalendar, CalendarLinks } from "@/components/AddToCalendar";

type ViewEvent = Event & Partial<Pick<ChainEvent, "supply" | "sold" | "priceUsd">>;

async function loadMock(id: string): Promise<{ event: ViewEvent | null; listings: ChainListing[] }> {
  const event = getMockEvent(id) ?? null;
  const listings = getMockListings(id).map((l) => {
    const t = mockTickets.find((x) => x.id === l.ticketId);
    return { ...l, seat: t ? seatLabel(t) : "" };
  });
  return { event, listings };
}

async function loadChain(id: string) {
  const [event, listings] = await Promise.all([getEvent(id), getListingsForEvent(id).catch(() => [])]);
  return { event: event as ViewEvent | null, listings };
}

/** Does the logged-in user hold (or have listed) a ticket for this event? */
async function holdsTicket(eventId: string, owner: string | null): Promise<boolean> {
  if (USE_MOCK) return mockTickets.some((t) => t.ownerId === MOCK_USER_ID && t.eventId === eventId);
  if (!owner) return false;
  return (await getMyTickets(owner)).some((t) => t.eventId === eventId);
}

export function EventView({ id, openCalendar = false }: { id: string; openCalendar?: boolean }) {
  const { data, loading, refresh: refreshEvent } = useAsyncData(`event:${id}`, () => (USE_MOCK ? loadMock(id) : loadChain(id)), {
    pollMs: USE_MOCK ? undefined : 15_000,
  });
  const { wallet } = useRunTx();
  const owner = wallet?.address.toBase58() ?? null;
  const { data: holds, refresh: refreshHolds } = useAsyncData(`holds:${id}:${owner ?? "-"}`, () => holdsTicket(id, owner));
  const refresh = async () => {
    await Promise.all([refreshEvent(), refreshHolds()]);
  };

  if (loading && !data) {
    return (
      <div className="mx-auto w-full max-w-4xl space-y-4 px-4 py-8">
        <Skeleton className="h-40 rounded-xl" />
        <Skeleton className="h-24 rounded-xl" />
      </div>
    );
  }
  if (!data?.event) {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 py-8">
        <EmptyState title="Event not found">
          {USE_MOCK ? "No mock event with this id." : "No SeatSafe event at this address on devnet."}{" "}
          <Link href="/" className="underline">Back to Discover</Link>
        </EmptyState>
      </div>
    );
  }

  return (
    <EventDetails
      event={data.event}
      listings={data.listings}
      refresh={refresh}
      showCalendar={!!holds || openCalendar}
      openCalendar={openCalendar}
    />
  );
}

function EventDetails({
  event,
  listings,
  refresh,
  showCalendar,
  openCalendar,
}: {
  event: ViewEvent;
  listings: ChainListing[];
  refresh: () => Promise<void>;
  /** The user holds a ticket for this event, or arrived via `?calendar=1`. */
  showCalendar: boolean;
  openCalendar: boolean;
}) {
  const soldOut = event.supply !== undefined && event.sold !== undefined && event.sold >= event.supply;
  const left = event.supply !== undefined && event.sold !== undefined ? event.supply - event.sold : null;
  const tier1 = listings.filter((l) => l.tier === 1);
  const tier2 = listings.filter((l) => l.tier === 2);

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 md:py-8">
      <Card variant="solid" className="gap-0 overflow-hidden p-0">
        <div className="relative h-32 md:h-44">
          <EventArt event={event} className="absolute inset-0" />
          <Badge className="absolute top-3 left-3 bg-black/50 text-white capitalize">{event.category}</Badge>
        </div>
        <div className="space-y-4 p-4 md:p-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{event.title}</h1>
            <p className="text-sm text-muted-foreground">
              {formatDate(event.startsAt)} · {event.venue}
              {event.city ? `, ${event.city}` : ""}
            </p>
            <p className="text-xs text-muted-foreground">By {event.organizerName}</p>
            {showCalendar && <AddToCalendar event={event} defaultOpen={openCalendar} className="mt-3" />}
          </div>
          <dl className="grid grid-cols-3 gap-2 text-center text-sm">
            <Stat label="Price" value={formatUsd(event.priceFromUsd)} />
            <Stat label="Resale cap" value={event.resaleCapUsd != null ? formatUsd(event.resaleCapUsd) : "None"} />
            <Stat label="Artist royalty" value={`${event.royaltyBps / 100}%`} />
          </dl>
          <BuyPrimaryButton event={event} soldOut={soldOut} onDone={refresh} />
          {left !== null && (
            <p className="text-center text-xs text-muted-foreground">
              {soldOut ? "Sold out" : `${left} of ${event.supply} left`}
            </p>
          )}
        </div>
      </Card>

      <section className="mt-8 space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Fan resale</h2>
          <p className="text-sm text-muted-foreground">
            Capped at {event.resaleCapUsd != null ? formatUsd(event.resaleCapUsd) : "face value"}. Ticket and payment swap in one transaction.
          </p>
        </div>
        {tier1.length === 0 ? (
          <EmptyState title="No resale tickets right now" />
        ) : (
          <ul className="space-y-2">
            {tier1.map((l) => (
              <ListingRow key={l.id} listing={l} event={event} onDone={refresh} />
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8 space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Outside tickets</h2>
          <p className="text-sm text-muted-foreground">
            From other platforms. Your payment waits in a SeatSafe vault until you confirm the ticket works.
          </p>
        </div>
        {tier2.length === 0 ? (
          <EmptyState title="No outside tickets listed" />
        ) : (
          <ul className="space-y-2">
            {tier2.map((l) => (
              <ListingRow key={l.id} listing={l} event={event} onDone={refresh} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-muted/50 p-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function BuyPrimaryButton({ event, soldOut, onDone }: { event: ViewEvent; soldOut: boolean; onDone: () => Promise<void> }) {
  const { run } = useRunTx();
  const [busy, setBusy] = useState(false);

  const buy = async () => {
    setBusy(true);
    const opts = { pending: "Buying your ticket…", success: "Ticket bought! It's in My tickets.", successExtra: <CalendarLinks event={event} /> };
    if (USE_MOCK) {
      await mockTx(opts);
    } else {
      const seat = `GA ${(event.sold ?? 0) + 1}`; // general admission, numbered (≤ 32 bytes)
      const sent = await run((ctx) => buyPrimary(ctx, { event: new PublicKey(event.id), seat }), opts);
      if (sent) await onDone();
    }
    setBusy(false);
  };

  return (
    <Button className="h-11 w-full text-base" disabled={busy || soldOut} onClick={buy}>
      {busy ? <Loader2 className="animate-spin" /> : <TicketIcon />}
      {soldOut ? "Sold out" : `Buy ticket · ${formatUsd(event.priceFromUsd)}`}
    </Button>
  );
}

function ListingRow({ listing, event, onDone }: { listing: ChainListing; event: ViewEvent; onDone: () => Promise<void> }) {
  const { run, wallet } = useRunTx();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const mine = wallet?.address.toBase58() === listing.sellerId;

  const buy = async () => {
    setBusy(true);
    if (listing.tier === 1) {
      const opts = { pending: "Swapping ticket and payment…", success: "Ticket bought! It's in My tickets.", successExtra: <CalendarLinks event={event} /> };
      if (USE_MOCK) await mockTx(opts);
      else if (listing.ticketMint) {
        const sent = await run((ctx) => swapResale(ctx, { ticketMint: new PublicKey(listing.ticketMint!) }), opts);
        if (sent) await onDone();
      }
    } else {
      const opts = { pending: "Locking your payment in the vault…", success: "Payment protected. Track your order.", successExtra: <CalendarLinks event={event} /> };
      if (USE_MOCK) {
        if (await mockTx(opts)) router.push("/orders/ord_held");
      } else if (listing.escrow) {
        const escrow = listing.escrow;
        const sent = await run((ctx) => fundEscrow(ctx, { escrow: new PublicKey(escrow) }), opts);
        if (sent) {
          // Keep the event/seat for the tracker (the escrow account doesn't store them).
          void saveMeta({ kind: "escrow", id: escrow, data: { eventId: event.id, seat: listing.seat, sellerName: listing.sellerName } });
          router.push(`/orders/${escrow}`);
        }
      }
    }
    setBusy(false);
  };

  return (
    <li className="flex flex-wrap items-center gap-3 rounded-xl border border-border p-3">
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{listing.seat || "General admission"}</p>
        <p className="truncate text-xs text-muted-foreground">
          Seller {listing.sellerName}
          {listing.tier === 2 && ` · ${formatUsd(listing.bondUsd)} seller bond`}
        </p>
      </div>
      <div className="text-right">
        <p className="font-semibold tabular-nums">{formatUsd(listing.priceUsd)}</p>
        {listing.tier === 1 && event.resaleCapUsd != null && listing.priceUsd > event.resaleCapUsd && (
          <p className="text-xs text-disputed">Above cap</p>
        )}
      </div>
      <Button size="sm" variant={listing.tier === 2 ? "outline" : "default"} disabled={busy || mine} onClick={buy} className="w-full sm:w-auto">
        {busy ? <Loader2 className="animate-spin" /> : listing.tier === 2 ? <ShieldCheck /> : null}
        {mine ? "Yours" : listing.tier === 2 ? "Buy with escrow protection" : "Buy"}
      </Button>
    </li>
  );
}
