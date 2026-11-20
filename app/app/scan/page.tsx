"use client";

// Owner: A. "Scan to buy": in-person resale at the gate. Scan the seller's Solana Pay QR (or paste the
// solana: link), confirm, the Privy wallet SIGNS the transaction /api/pay/swap built (relayer = fee payer),
// and /api/relay sends it, the same path as every other SeatSafe action. Ticket and USDC swap atomically.
//
// Safety: only SeatSafe's own /api/pay/swap links are accepted here. A Solana Pay transaction request can
// ask a wallet to sign anything, so foreign links are refused (use a wallet app for those).

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, ScanLine, ShieldCheck, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { VersionedTransaction } from "@solana/web3.js";
import { getVerifyInfo, USE_MOCK, type ChainEvent } from "@/lib/chain";
import { useTxWallet } from "@/lib/tx";
import { friendlyError, TxError } from "@/lib/errors";
import { explorerTx } from "@/lib/solana";
import { formatDate, formatUsd } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { AuthButton } from "@/components/AuthButton";
import { CalendarLinks } from "@/components/AddToCalendar";
import { ScanAura } from "@/components/ScanAura"; // added by D: colour-burst aura (visual only)

// Camera access + ZXing only in the browser.
const Scanner = dynamic(() => import("@yudiel/react-qr-scanner").then((m) => m.Scanner), {
  ssr: false,
  loading: () => <div className="aspect-square w-full animate-pulse rounded-2xl bg-muted" />,
});

interface Offer {
  link: string;
  listing: string;
  event: ChainEvent | null;
  seat: string;
  priceUsd: number;
  label: string;
}

/** solana:<link> -> our /api/pay/swap link + listing PDA, or an error message. */
async function readQr(raw: string): Promise<{ link: string; listing: string } | { error: string }> {
  const { parseURL } = await import("@solana/pay");
  let parsed;
  try {
    parsed = parseURL(raw.trim());
  } catch {
    return { error: "That's not a Solana Pay code." };
  }
  if (!("link" in parsed)) return { error: "That's a payment request, not a SeatSafe ticket. Use a wallet app for it." };
  const link = new URL(parsed.link.toString());
  if (link.origin !== window.location.origin || link.pathname !== "/api/pay/swap") {
    return { error: `This QR is from ${link.host}, not SeatSafe. Don't pay through it here.` };
  }
  const listing = link.searchParams.get("listing");
  if (!listing) return { error: "This SeatSafe QR has no listing." };
  return { link: link.toString(), listing };
}

export default function ScanPage() {
  const router = useRouter();
  const wallet = useTxWallet();
  const [paused, setPaused] = useState(false);
  const [paste, setPaste] = useState("");
  const [offer, setOffer] = useState<Offer | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handle = async (raw: string) => {
    setPaused(true);
    setProblem(null);
    const r = await readQr(raw);
    if ("error" in r) {
      setProblem(r.error);
      setPaused(false);
      return;
    }
    if (USE_MOCK) {
      setOffer({ link: r.link, listing: r.listing, event: null, seat: "Mock seat", priceUsd: 14, label: "SeatSafe" });
      return;
    }
    // Read the listing straight from devnet (same check as /verify), and the label from the endpoint.
    const [info, meta] = await Promise.all([
      getVerifyInfo(r.listing).catch(() => null),
      fetch(r.link).then((res) => res.json() as Promise<{ label?: string }>).catch(() => ({ label: undefined })),
    ]);
    if (!info || info.kind !== "listing") {
      setProblem(info?.kind === "missing" ? "This ticket was already sold or the sale was cancelled." : "This is not a SeatSafe listing. Don't pay.");
      setPaused(false);
      return;
    }
    setOffer({ link: r.link, listing: r.listing, event: info.event, seat: info.seat || "General admission", priceUsd: info.priceUsd, label: meta.label ?? "SeatSafe" });
  };

  const buy = async () => {
    if (!offer || !wallet) return;
    setBusy(true);
    const id = toast.loading("Swapping ticket and payment…");
    try {
      if (USE_MOCK) {
        await new Promise((r) => setTimeout(r, 700));
        toast.success("Ticket bought!", { id, description: "Mock mode: no transaction sent." });
        router.push("/tickets");
        return;
      }
      // 1. Transaction request: the server builds the swap for this buyer, relayer already signed.
      const res = await fetch(offer.link, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ account: wallet.address.toBase58() }),
      });
      const body = (await res.json()) as { transaction?: string; message?: string; error?: string };
      if (!res.ok || !body.transaction) throw new TxError(body.error ?? body.message ?? `Request failed (${res.status})`);
      // 2. Privy signs (doesn't send). 3. /api/relay checks, co-signs, sends and confirms.
      const tx = VersionedTransaction.deserialize(Buffer.from(body.transaction, "base64"));
      const signed = await wallet.signTransaction(tx.serialize());
      const relay = await fetch("/api/relay", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tx: Buffer.from(signed).toString("base64") }),
      });
      const sent = (await relay.json()) as { signature?: string; error?: string; logs?: string[] };
      if (!relay.ok || !sent.signature) throw new TxError(sent.error ?? "Couldn't send the transaction", sent.logs ?? [], sent.signature);
      const sig = sent.signature;
      toast.success("Ticket bought! It's in My tickets.", {
        id,
        duration: 10_000,
        description: offer.event ? <div><div>Gas paid by SeatSafe.</div><CalendarLinks event={offer.event} /></div> : "Gas paid by SeatSafe.",
        action: { label: "View tx", onClick: () => window.open(explorerTx(sig), "_blank", "noopener") },
      });
      router.push("/tickets");
    } catch (err) {
      console.warn("scan buy failed", err);
      toast.error(friendlyError(err, { resaleCapUsd: offer.event?.resaleCapUsd ?? null }).message, { id });
      setBusy(false);
    }
  };

  const reset = () => {
    setOffer(null);
    setProblem(null);
    setPaused(false);
    setBusy(false);
  };

  return (
    <section className="mx-auto w-full max-w-md px-4 py-6 md:py-8">
      <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight"><ScanLine className="size-6" /> Scan to buy</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Scan the seller&apos;s SeatSafe QR. The ticket and your payment swap in one transaction, capped at the artist&apos;s price.
      </p>

      {offer ? (
        <ScanAura state="burst" className="mt-6">
        <Card className="gap-4 p-5">
          <div className="flex items-center gap-2 text-vault">
            <ShieldCheck className="size-5" aria-hidden />
            <p className="font-semibold">Protected by {offer.label}</p>
          </div>
          <div>
            <p className="text-lg font-semibold">Buy {offer.seat} for {formatUsd(offer.priceUsd)}</p>
            <p className="text-sm text-muted-foreground">
              {offer.event?.title ?? "SeatSafe event"}
              {offer.event && ` · ${formatDate(offer.event.startsAt)}`}
            </p>
            {offer.event?.resaleCapUsd != null && (
              <p className="mt-1 text-xs text-muted-foreground">Artist&apos;s cap {formatUsd(offer.event.resaleCapUsd)}. Gas paid by SeatSafe.</p>
            )}
          </div>
          {!USE_MOCK && !wallet ? (
            <div className="space-y-2">
              <p className="text-sm">Log in to buy. Your wallet is created when you log in.</p>
              <AuthButton />
            </div>
          ) : (
            <Button size="lg" disabled={busy} onClick={buy}>
              {busy && <Loader2 className="animate-spin" />} Buy for {formatUsd(offer.priceUsd)}
            </Button>
          )}
          <Button variant="ghost" disabled={busy} onClick={reset}>Scan another</Button>
        </Card>
        </ScanAura>
      ) : (
        <div className="mt-6 space-y-4">
          <ScanAura state={paused ? "burst" : "scanning"}>
          <div className="overflow-hidden rounded-2xl border border-border bg-black">
            <Scanner
              paused={paused}
              formats={["qr_code"]}
              onScan={(codes) => {
                const raw = codes[0]?.rawValue;
                if (raw && !paused) void handle(raw);
              }}
              onError={() => setProblem("Camera unavailable. Allow camera access, or paste the link below.")}
            />
          </div>
          </ScanAura>
          {problem && (
            <p className="flex items-start gap-2 rounded-lg border border-disputed/40 bg-disputed/5 p-3 text-sm">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-disputed" aria-hidden />
              {problem}
            </p>
          )}
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (paste.trim()) void handle(paste);
            }}
          >
            <Input value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="Or paste the solana: link" aria-label="Solana Pay link" />
            <Button type="submit" variant="outline" disabled={!paste.trim()}>Open</Button>
          </form>
        </div>
      )}
    </section>
  );
}
