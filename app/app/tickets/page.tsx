"use client";

// Owner: A. The user's tickets with "Resell" (capped Tier 1 listing). The gate pass page is D's.
// Real mode: Token-2022 tickets the Privy wallet holds (lib/chain.ts). Mock mode: lib/mock.ts.
// Deep link: /tickets?resell=<ticket mint> opens that ticket's "Can't go? Resell" dialog (after login).
// "Sell in person": lists the ticket (same listResale, cap enforced) and shows a Solana Pay QR
// (components/InPersonSale.tsx) that the buyer scans at the gate.

import Link from "next/link";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CalendarX2, Loader2, Lock, QrCode, ScanLine, ShieldCheck, Tag, X } from "lucide-react";
import { PublicKey } from "@solana/web3.js";
import { events as mockEvents, MOCK_USER_ID, tickets as mockTickets } from "@/lib/mock";
import { chainProgram, getEvents, getMyTickets, seatLabel, USE_MOCK, type ChainTicket } from "@/lib/chain";
import { cancelListing, listResale, pdas } from "@/lib/program";
import { mockTx, useRunTx, useTxWallet } from "@/lib/tx";
import { useAsyncData } from "@/lib/use-chain";
import { friendlyError } from "@/lib/errors";
import { formatDate, formatUsd } from "@/lib/format";
import type { Event } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState, Field } from "@/components/form";
import { AddToCalendar } from "@/components/AddToCalendar";
import { AuthButton } from "@/components/AuthButton";
import { InPersonSale } from "@/components/InPersonSale";

interface TicketsData {
  tickets: (ChainTicket | (ChainTicket & { mock: true }))[];
  events: Record<string, Event>;
}

async function loadMock(): Promise<TicketsData> {
  return {
    tickets: mockTickets
      .filter((t) => t.ownerId === MOCK_USER_ID)
      .map((t) => ({ ...t, seatLabel: seatLabel(t), listed: false, mock: true as const })),
    events: Object.fromEntries(mockEvents.map((e) => [e.id, e])),
  };
}

async function loadChain(owner: string): Promise<TicketsData> {
  const [tickets, events] = await Promise.all([getMyTickets(owner), getEvents()]);
  return { tickets, events: Object.fromEntries(events.map((e) => [e.id, e])) };
}

export default function TicketsPage() {
  // useSearchParams needs a Suspense boundary (Cache Components).
  return (
    <Suspense fallback={<TicketsSkeleton />}>
      <TicketsView />
    </Suspense>
  );
}

function TicketsSkeleton() {
  return (
    <section className="mx-auto w-full max-w-3xl space-y-2 px-4 py-6 md:py-8">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-20 rounded-xl" />
    </section>
  );
}

function TicketsView() {
  const resellMint = useSearchParams().get("resell");
  const wallet = useTxWallet();
  const owner = wallet?.address.toBase58() ?? null;
  const key = USE_MOCK ? "tickets:mock" : owner ? `tickets:${owner}` : null;
  const { data, loading, refresh } = useAsyncData(key, () => (USE_MOCK ? loadMock() : loadChain(owner!)));

  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-6 md:py-8">
      <h1 className="text-2xl font-bold tracking-tight">My tickets</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Your SeatSafe tickets. Resell at a fair price, up to the artist&apos;s cap.
      </p>

      <div className="mt-6">
        {!USE_MOCK && !owner ? (
          <EmptyState title={resellMint ? "Log in to resell your ticket" : "Log in to see your tickets"}>
            <span className="block">Your wallet is created when you log in.</span>
            <span className="mt-3 inline-block"><AuthButton /></span>
          </EmptyState>
        ) : loading && !data ? (
          <div className="space-y-2">
            <Skeleton className="h-20 rounded-xl" />
            <Skeleton className="h-20 rounded-xl" />
          </div>
        ) : resellMint && data && !data.tickets.some((t) => t.id === resellMint) ? (
          <EmptyState title="That ticket is not in this wallet">
            It may have been sold already, or you&apos;re logged in with a different account.{" "}
            <Link href="/tickets" className="underline">Show my tickets</Link>
          </EmptyState>
        ) : !data || data.tickets.length === 0 ? (
          <EmptyState title="No tickets yet">
            <Link href="/" className="underline">Find an event</Link>
          </EmptyState>
        ) : (
          <ul className="space-y-3">
            {data.tickets.map((t) => (
              <TicketRow key={t.id} ticket={t} event={data.events[t.eventId]} onDone={refresh} autoResell={t.id === resellMint && !t.listed} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

type ResellMode = "cap" | "cantGo" | "inPerson";

/** What the seller receives: price minus artist royalty and the 3% SeatSafe fee. */
const netOf = (price: number, event?: Event) => price * (1 - (event?.royaltyBps ?? 0) / 10_000 - 0.03);

function TicketRow({
  ticket,
  event,
  onDone,
  autoResell = false,
}: {
  ticket: ChainTicket;
  event?: Event;
  onDone: () => Promise<void>;
  /** Open "Can't go? Resell" on mount (deep link). */
  autoResell?: boolean;
}) {
  const { run } = useRunTx();
  const canResell = ticket.tier === 1 && !ticket.listed;
  const [open, setOpen] = useState(autoResell && canResell);
  const [mode, setMode] = useState<ResellMode>(autoResell ? "cantGo" : "cap");
  const openResell = (m: ResellMode) => {
    setMode(m);
    setOpen(true);
  };
  const [busy, setBusy] = useState(false);
  /** Open in-person sale (full-screen QR). */
  const [qr, setQr] = useState<{ listing: string; price: number } | null>(null);
  const showQrForExisting = () => {
    const listing = USE_MOCK ? `mock-${ticket.id}` : pdas(chainProgram().programId).listing(new PublicKey(ticket.id)).toBase58();
    setQr({ listing, price: ticket.listingPriceUsd ?? 0 });
  };

  const cancel = async () => {
    setBusy(true);
    const opts = { pending: "Taking your listing down…", success: "Listing cancelled. The ticket is back in your wallet." };
    if (USE_MOCK) await mockTx(opts);
    else if (await run((ctx) => cancelListing(ctx, { ticketMint: new PublicKey(ticket.id) }), opts)) await onDone();
    setBusy(false);
  };

  return (
    <li className="surface-solid rounded-xl p-4 transition-shadow duration-300 hover:glow-vault">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium">{event?.title ?? "SeatSafe event"}</p>
          <p className="text-sm text-muted-foreground">{ticket.seatLabel}</p>
          {event && <p className="text-xs text-muted-foreground">{formatDate(event.startsAt)}</p>}
        </div>
        {ticket.listed ? (
          <Badge variant="outline" className="shrink-0 border-transit text-transit">
            Listed · {formatUsd(ticket.listingPriceUsd ?? 0)}
          </Badge>
        ) : (
          ticket.tier === 1 ? (
            <Badge
              variant="outline"
              className="shrink-0 gap-1 border-vault/50 text-vault"
              title="Frozen on Solana: only the SeatSafe program can move this ticket, so it can't be resold above the artist's cap."
            >
              <Lock className="size-3" aria-hidden /> Locked
            </Badge>
          ) : (
            <Badge variant="outline" className="shrink-0 border-transit/50 text-transit" title="A ticket from another platform, sold through the escrow vault.">
              Outside
            </Badge>
          )
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {ticket.listed ? (
          <>
            {ticket.tier === 1 && (
              <Button size="sm" onClick={showQrForExisting}>
                <ScanLine /> Show QR
              </Button>
            )}
            <Button size="sm" variant="outline" disabled={busy} onClick={cancel}>
              {busy ? <Loader2 className="animate-spin" /> : <X />} Cancel listing
            </Button>
          </>
        ) : (
          <>
            <Link href={`/tickets/${ticket.id}/pass`} className={buttonVariants({ size: "sm", variant: "outline" })}>
              <QrCode /> Gate pass
            </Link>
            {ticket.tier === 1 && (
              <>
                <Button size="sm" onClick={() => openResell("cap")}>
                  <Tag /> Resell
                </Button>
                <Button size="sm" variant="outline" onClick={() => openResell("inPerson")}>
                  <ScanLine /> Sell in person
                </Button>
                <Button size="sm" variant="ghost" onClick={() => openResell("cantGo")}>
                  <CalendarX2 /> Can&apos;t go? Resell
                </Button>
              </>
            )}
          </>
        )}
        {event && <AddToCalendar event={event} />}
      </div>
      {ticket.tier === 1 && (
        <ResellDialog
          key={mode}
          open={open}
          onOpenChange={setOpen}
          ticket={ticket}
          event={event}
          onDone={onDone}
          initialPrice={mode === "cap" ? undefined : event?.priceFromUsd}
          cantGo={mode === "cantGo"}
          onInPerson={mode === "inPerson" ? (listing, price) => setQr({ listing, price }) : undefined}
        />
      )}
      {qr && (
        <InPersonSale
          listing={qr.listing}
          ticketMint={ticket.id}
          priceUsd={qr.price}
          netUsd={netOf(qr.price, event)}
          seat={ticket.seatLabel}
          title={event?.title ?? "SeatSafe event"}
          onClose={() => {
            setQr(null);
            void onDone();
          }}
        />
      )}
    </li>
  );
}

function ResellDialog({
  open,
  onOpenChange,
  ticket,
  event,
  onDone,
  initialPrice,
  cantGo = false,
  onInPerson,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  ticket: ChainTicket;
  event?: Event;
  onDone: () => Promise<void>;
  /** Prefill (face value for "Can't go?"); defaults to the cap. */
  initialPrice?: number;
  cantGo?: boolean;
  /** "Sell in person": after listing, show the QR for this listing instead of closing. */
  onInPerson?: (listing: string, priceUsd: number) => void;
}) {
  const { run } = useRunTx();
  const cap = event?.resaleCapUsd ?? null;
  const start = initialPrice ?? cap;
  const [price, setPrice] = useState(start != null ? String(start) : "");
  const [busy, setBusy] = useState(false);
  const value = Number(price);
  const valid = price !== "" && Number.isFinite(value) && value > 0;
  const overCap = valid && cap != null && value > cap;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    const opts = {
      pending: "Listing your ticket…",
      success: `Listed for ${formatUsd(value)}.`,
      errorContext: { resaleCapUsd: cap },
    };
    let ok: boolean;
    let listing: string | undefined;
    if (USE_MOCK) {
      // Same message the program's AboveResaleCap rejection produces in real mode.
      ok = await mockTx(opts, overCap ? friendlyError({ logs: ["Error Code: AboveResaleCap."] }, { resaleCapUsd: cap }).message : undefined);
      listing = `mock-${ticket.id}`;
    } else {
      // Over-cap prices are sent on purpose: the program rejects them live (demo moment).
      const sent = await run((ctx) => listResale(ctx, { ticketMint: new PublicKey(ticket.id), priceUsd: value }), opts);
      ok = sent !== null;
      listing = sent?.address?.toBase58();
      // Rejected over the cap (AboveResaleCap): count it on the Discover ticker. Event/price/cap only.
      if (!ok && overCap && cap != null) {
        void fetch("/api/stats", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ eventId: event?.id, priceUsd: value, capUsd: cap }),
        }).catch(() => undefined);
      }
    }
    setBusy(false);
    if (ok) {
      onOpenChange(false);
      if (onInPerson && listing) onInPerson(listing, value);
      else await onDone();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{onInPerson ? "Sell in person" : cantGo ? "Can't go? Resell your ticket" : "Resell ticket"}</DialogTitle>
            <DialogDescription>
              {event?.title ?? "SeatSafe event"} · {ticket.seatLabel}
            </DialogDescription>
          </DialogHeader>
          <Field
            label="Price (USD)"
            htmlFor={`price-${ticket.id}`}
            hint={
              cap != null ? (
                <span className={overCap ? "text-disputed" : undefined}>
                  Max {formatUsd(cap)}. {overCap ? "Above the artist's cap: SeatSafe will reject it." : "Set by the artist."}
                </span>
              ) : undefined
            }
          >
            <Input
              id={`price-${ticket.id}`}
              inputMode="decimal"
              type="number"
              min="0"
              step="0.01"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              aria-invalid={overCap || undefined}
              autoFocus
            />
          </Field>
          {onInPerson && (
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <ShieldCheck className="mt-px size-3.5 shrink-0 text-vault" aria-hidden />
              The buyer scans your QR. Ticket and payment swap in one transaction, gas paid by SeatSafe.
            </p>
          )}
          {cantGo && (
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <ShieldCheck className="mt-px size-3.5 shrink-0 text-vault" aria-hidden />
              Resell safely: the buyer&apos;s money is held until your ticket transfers.
            </p>
          )}
          {cap != null && event && valid && (
            <p className="text-xs text-muted-foreground">
              You get {formatUsd(netOf(value, event))} after the {event.royaltyBps / 100}% artist
              royalty and 3% SeatSafe fee.
            </p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={!valid || busy} className="w-full sm:w-auto">
              {busy && <Loader2 className="animate-spin" />}
              {onInPerson ? <><ScanLine /> Show QR</> : <>List for {valid ? formatUsd(value) : "…"}</>}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
