"use client";

// Owner: A. "Sell in person": full-screen Solana Pay QR for one resale listing. The buyer scans it with
// SeatSafe's /scan page or any Solana Pay wallet; /api/pay/swap builds the atomic swap (relayer pays gas).
// Polls the listing every 2 s: when the account closes the ticket sold (unless we cancelled it).

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Copy, ExternalLink, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { PublicKey } from "@solana/web3.js";
import { USE_MOCK } from "@/lib/chain";
import { cancelListing } from "@/lib/program";
import { connection, explorerTx } from "@/lib/solana";
import { useRunTx } from "@/lib/tx";
import { formatUsd } from "@/lib/format";
import { Button, buttonVariants } from "@/components/ui/button";

/**
 * solana:<url-encoded https://<app>/api/pay/swap?listing=<pda>> (Solana Pay transaction request).
 * @solana/pay is imported lazily: its QR module touches the DOM, which breaks server rendering.
 */
export async function payUrl(listing: string, origin = window.location.origin): Promise<string> {
  const { encodeURL } = await import("@solana/pay");
  return encodeURL({ link: new URL(`${origin}/api/pay/swap?listing=${listing}`) }).toString();
}

export function InPersonSale({
  listing,
  ticketMint,
  priceUsd,
  netUsd,
  seat,
  title,
  onClose,
}: {
  listing: string;
  ticketMint: string;
  priceUsd: number;
  /** What the seller receives after royalty and fee. */
  netUsd: number;
  seat: string;
  title: string;
  onClose: (sold: boolean) => void;
}) {
  const { run } = useRunTx();
  const qrRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"waiting" | "sold" | "cancelling">("waiting");
  const [soldSig, setSoldSig] = useState<string | null>(null);
  const cancelled = useRef(false);
  // QR (qr-code-styling needs the DOM, so load it in the browser only).
  useEffect(() => {
    let alive = true;
    void (async () => {
      const [{ createQR }, url] = await Promise.all([import("@solana/pay"), payUrl(listing)]);
      if (!alive || !qrRef.current) return;
      const size = Math.min(360, Math.floor(window.innerWidth * 0.8));
      qrRef.current.innerHTML = "";
      createQR(url, size, "white", "black").append(qrRef.current);
    })();
    return () => {
      alive = false;
    };
  }, [listing]);

  // Sold = the listing account is gone and we didn't cancel it.
  useEffect(() => {
    if (USE_MOCK || state !== "waiting") return;
    const key = new PublicKey(listing);
    const timer = setInterval(async () => {
      const info = await connection.getAccountInfo(key, "confirmed").catch(() => undefined);
      if (info !== null || cancelled.current) return;
      clearInterval(timer);
      const [last] = await connection.getSignaturesForAddress(key, { limit: 1 }, "confirmed").catch(() => []);
      setSoldSig(last?.signature ?? null);
      setState("sold");
    }, 2000);
    return () => clearInterval(timer);
  }, [listing, state]);

  const cancel = async () => {
    cancelled.current = true;
    setState("cancelling");
    const ok = USE_MOCK || (await run((ctx) => cancelListing(ctx, { ticketMint: new PublicKey(ticketMint) }), {
      pending: "Taking your listing down…",
      success: "Listing cancelled. The ticket is back in your wallet.",
    }));
    if (ok) onClose(false);
    else {
      cancelled.current = false;
      setState("waiting");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-5 overflow-y-auto bg-background p-6 text-center">
      {state === "sold" ? (
        <>
          <CheckCircle2 className="size-20 text-released" aria-hidden />
          <div>
            <p className="text-4xl font-bold tracking-tight">Sold!</p>
            <p className="mt-2 text-xl">{formatUsd(netUsd)} received</p>
            <p className="mt-1 text-sm text-muted-foreground">{title} · {seat}</p>
          </div>
          {soldSig && (
            <a href={explorerTx(soldSig)} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: "outline" })}>
              <ExternalLink /> View transaction
            </a>
          )}
          <Button size="lg" onClick={() => onClose(true)}>Done</Button>
        </>
      ) : (
        <>
          <div>
            <p className="text-sm text-muted-foreground">{title}</p>
            <p className="text-2xl font-bold tracking-tight">{seat} · {formatUsd(priceUsd)}</p>
          </div>
          <div ref={qrRef} className="rounded-2xl bg-white p-3 shadow-lg" aria-label="Solana Pay QR code" role="img" />
          <p className="max-w-xs text-sm text-muted-foreground">
            Scan with SeatSafe (<span className="font-medium text-foreground">Scan to buy</span>) or any Solana Pay wallet.
            Ticket and payment swap in one transaction.
          </p>
          <p className="flex items-center gap-2 text-sm">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            {USE_MOCK ? "Mock mode: nothing will be bought." : "Waiting for the buyer…"}
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              await navigator.clipboard.writeText(await payUrl(listing)).catch(() => undefined);
              toast.success("Link copied. Paste it into Scan to buy on another device.");
            }}
          >
            <Copy /> Copy link
          </Button>
          <Button variant="outline" disabled={state === "cancelling"} onClick={cancel}>
            {state === "cancelling" ? <Loader2 className="animate-spin" /> : <X />} Cancel sale
          </Button>
        </>
      )}
    </div>
  );
}
