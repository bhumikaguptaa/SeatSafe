"use client";

// Owner: A. Public "Is this listing protected?" check. Reads devnet directly (lib/chain.ts
// getVerifyInfo), no login. Meant to be linked from the Grok bot and shared before paying anyone.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertTriangle, ExternalLink, Search, ShieldCheck } from "lucide-react";
import { addressFromInput, getVerifyInfo, type VerifyInfo } from "@/lib/chain";
import { useAsyncData, useNow } from "@/lib/use-chain";
import { formatCountdown, formatDate, formatUsd } from "@/lib/format";
import { explorerAddress } from "@/lib/solana";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { formatSeat } from "@/lib/seat-format";

export function VerifyForm({ initial = "" }: { initial?: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const addr = addressFromInput(value);
        if (addr) router.push(`/verify/${encodeURIComponent(addr)}`);
      }}
    >
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Paste a SeatSafe link or listing address"
        aria-label="SeatSafe link or listing address"
      />
      <Button type="submit" disabled={!value.trim()}>
        <Search /> Check
      </Button>
    </form>
  );
}

export function VerifyView({ address }: { address: string }) {
  const { data, loading, error } = useAsyncData(`verify:${address}`, () => getVerifyInfo(address));

  return (
    <section className="mx-auto w-full max-w-2xl px-4 py-6 md:py-8">
      <h1 className="text-2xl font-bold tracking-tight">Is this listing protected?</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        We read the listing straight from the Solana blockchain (devnet), not from the seller.
      </p>
      <div className="mt-6">
        {loading && !data ? (
          <Skeleton className="h-48 rounded-xl" />
        ) : error && !data ? (
          <Card className="p-4 text-sm">
            Couldn&apos;t reach Solana right now. Try again in a moment.
          </Card>
        ) : data ? (
          <Result info={data} />
        ) : null}
      </div>
      <div className="mt-8 space-y-2">
        <p className="text-sm font-medium">Check another listing</p>
        <VerifyForm />
      </div>
    </section>
  );
}

function NotSeatSafe({ address, reason }: { address: string; reason: string }) {
  return (
    <Card className="gap-3 border-disputed/50 bg-disputed/5 p-4 md:p-6">
      <div className="flex items-center gap-2 text-disputed">
        <AlertTriangle className="size-5" aria-hidden />
        <p className="text-lg font-semibold">This is not a SeatSafe listing. Don&apos;t pay.</p>
      </div>
      <p className="text-sm text-muted-foreground">{reason}</p>
      <p className="font-mono text-xs break-all text-muted-foreground">{address}</p>
    </Card>
  );
}

function Protected({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="gap-4 border-vault/40 p-4 md:p-6">
      <div className="flex items-center gap-2 text-vault">
        <ShieldCheck className="size-5" aria-hidden />
        <p className="text-lg font-semibold">{title}</p>
      </div>
      {children}
    </Card>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-border py-2 text-sm last:border-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{children}</dd>
    </div>
  );
}

function VaultLink({ vault, what }: { vault: string; what: string }) {
  return (
    <a href={explorerAddress(vault)} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: "outline", size: "sm" })}>
      <ExternalLink /> See the {what} on Solana Explorer
    </a>
  );
}

const ESCROW_STATE: Record<string, { label: string; text: string }> = {
  LISTED: { label: "For sale", text: "No one has paid yet. If you buy, your payment goes into the vault, not to the seller." },
  HELD: { label: "Paid, waiting for the seller", text: "The buyer's payment and the seller's bond are locked in the vault." },
  IN_TRANSIT: { label: "Ticket sent", text: "The seller says the ticket was sent. The buyer can confirm or open a dispute before the deadline." },
  RELEASED: { label: "Completed", text: "The order finished and the vault paid out." },
  REFUNDED: { label: "Refunded", text: "The seller missed the deadline. The buyer got the payment and the seller's bond." },
  CANCELLED: { label: "Cancelled", text: "The seller withdrew the listing before anyone paid." },
  DISPUTED: { label: "In dispute", text: "Funds stay locked in the vault until the dispute is settled." },
};

function Deadline({ label, at }: { label: string; at: string | null }) {
  const now = useNow();
  if (!at) return null;
  const ms = new Date(at).getTime() - now;
  return (
    <Row label={label}>
      {formatDate(at)}
      <span className="block text-xs font-normal text-muted-foreground">{ms > 0 ? `in ${formatCountdown(ms)}` : "passed"}</span>
    </Row>
  );
}

const secs = (s: number) => (s >= 3600 ? `${Math.round(s / 3600)} h` : s >= 60 ? `${Math.round(s / 60)} min` : `${s} s`);

function Result({ info }: { info: VerifyInfo }) {
  switch (info.kind) {
    case "invalid":
      return <NotSeatSafe address={info.address} reason="That isn't a valid Solana address or SeatSafe link." />;
    case "missing":
      return (
        <NotSeatSafe
          address={info.address}
          reason="Nothing exists at this address on Solana devnet. If it was a SeatSafe listing, it has already sold or been cancelled."
        />
      );
    case "foreign":
      return <NotSeatSafe address={info.address} reason="This address isn't controlled by the SeatSafe program, so SeatSafe can't protect your money." />;
    case "other":
      return <NotSeatSafe address={info.address} reason={`This is a SeatSafe account, but not a listing (${info.accountType}). Ask the seller for the listing link.`} />;
    case "event":
      return (
        <Protected title="This is a real SeatSafe event">
          <dl>
            <Row label="Event">{info.event.title}</Row>
            <Row label="Date">{formatDate(info.event.startsAt)}</Row>
            <Row label="Face value">{formatUsd(info.event.priceFromUsd)}</Row>
            <Row label="Resale cap">{info.event.resaleCapUsd != null ? formatUsd(info.event.resaleCapUsd) : "None"}</Row>
          </dl>
          <p className="text-sm text-muted-foreground">
            Only buy through the event page. Anyone asking more than the cap, or asking you to pay outside SeatSafe, isn&apos;t protected.
          </p>
          <Link href={`/events/${info.address}`} className={buttonVariants({ size: "sm" })}>Open the event</Link>
        </Protected>
      );
    case "listing":
      return (
        <Protected title="Protected SeatSafe resale">
          <dl>
            <Row label="Event">{info.event?.title ?? "SeatSafe event"}</Row>
            {info.event && <Row label="Date">{formatDate(info.event.startsAt)}</Row>}
            <Row label="Seat">{formatSeat(info.event, info.seat).label}</Row>
            <Row label="Price">
              {formatUsd(info.priceUsd)}
              {info.event?.resaleCapUsd != null && (
                <span className="block text-xs font-normal text-muted-foreground">artist&apos;s cap {formatUsd(info.event.resaleCapUsd)}</span>
              )}
            </Row>
            <Row label="State"><Badge variant="outline" className="border-released text-released">For sale</Badge></Row>
          </dl>
          <p className="text-sm">
            <strong>The ticket is held by the SeatSafe program, not the seller.</strong> When you buy, the ticket and your payment
            swap in one transaction: either both move or neither does.
          </p>
          <div className="flex flex-wrap gap-2">
            {info.event && <Link href={`/events/${info.event.id}`} className={buttonVariants({ size: "sm" })}>Buy on SeatSafe</Link>}
            <VaultLink vault={info.vault} what="ticket vault" />
          </div>
        </Protected>
      );
    case "escrow": {
      const e = info.escrow;
      const st = ESCROW_STATE[e.state] ?? { label: e.state, text: "" };
      return (
        <Protected title="Protected SeatSafe escrow">
          <dl>
            <Row label="Event">{info.event?.title ?? "Outside ticket"}</Row>
            {e.seat && <Row label="Seat">{formatSeat(info.event, e.seat).label}</Row>}
            <Row label="Price">{formatUsd(e.priceUsd)}</Row>
            <Row label="Seller bond">
              {formatUsd(e.bondUsd)}
              <span className="block text-xs font-normal text-muted-foreground">goes to the buyer if the seller doesn&apos;t deliver</span>
            </Row>
            <Row label="State"><Badge variant="outline">{st.label}</Badge></Row>
            {e.state === "LISTED" && (
              <Row label="Seller must send within">{secs(info.shipWindowSecs)} of payment</Row>
            )}
            <Deadline label="Seller must send by" at={e.state === "HELD" ? e.shipDeadline : null} />
            <Deadline label="Buyer confirms by" at={e.state === "IN_TRANSIT" ? e.confirmDeadline : null} />
            <Deadline label="Dispute decided by" at={e.state === "DISPUTED" ? info.disputeDeadline : null} />
          </dl>
          {st.text && <p className="text-sm text-muted-foreground">{st.text}</p>}
          <p className="text-sm">
            <strong>Money is held by the SeatSafe program, not the seller.</strong> If the seller misses the deadline, the buyer
            gets the payment and the bond back automatically.
          </p>
          <div className="flex flex-wrap gap-2">
            {e.state === "LISTED" && info.event && (
              <Link href={`/events/${info.event.id}`} className={buttonVariants({ size: "sm" })}>Buy on SeatSafe</Link>
            )}
            {e.state !== "LISTED" && e.state !== "CANCELLED" && (
              <Link href={`/orders/${info.address}`} className={buttonVariants({ size: "sm" })}>Track this order</Link>
            )}
            <VaultLink vault={info.vault} what="payment vault" />
          </div>
        </Protected>
      );
    }
  }
}
