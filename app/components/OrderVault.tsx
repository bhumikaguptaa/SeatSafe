"use client";

// Owner: A. The escrow vault on /orders/[id], driven by REAL data: the vault's USDC token account balance and
// the escrow's onchain state (lib/live-lab.ts snapshotTier2; 1 s poll with backoff + instant refresh on Supabase
// Realtime order_events). Coins only animate when the chain changes. Buyer actions: "Got my ticket"
// (confirm_receipt) and "Claim refund" after the onchain ship deadline (refund_expired), via useOrderActions.
// Inserted above D's tracker with one marked line in app/orders/[id]/page.tsx.

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { CheckCircle2, Loader2, RotateCcw, Timer } from "lucide-react";
import { PublicKey } from "@solana/web3.js";
import { snapshotTier2, short, type LiveSnapshot } from "@/lib/live-lab";
import { USE_MOCK } from "@/lib/chain";
import { supabase } from "@/lib/supabase";
import { useTxWallet } from "@/lib/tx";
import { useNow } from "@/lib/use-chain";
import { explorerAddress } from "@/lib/solana";
import { money } from "@/lib/design";
import { Vault, type VaultState } from "@/components/sim/Vault";
import { Coin, Flight, type Point } from "@/components/sim/Coin";
import { useOrderActions } from "@/components/OrderActions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const isKey = (v: string) => {
  try {
    return Boolean(new PublicKey(v));
  } catch {
    return false;
  }
};
const P: Record<"buyer" | "vault" | "seller", Point> = { buyer: { x: 14, y: 50 }, vault: { x: 50, y: 46 }, seller: { x: 86, y: 50 } };

export function OrderVault() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  if (USE_MOCK || !isKey(id)) return null;
  return <OrderVaultInner id={id} />;
}

function OrderVaultInner({ id }: { id: string }) {
  const wallet = useTxWallet();
  const me = wallet?.address.toBase58() ?? null;
  const now = useNow();
  const actions = useOrderActions(id);
  const [snap, setSnap] = useState<LiveSnapshot | null>(null);
  const [shown, setShown] = useState<LiveSnapshot | null>(null);
  const [flight, setFlight] = useState<{ key: string; from: keyof typeof P; to: keyof typeof P; amount: number; label: string } | null>(null);
  const [auto, setAuto] = useState<boolean | null>(null);
  const prev = useRef<LiveSnapshot | null>(null);

  // 1 s poll, backing off on RPC errors.
  useEffect(() => {
    let alive = true;
    let delay = 1000;
    let t: ReturnType<typeof setTimeout>;
    const loop = async () => {
      if (!alive) return;
      if (document.visibilityState === "visible") {
        const s = await snapshotTier2({ escrow: id, seller: null, buyer: null }).catch(() => null);
        if (!alive) return;
        if (s) {
          setSnap(s);
          delay = 1000;
        } else delay = Math.min(8000, delay * 2);
      }
      t = setTimeout(loop, delay);
    };
    t = setTimeout(loop, 0);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [id]);

  // Realtime: the QuickNode Stream wrote an order_event for this order → read the chain now.
  useEffect(() => {
    if (!supabase) return;
    const db = supabase;
    const ch = db
      .channel(`order-vault:${id}#${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "order_events", filter: `order_id=eq.${id}` }, () => {
        void snapshotTier2({ escrow: id, seller: null, buyer: null }).then((s) => s && setSnap(s)).catch(() => undefined);
      })
      .subscribe();
    return () => {
      void db.removeChannel(ch);
    };
  }, [id]);

  // Chain changed → coin flight, then numbers.
  useEffect(() => {
    if (!snap) return;
    const p = prev.current;
    prev.current = snap;
    const t = setTimeout(() => {
      if (p && snap.vaultUsd !== p.vaultUsd) {
        const into = snap.vaultUsd > p.vaultUsd;
        const to: keyof typeof P = into ? "vault" : snap.escrowState === "refunded" ? "buyer" : "seller";
        setFlight({ key: `${snap.slot}`, from: into ? "buyer" : "vault", to, amount: Math.abs(snap.vaultUsd - p.vaultUsd), label: into ? "payment" : to === "buyer" ? "refund" : "to seller" });
      } else setShown(snap);
    }, 0);
    return () => clearTimeout(t);
  }, [snap]);

  // Paid automatically? (Stream-fed order_events: RELEASED without a CONFIRMED = buyer never responded.)
  useEffect(() => {
    if (snap?.escrowState !== "completed" || !supabase || auto !== null) return;
    void supabase.from("order_events").select("type").eq("order_id", id).then(({ data }) => {
      const types = new Set((data ?? []).map((r) => r.type as string));
      setAuto(types.has("RELEASED") && !types.has("CONFIRMED"));
    });
  }, [snap?.escrowState, id, auto]);

  const d = shown ?? snap;
  if (!d) return <div className="mb-4 h-48 animate-pulse rounded-2xl bg-card" />;
  const st = d.escrowState;
  const vaultState: VaultState = st === "funded" || st === "sent" || st === "disputed" ? "holding" : st === "refunded" || st === "completed" || st === "resolved" ? "open" : "idle";
  const deadline = st === "funded" ? d.shipDeadline : st === "sent" ? d.confirmDeadline : null;
  const left = deadline && now ? Math.max(0, Math.ceil((deadline - now) / 1000)) : null;
  const isBuyer = me !== null && me === d.escrowBuyer;
  const shipPassed = st === "funded" && left === 0;

  const message =
    st === "listed" ? "Waiting for a buyer. Nothing in the vault yet."
    : st === "funded" ? (shipPassed ? "The seller missed the deadline. The buyer can claim a full refund." : "Payment locked in the vault. The seller can't touch it.")
    : st === "sent" ? "The seller says the ticket was sent. The buyer confirms (or opens a dispute) before the window ends."
    : st === "refunded" ? "Refunded: the seller never sent the ticket, so the vault paid the buyer back."
    : st === "completed" ? (auto ? "Seller paid automatically: buyer didn't respond." : auto === false ? "Buyer confirmed the ticket. The vault paid the seller." : "Completed: the vault paid the seller.")
    : st === "disputed" ? "In dispute: funds stay locked until the arbiter decides."
    : st === "cancelled" ? "The seller cancelled the listing."
    : "Settled.";

  return (
    <section className="mb-4 rounded-2xl border border-border bg-card p-4" aria-label="Escrow vault">
      <div className="relative">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <div className="text-center text-sm">
            <p className="font-semibold">Buyer</p>
            {d.escrowBuyer ? <a className="text-xs text-muted-foreground underline underline-offset-2" href={explorerAddress(d.escrowBuyer)} target="_blank" rel="noopener noreferrer">{short(d.escrowBuyer)}{isBuyer ? " (you)" : ""}</a> : <p className="text-xs text-muted-foreground">no buyer yet</p>}
            {d.buyerUsd != null && <p className="num mt-1 text-lg font-bold">{money(d.buyerUsd)}</p>}
          </div>
          <Vault balance={d.vaultUsd} state={vaultState} label="Escrow vault" />
          <div className="text-center text-sm">
            <p className="font-semibold">Seller</p>
            {d.escrowSeller && <a className="text-xs text-muted-foreground underline underline-offset-2" href={explorerAddress(d.escrowSeller)} target="_blank" rel="noopener noreferrer">{short(d.escrowSeller)}{me === d.escrowSeller ? " (you)" : ""}</a>}
            {d.sellerUsd != null && <p className="num mt-1 text-lg font-bold">{money(d.sellerUsd)}</p>}
          </div>
        </div>
        {flight && (
          <Flight key={flight.key} from={P[flight.from]} to={P[flight.to]} onDone={() => { setFlight(null); setShown(snap); }}>
            <Coin amount={flight.amount} label={flight.label} tone={flight.to === "vault" ? "vault" : "released"} />
          </Flight>
        )}
      </div>

      <p className={cn("mt-3 text-center text-sm font-medium", st === "refunded" || st === "completed" ? "text-released" : shipPassed ? "text-disputed" : "")}>
        {st === "completed" || st === "refunded" ? <CheckCircle2 className="mr-1 inline size-4" /> : null}
        {message}
      </p>
      {left !== null && (
        <p className={cn("mt-1 flex items-center justify-center gap-1 text-xs", left > 0 ? "text-transit" : "text-disputed")}>
          <Timer className="size-3.5" />
          {left > 0 ? `${st === "funded" ? "Seller must send it" : "Buyer can confirm"} within ${left}s (onchain deadline)` : st === "funded" ? "Ship deadline passed (onchain)" : "Confirm window ended: anyone can release payment to the seller"}
        </p>
      )}

      {isBuyer && (st === "sent" || st === "funded") && (
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          {st === "sent" && (
            <Button onClick={() => void actions.onConfirm()} disabled={actions.busy !== null}>
              {actions.busy === "confirm" ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} Got my ticket
            </Button>
          )}
          {st === "funded" && (
            <Button variant={shipPassed ? "default" : "outline"} onClick={() => void actions.claimRefund()} disabled={actions.busy !== null || !shipPassed} title={shipPassed ? "" : "Available after the ship deadline"}>
              {actions.busy === "refund" ? <Loader2 className="animate-spin" /> : <RotateCcw />} Claim refund
            </Button>
          )}
        </div>
      )}
      <p className="mt-3 text-center text-[11px] text-muted-foreground">
        Protects both sides: refund if the seller never sends · seller paid automatically if the buyer goes silent after it&apos;s sent · disputes go to an arbiter.
        {d.vaultAccount && <> · <a href={explorerAddress(d.vaultAccount)} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">vault account</a> (live from devnet)</>}
      </p>
    </section>
  );
}
