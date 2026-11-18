"use client";

// Owner: A. SeatSafe Live Lab: the simulator driven by REAL devnet state.
// - Every number/padlock comes from lib/live-lab.ts snapshots (1 s poll, instant refresh on Supabase Realtime
//   order_events for this order). Animations play when the CHAIN changes, never on click.
// - Two drivers: "Two real users" (each window's logged-in Privy wallet signs via sendWithRelayer; the URL is
//   the shared session) or "Presenter" (server demo wallets via /api/sim/step).
// - Under the hood: each action's real layers (components/sim/XRay.tsx).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion, MotionConfig } from "motion/react";
import { Copy, ExternalLink, Loader2, Radio, Timer, UserRound } from "lucide-react";
import { PublicKey } from "@solana/web3.js";
import { snapshotTier1, snapshotTier2, xray, short, type LiveSnapshot } from "@/lib/live-lab";
import { buyPrimary, createEscrowListing, fundEscrow, listResale, refundExpired, releaseExpired, swapResale, type BuiltTx, type TxCtx } from "@/lib/program";
import { chainProgram, getMyTickets } from "@/lib/chain";
import { sendWithRelayer, useTxWallet } from "@/lib/tx";
import { friendlyError, programErrorName, TxError } from "@/lib/errors";
import { explorerAddress, USDC_MINT } from "@/lib/solana";
import { supabase } from "@/lib/supabase";
import { useNow } from "@/lib/use-chain";
import { MOTION, TONE, money } from "@/lib/design";
import { cn } from "@/lib/utils";
import bundledMeta from "@/lib/event-meta.json";
import { Persona } from "@/components/sim/Persona";
import { Vault, type VaultState } from "@/components/sim/Vault";
import { TicketCard } from "@/components/sim/TicketCard";
import { Coin, Flight, type Point } from "@/components/sim/Coin";
import { XRayPanel, StackStrip, freshLayers, type LayerKey, type Run, type StackKey } from "@/components/sim/XRay";
import { AuthButton } from "@/components/AuthButton";
import { Button } from "@/components/ui/button";

type Scenario = "fair" | "scam";
type Driver = "users" | "presenter";
type Role = "seller" | "buyer";
type Anchor = "seller" | "buyer" | "vault" | "seatsafe";

const ANCHORS: Record<Anchor, Point> = { seller: { x: 17, y: 62 }, buyer: { x: 83, y: 62 }, vault: { x: 50, y: 42 }, seatsafe: { x: 60, y: 95 } };
const EVENT_ID = Object.entries((bundledMeta as { events?: Record<string, { title?: string }> }).events ?? {}).find(([, m]) => /battle of the bands/i.test(m.title ?? ""))?.[0] ?? "";
const EVENT_TITLE = "Battle of the Bands";
const PRICE = { over: 50, resale: 14, escrow: 20, bond: 2, windowSecs: 60 };

interface FlightSpec {
  id: string;
  kind: "coin" | "ticket";
  amount?: number;
  label?: string;
  tone?: "vault" | "released" | "transit" | "disputed" | "neutral";
  from: Anchor;
  to: Anchor;
  delay?: number;
  outside?: boolean;
}

interface ActionDef {
  key: string;
  label: string;
  role: Role;
  expectFail?: boolean;
  presenter: string; // /api/sim/step action
  enabled: boolean;
  why?: string;
  build?: (ctx: TxCtx) => Promise<BuiltTx>;
  /** For "prepare" in two-user mode: custom flow. */
  custom?: () => Promise<void>;
  stack: StackKey[];
}

const STORAGE_W = 900;
function ScaledStage({ children }: { children: React.ReactNode }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ scale: 1, height: 0 });
  useEffect(() => {
    const o = outer.current;
    const i = inner.current;
    if (!o || !i) return;
    const ro = new ResizeObserver(() => {
      const scale = Math.min(1, o.clientWidth / STORAGE_W);
      setBox({ scale, height: i.offsetHeight * scale });
    });
    ro.observe(o);
    ro.observe(i);
    return () => ro.disconnect();
  }, []);
  const scaled = box.scale < 1;
  return (
    <div ref={outer} className="w-full" style={scaled ? { height: box.height } : undefined}>
      <div ref={inner} style={scaled ? { width: STORAGE_W, transform: `scale(${box.scale})`, transformOrigin: "top left" } : undefined}>{children}</div>
    </div>
  );
}

function LiveTag({ address, label = "live from Solana devnet" }: { address?: string | null; label?: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-white/50">
      <span className="relative flex size-1.5">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-released opacity-70" />
        <span className="relative inline-flex size-1.5 rounded-full bg-released" />
      </span>
      {address ? (
        <a href={explorerAddress(address)} target="_blank" rel="noopener noreferrer" className="underline decoration-white/20 underline-offset-2 hover:text-white">
          {label} · {short(address)}
        </a>
      ) : (
        label
      )}
    </span>
  );
}

export function LiveLab() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const scenario: Scenario = params.get("scenario") === "scam" ? "scam" : "fair";
  const driver: Driver = params.get("driver") === "presenter" ? "presenter" : "users";
  const role = (params.get("role") as Role | null) ?? null;
  const mint = params.get("mint");
  const escrow = params.get("escrow");
  const sellerParam = params.get("seller");
  const wallet = useTxWallet();
  const me = wallet?.address.toBase58() ?? null;
  const now = useNow();

  const setParams = useCallback(
    (patch: Record<string, string | null>) => {
      const p = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null) p.delete(k);
        else p.set(k, v);
      }
      router.replace(`${pathname}?${p.toString()}`, { scroll: false });
    },
    [params, pathname, router],
  );

  // Presenter wallets (server demo keys) and availability.
  const [presenter, setPresenter] = useState<{ enabled: boolean; reason?: string; seller?: string; buyer?: string } | null>(null);
  useEffect(() => {
    void fetch("/api/sim/step")
      .then((r) => r.json())
      .then((j) => setPresenter({ enabled: j.enabled, reason: j.reason, seller: j.balances?.sellerAddress, buyer: j.balances?.buyerAddress }))
      .catch(() => setPresenter({ enabled: false, reason: "Server unreachable" }));
  }, []);

  // Who is who.
  const [snap, setSnap] = useState<LiveSnapshot | null>(null);
  const [counterparty, setCounterparty] = useState<string | null>(null); // buyer learned from the Stream-fed orders table
  const seller =
    driver === "presenter" ? presenter?.seller ?? null : snap?.escrowSeller ?? snap?.listingSeller ?? sellerParam ?? (role === "seller" ? me : null);
  const buyer = driver === "presenter" ? presenter?.buyer ?? null : snap?.escrowBuyer ?? (role === "buyer" ? me : counterparty);

  // ---- Real state: 1 s poll + instant refresh on Realtime ----
  const prevRef = useRef<LiveSnapshot | null>(null);
  const [flights, setFlights] = useState<FlightSpec[]>([]);
  const [display, setDisplay] = useState<LiveSnapshot | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [slam, setSlam] = useState(false);

  const patchRun = useCallback((id: string, fn: (r: Run) => Run) => setRuns((rs) => rs.map((r) => (r.id === id ? fn(r) : r))), []);
  const layer = (r: Run, k: LayerKey, state: Run["layers"][LayerKey]["state"], at = Date.now()): Run => ({ ...r, layers: { ...r.layers, [k]: { state, at } } });

  const read = useCallback(async () => {
    try {
      if (scenario === "fair" && mint) return await snapshotTier1({ mint, seller, buyer });
      if (scenario === "scam" && escrow) return await snapshotTier2({ escrow, seller: driver === "presenter" ? seller : null, buyer: driver === "presenter" ? buyer : null });
    } catch {
      // RPC hiccup: keep the last snapshot
    }
    return null;
  }, [scenario, mint, escrow, seller, buyer, driver]);

  const refresh = useCallback(async () => {
    const s = await read();
    if (s) setSnap(s);
  }, [read]);

  // 1 s poll; on RPC errors (public devnet answers 429 under load) back off up to 8 s; pause while an action runs.
  const busyRef = useRef(false);
  const [rpcSlow, setRpcSlow] = useState(false);
  const hasTarget = scenario === "fair" ? Boolean(mint) : Boolean(escrow);
  useEffect(() => {
    let alive = true;
    let delay = 1000;
    let timer: ReturnType<typeof setTimeout>;
    const loop = async () => {
      if (!alive) return;
      if (document.visibilityState === "visible" && !busyRef.current && hasTarget) {
        const next = await read();
        if (!alive) return;
        if (next) {
          setSnap(next);
          delay = 1000;
        } else {
          delay = Math.min(8000, delay * 2);
        }
        setRpcSlow(delay > 1000);
      }
      timer = setTimeout(loop, delay);
    };
    timer = setTimeout(loop, 0);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [read, hasTarget]);

  // Order id for Realtime: escrow PDA (Tier 2) or listing PDA (Tier 1 swap order).
  const orderId = useMemo(() => {
    if (scenario === "scam") return escrow;
    if (!mint) return null;
    const program = chainProgram();
    return PublicKey.findProgramAddressSync([Buffer.from("listing"), new PublicKey(mint).toBuffer()], program.programId)[0].toBase58();
  }, [scenario, escrow, mint]);

  useEffect(() => {
    if (!supabase || !orderId) return;
    const db = supabase;
    const channel = db
      .channel(`livelab:${orderId}#${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "order_events", filter: `order_id=eq.${orderId}` }, (p) => {
        const sig = (p.new as { tx_signature?: string }).tx_signature;
        setRuns((rs) => rs.map((r) => (r.signature && r.signature === sig ? { ...r, realtimeAt: Date.now() } : r)));
        void refresh();
      })
      .subscribe();
    return () => {
      void db.removeChannel(channel);
    };
  }, [orderId, refresh]);

  // Tier 1 buyer for the seller's window: the Stream-fed orders row (orders.id = listing PDA).
  useEffect(() => {
    if (driver !== "users" || scenario !== "fair" || role === "buyer" || !orderId || !supabase || counterparty) return;
    if (!snap || snap.listingOpen || snap.ticket?.holder === "seller") return;
    void supabase.from("orders").select("buyer_id").eq("id", orderId).maybeSingle().then(({ data }) => {
      if (data?.buyer_id) setCounterparty(data.buyer_id as string);
    });
  }, [driver, scenario, role, orderId, snap, counterparty]);

  // ---- Chain changed → flights (then numbers) ----
  useEffect(() => {
    if (!snap) return;
    const prev = prevRef.current;
    prevRef.current = snap;
    const f: FlightSpec[] = [];
    if (prev) {
      if (scenario === "fair") {
        const a = prev.ticket?.holder;
        const b = snap.ticket?.holder;
        if (a === "seller" && b === "vault") f.push({ id: `t-list-${snap.slot}`, kind: "ticket", from: "seller", to: "vault" });
        if (a === "vault" && b === "buyer") {
          const price = prev.listingPriceUsd ?? PRICE.resale;
          const sellerGot = prev.sellerUsd != null && snap.sellerUsd != null ? Math.round((snap.sellerUsd - prev.sellerUsd) * 100) / 100 : Math.round(price * 0.97 * 100) / 100;
          f.push(
            { id: `c-pay-${snap.slot}`, kind: "coin", amount: price, label: "buyer pays", from: "buyer", to: "vault" },
            { id: `t-swap-${snap.slot}`, kind: "ticket", from: "vault", to: "buyer", delay: 0.05 },
            { id: `c-seller-${snap.slot}`, kind: "coin", amount: sellerGot, label: "to seller", tone: "released", from: "vault", to: "seller", delay: 1 },
            { id: `c-fee-${snap.slot}`, kind: "coin", amount: Math.round((price - sellerGot) * 100) / 100, label: "fee", tone: "neutral", from: "vault", to: "seatsafe", delay: 1.2 },
          );
        }
      } else {
        const a = prev.escrowState ?? null;
        const b = snap.escrowState ?? null;
        if (!a && b === "listed") f.push({ id: `c-bond-${snap.slot}`, kind: "coin", amount: snap.vaultUsd, label: "seller bond", tone: "transit", from: "seller", to: "vault" });
        if (a === "listed" && b === "funded") f.push({ id: `c-pay-${snap.slot}`, kind: "coin", amount: snap.vaultUsd - prev.vaultUsd, label: "buyer pays", from: "buyer", to: "vault" });
        if (a === "funded" && b === "refunded") f.push({ id: `c-refund-${snap.slot}`, kind: "coin", amount: prev.vaultUsd, label: "refund + bond", tone: "released", from: "vault", to: "buyer" });
        if (a === "funded" && b === "sent") f.push({ id: `t-sent-${snap.slot}`, kind: "ticket", from: "seller", to: "buyer", outside: true });
        if ((a === "sent" || a === "funded") && b === "completed") f.push({ id: `c-paid-${snap.slot}`, kind: "coin", amount: prev.vaultUsd, label: "to seller", tone: "released", from: "vault", to: "seller" });
      }
    }
    const t = setTimeout(() => {
      if (f.length) setFlights(f);
      else setDisplay(snap);
      // Mark "UI updated" on runs whose transaction this snapshot includes.
      setRuns((rs) => rs.map((r) => (r.x && !r.uiAt && snap.slot >= r.x.slot ? { ...layer(r, "ui", "done"), uiAt: Date.now() } : r)));
    }, 0);
    return () => clearTimeout(t);
  }, [snap, scenario]);

  useEffect(() => {
    if (flights.length === 0 && snap) {
      const t = setTimeout(() => setDisplay(snap), 0);
      return () => clearTimeout(t);
    }
  }, [flights.length, snap]);

  // ---- Running an action (both drivers) ----
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    busyRef.current = busy !== null;
  }, [busy]);
  const [notice, setNotice] = useState<string | null>(null);

  const watchStream = useCallback(
    async (id: string, sig: string, blockTime: number | null) => {
      patchRun(id, (r) => ({ ...layer(r, "stream", "active"), streamState: "waiting" }));
      for (let i = 0; i < 64; i++) {
        const j = await fetch(`/api/sim/stream?sig=${sig}`).then((r) => r.json()).catch(() => null);
        if (j?.delivered) {
          const secs = blockTime ? Math.max(0, (new Date(j.processedAt).getTime() - blockTime) / 1000) : null;
          patchRun(id, (r) => ({ ...layer(r, "stream", "done"), streamState: "done", streamSeconds: secs }));
          return;
        }
        await new Promise((res) => setTimeout(res, 700));
      }
      patchRun(id, (r) => ({ ...layer(r, "stream", "failed"), streamState: "timeout" }));
    },
    [patchRun],
  );

  const run = useCallback(
    async (a: ActionDef) => {
      setNotice(null);
      setBusy(a.key);
      const id = `${a.key}-${Date.now()}`;
      const who = `${a.role === "seller" ? "Seller" : "Buyer"}${driver === "presenter" ? (a.role === "seller" ? " (Sam)" : " (Bea)") : ""}`;
      const fresh: Run = { id, label: a.label, who, startedAt: Date.now(), layers: { ...freshLayers(), sign: { state: "active", at: Date.now() } } };
      setRuns((rs) => [fresh, ...rs].slice(0, 8));
      let signature: string | null = null;
      let blocked: Run["blocked"] = null;
      let signer: string | undefined;
      try {
        if (driver === "presenter") {
          const res = await fetch("/api/sim/step", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action: a.presenter, context: { ticketMint: mint ?? undefined, escrow: escrow ?? undefined } }),
          }).then((r) => r.json());
          if (res.context?.ticketMint && res.context.ticketMint !== mint) setParams({ mint: res.context.ticketMint });
          if (res.context?.escrow && res.context.escrow !== escrow) setParams({ escrow: res.context.escrow });
          signer = a.role === "seller" ? presenter?.seller : presenter?.buyer;
          if (res.ok) signature = res.signature ?? null;
          else if (res.errorName || a.expectFail) blocked = { errorName: res.errorName ?? "", message: res.message ?? "Rejected", logs: res.logs ?? [] };
          else throw new Error(res.needsFunding ?? res.message ?? "Step failed");
          if (!signature && res.ok) setNotice(res.message ?? "Ready.");
        } else {
          if (!wallet) throw new Error("Log in first.");
          signer = me ?? undefined;
          if (a.custom) {
            await a.custom();
          } else if (a.build) {
            const sent = await sendWithRelayer((payer) => a.build!({ program: chainProgram(), user: wallet.address, payer }), wallet);
            signature = sent.signature;
            if (sent.address && a.key === "list-escrow") setParams({ escrow: sent.address.toBase58(), seller: me });
          }
        }
      } catch (err) {
        if (err instanceof TxError && !err.signature) {
          blocked = { errorName: programErrorName(err) ?? "", message: friendlyError(err, { resaleCapUsd: 15 }).message, logs: err.logs.filter((l) => /Program log|failed|Error/.test(l)).slice(-6) };
        } else {
          setNotice(err instanceof Error ? err.message : String(err));
          patchRun(id, (r) => layer(r, "sign", "failed"));
          setBusy(null);
          return;
        }
      }
      setBusy(null);

      if (blocked) {
        patchRun(id, (r) => ({ ...layer(layer(layer(r, "sign", "skipped"), "relayer", "skipped"), "program", "failed"), blocked, signer }));
        if (scenario === "scam") {
          setSlam(true);
          setTimeout(() => setSlam(false), 2600);
        }
        return;
      }
      if (!signature) {
        patchRun(id, (r) => ({ ...layer(r, "sign", "done"), signer }));
        void refresh();
        return;
      }
      patchRun(id, (r) => ({ ...layer(r, "sign", "done"), signature, signer }));
      void refresh();
      const sig = signature;
      patchRun(id, (r) => layer(r, "relayer", "active"));
      const x = await xray(sig);
      if (!x) {
        setNotice("Confirmed, but the RPC hasn't returned the transaction yet.");
        return;
      }
      patchRun(id, (r) => {
        const at = x.blockTime ?? Date.now();
        let n: Run = { ...r, x };
        // The signature exists before the block: stamp signing with the block time, not when the reply arrived.
        n = layer(n, "sign", "done", Math.min(r.layers.sign.at ?? at, at));
        n = layer(n, "relayer", "done", at);
        n = layer(n, "program", "done", at);
        n = layer(n, "tokens", "done", at);
        n = layer(n, "event", x.events.length ? "done" : "skipped", at);
        return n;
      });
      void watchStream(id, sig, x.blockTime);
    },
    [driver, mint, escrow, presenter, wallet, me, scenario, setParams, patchRun, refresh, watchStream],
  );

  // ---- Actions per scenario ----
  const s = snap;
  const actions: ActionDef[] = useMemo(() => {
    const evt = EVENT_ID ? new PublicKey(EVENT_ID) : null;
    if (scenario === "fair") {
      const t = s?.ticket?.holder;
      return [
        {
          key: "prepare",
          label: mint ? "Pick another ticket" : "Prepare: get Sam's ticket",
          role: "seller",
          presenter: "a_prepare",
          enabled: true,
          stack: ["anchor", "token2022", "relayer"],
          custom: async () => {
            if (!me || !evt) return;
            const mine = (await getMyTickets(me)).filter((x) => x.eventId === EVENT_ID && x.tier === 1 && !x.listed);
            if (mine[0]) {
              setParams({ mint: mine[0].id, seller: me });
              setNotice(`Using your ticket ${mine[0].seatLabel}.`);
              return;
            }
            const ev = await chainProgram().account.event.fetch(evt);
            const sent = await sendWithRelayer((payer) => buyPrimary({ program: chainProgram(), user: wallet!.address, payer }, { event: evt, seat: `Lab GA ${ev.sold + 1}` }), wallet!);
            setParams({ mint: sent.address!.toBase58(), seller: me });
            setNotice("Bought a $10 ticket to resell.");
          },
        },
        { key: "list-over", label: `List at ${money(PRICE.over)}`, role: "seller", expectFail: true, presenter: "a_list_over", enabled: Boolean(mint) && t === "seller", why: "needs a ticket in the seller's wallet", stack: ["anchor", "token2022"], build: (c) => listResale(c, { ticketMint: new PublicKey(mint!), priceUsd: PRICE.over }) },
        { key: "list", label: `List at ${money(PRICE.resale)}`, role: "seller", presenter: "a_list", enabled: Boolean(mint) && t === "seller", why: "needs a ticket in the seller's wallet", stack: ["anchor", "token2022", "relayer"], build: (c) => listResale(c, { ticketMint: new PublicKey(mint!), priceUsd: PRICE.resale }) },
        { key: "buy", label: `Buy for ${money(s?.listingPriceUsd ?? PRICE.resale)}`, role: "buyer", presenter: "a_buy", enabled: Boolean(s?.listingOpen), why: "waits for the listing", stack: ["anchor", "token2022", "swap", "relayer"], build: (c) => swapResale(c, { ticketMint: new PublicKey(mint!) }) },
      ];
    }
    const st = s?.escrowState ?? null;
    const deadlinePassed = Boolean(s?.shipDeadline && now && now > s.shipDeadline);
    return [
      { key: "list-escrow", label: `List outside ticket ${money(PRICE.escrow)} + ${money(PRICE.bond)} bond`, role: "seller", presenter: "b_list", enabled: !escrow || st === "refunded" || st === "completed", why: "an order is already running", stack: ["anchor", "escrow", "relayer"], build: (c) => createEscrowListing(c, { priceUsd: PRICE.escrow, bondUsd: PRICE.bond, shipWindowSecs: PRICE.windowSecs, confirmWindowSecs: PRICE.windowSecs }) },
      { key: "pay", label: `Pay ${money(s?.priceUsd ?? PRICE.escrow)} into the vault`, role: "buyer", presenter: "b_fund", enabled: st === "listed", why: "waits for the listing", stack: ["anchor", "escrow", "relayer"], build: (c) => fundEscrow(c, { escrow: new PublicKey(escrow!) }) },
      { key: "withdraw", label: "Try to withdraw the money", role: "seller", expectFail: true, presenter: "b_steal", enabled: st === "funded", why: "after the buyer pays", stack: ["anchor", "escrow"], build: (c) => releaseExpired(c, { escrow: new PublicKey(escrow!) }) },
      { key: "refund", label: deadlinePassed ? "Claim refund" : "Claim refund (too early)", role: "buyer", presenter: "b_refund", enabled: st === "funded", why: "after the buyer pays", stack: ["anchor", "escrow", "relayer"], build: (c) => refundExpired(c, { escrow: new PublicKey(escrow!) }) },
    ];
  }, [scenario, s, mint, escrow, me, now, wallet, setParams]);

  // Stack strip: what the latest run used.
  const latest = runs[0];
  const active = useMemo(() => {
    const set = new Set<StackKey>();
    if (!latest) return set;
    const def = actions.find((a) => latest.label === a.label);
    def?.stack.forEach((k) => set.add(k));
    if (driver === "users") set.add("privy");
    if (latest.streamState === "done") set.add("quicknode");
    if (latest.realtimeAt) set.add("realtime");
    if (latest.blocked) set.delete("relayer");
    return set;
  }, [latest, actions, driver]);

  // ---- Visual state from the displayed (landed) snapshot ----
  const d = display;
  const ticketAt: Anchor | "hidden" =
    scenario === "fair"
      ? d?.ticket?.holder === "seller" || d?.ticket?.holder === "vault" || d?.ticket?.holder === "buyer" ? d.ticket.holder : "hidden"
      : d?.escrowState === "sent" || d?.escrowState === "completed" ? "buyer" : d?.escrowState ? "seller" : "hidden";
  const ticketFlying = flights.some((f) => f.kind === "ticket");
  const vaultState: VaultState = slam
    ? "slammed"
    : scenario === "scam"
      ? d?.escrowState === "listed" || d?.escrowState === "funded" || d?.escrowState === "sent" ? "holding" : d?.escrowState === "refunded" || d?.escrowState === "completed" ? "open" : "idle"
      : d?.ticket?.holder === "vault" ? "holding" : "idle";
  const lock = d?.ticket?.frozen === false ? "unlocked" : "locked";
  const ticketNode = (at: Anchor) =>
    ticketAt === at && !ticketFlying ? (
      <div className="flex flex-col items-center gap-1">
        <TicketCard event={EVENT_TITLE} seat={scenario === "fair" ? "Lawn GA" : "Lawn GA (outside, PDF)"} lock={lock} outside={scenario === "scam"} glow size={at === "vault" ? "sm" : "md"} price={scenario === "fair" && at === "vault" ? d?.listingPriceUsd : undefined} />
        {scenario === "fair" && d?.ticket?.account && <LiveTag address={d.ticket.account} label={d.ticket.frozen ? "frozen token account" : "token account"} />}
      </div>
    ) : null;
  const secondsLeft = d?.escrowState === "funded" && d.shipDeadline && now ? Math.max(0, Math.ceil((d.shipDeadline - now) / 1000)) : null;
  const lastBlocked = latest?.blocked && (now === 0 || now - latest.startedAt < 8000) ? latest.blocked : null;
  const banner = lastBlocked
    ? { tone: "disputed" as const, title: "Blocked by the program", text: `${lastBlocked.message.replace(/^Blocked by the program:\s*/i, "")}${lastBlocked.errorName ? ` (${lastBlocked.errorName})` : ""}` }
    : scenario === "fair" && d?.ticket?.holder === "buyer"
      ? { tone: "released" as const, title: "Done in one transaction", text: "Ticket and payment swapped atomically. The ticket is frozen again in the buyer's wallet (real account state)." }
      : scenario === "scam" && d?.escrowState === "refunded"
        ? { tone: "released" as const, title: "Scam stopped", text: `The vault paid the buyer back ${money((d.priceUsd ?? 0) + (d.bondUsd ?? 0))}, including the seller's bond.` }
        : null;

  const myRoleActions = driver === "presenter" ? actions : actions.filter((a) => a.role === role);
  const shareLink = typeof window === "undefined" ? "" : (() => {
    const p = new URLSearchParams({ scenario, ...(mint ? { mint } : {}), ...(escrow ? { escrow } : {}), ...(seller ? { seller } : {}), role: role === "seller" ? "buyer" : "seller" });
    return `${window.location.origin}${pathname}?${p.toString()}`;
  })();
  const fundHint =
    driver === "users" && role
      ? scenario === "fair"
        ? role === "seller" ? "Seller needs a Battle of the Bands ticket (Prepare buys one for $10)." : `Buyer needs ${money(PRICE.resale)} USDC.`
        : role === "seller" ? `Seller needs ${money(PRICE.bond)} USDC for the bond.` : `Buyer needs ${money(PRICE.escrow)} USDC.`
      : null;

  return (
    <MotionConfig reducedMotion="user">
      <section className="mx-auto w-full max-w-7xl px-3 py-4 md:px-6 md:py-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight md:text-3xl">
              SeatSafe Live Lab <span className="inline-flex items-center gap-1 rounded-full bg-released/20 px-2 py-0.5 text-xs font-semibold text-released"><Radio className="size-3" /> devnet</span>
            </h1>
            <p className="text-sm text-white/70">Every number, padlock and coin on this screen is read from Solana, after confirmation.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <div className="flex items-center gap-1 rounded-full border border-white/15 bg-card p-1" role="group" aria-label="Who signs">
              <button type="button" onClick={() => setParams({ driver: null })} className={cn("rounded-full px-3 py-1.5 font-semibold", driver === "users" && "bg-white text-black")}>Two real users</button>
              <button type="button" disabled={!presenter?.enabled} title={presenter?.enabled ? "Server demo wallets sign" : presenter?.reason} onClick={() => setParams({ driver: "presenter", role: null })} className={cn("rounded-full px-3 py-1.5 font-semibold disabled:opacity-40", driver === "presenter" && "bg-vault text-black")}>Presenter</button>
            </div>
          </div>
        </div>

        {/* Scenario */}
        <div className="mt-4 grid grid-cols-2 gap-2" role="tablist" aria-label="Scenario">
          {([["fair", "A · Fair resale", "Tier 1 · atomic swap, capped"], ["scam", "B · Scam stopped", "Tier 2 · escrow vault, refund"]] as const).map(([id, name, sub]) => (
            <button
              key={id}
              role="tab"
              aria-selected={scenario === id}
              type="button"
              onClick={() => setParams({ scenario: id, mint: null, escrow: null, seller: null })}
              className={cn("rounded-2xl border px-4 py-3 text-left", scenario === id ? (id === "scam" ? "border-disputed bg-disputed/10 glow-disputed" : "border-vault bg-vault/10 glow-vault") : "border-white/10 bg-card")}
            >
              <p className="font-bold">{name}</p>
              <p className="text-xs text-white/60">{sub}</p>
            </button>
          ))}
        </div>

        {/* Role (two users) */}
        {driver === "users" && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-card p-3 text-sm">
            <UserRound className="size-4 text-white/60" />
            {!me ? (
              <>
                <span>Log in, then join as Seller in one window and Buyer in another.</span>
                <AuthButton />
              </>
            ) : (
              <>
                <span>You are <b className="font-mono">{short(me)}</b>. Join as:</span>
                {(["seller", "buyer"] as const).map((r) => (
                  <Button key={r} size="sm" variant={role === r ? "default" : "outline"} onClick={() => setParams({ role: r, ...(r === "seller" && !sellerParam ? { seller: me } : {}) })}>
                    {r === "seller" ? "Seller" : "Buyer"}
                  </Button>
                ))}
                {role && (
                  <button type="button" className="ml-auto inline-flex items-center gap-1 rounded-full border border-white/20 px-3 py-1 text-xs hover:bg-[#1d1d24]" onClick={() => void navigator.clipboard.writeText(shareLink)}>
                    <Copy className="size-3" /> Copy link for the {role === "seller" ? "buyer" : "seller"}&apos;s window
                  </button>
                )}
              </>
            )}
          </div>
        )}

        <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_22rem]">
          <div>
            {/* Stage */}
            <ScaledStage>
              <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-[radial-gradient(ellipse_at_50%_-10%,#3a1013_0%,transparent_55%),linear-gradient(180deg,#121217,#0b0b0f)] p-4 md:p-6">
                <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-4">
                  <div className="flex flex-col items-center gap-1">
                    <Persona name="Seller" role={seller ? short(seller) : "not joined yet"} initial="S" usdc={d?.sellerUsd ?? 0} tone={lastBlocked && latest?.who.startsWith("Seller") ? "disputed" : "neutral"}>
                      {ticketNode("seller")}
                    </Persona>
                    {seller && <LiveTag address={seller} />}
                  </div>
                  <div className="flex flex-col items-center gap-2 pt-2">
                    <Vault balance={d?.vaultUsd ?? 0} state={vaultState} label={scenario === "scam" ? "Escrow vault" : "Listing vault"}>{ticketNode("vault")}</Vault>
                    {d?.vaultAccount && <LiveTag address={d.vaultAccount} label={scenario === "scam" ? "vault USDC account" : "listing vault"} />}
                    {secondsLeft !== null && (
                      <div className={cn("flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-bold", secondsLeft > 0 ? "border-transit/60 text-transit" : "border-disputed/60 text-disputed")} title="From the escrow's onchain ship_deadline">
                        <Timer className="size-4" /> {secondsLeft > 0 ? `Seller must send it: ${secondsLeft}s` : "Deadline passed (onchain)"}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col items-center gap-1">
                    <Persona name="Buyer" role={buyer ? short(buyer) : "not joined yet"} initial="B" usdc={d?.buyerUsd ?? 0} tone={banner?.tone === "released" ? "released" : "neutral"}>
                      {ticketNode("buyer")}
                    </Persona>
                    {buyer && <LiveTag address={buyer} />}
                  </div>
                </div>
                <p className="mt-3 text-center text-[11px] text-white/50">
                  {snap ? <>slot {snap.slot.toLocaleString()} · read {now ? Math.max(0, Math.round((now - snap.at) / 1000)) : 0}s ago{rpcSlow && <span className="text-transit"> · RPC busy, slowing down</span>}</> : scenario === "fair" ? "Prepare a ticket to start." : "List an outside ticket to start."}
                </p>

                {flights.map((f) => (
                  <Flight key={f.id} from={ANCHORS[f.from]} to={ANCHORS[f.to]} delay={f.delay} arc={f.kind === "ticket" ? -20 : -12} onDone={() => setFlights((fs) => fs.filter((x) => x.id !== f.id))}>
                    {f.kind === "coin" ? <Coin amount={f.amount ?? 0} label={f.label} tone={f.tone ?? "vault"} /> : <TicketCard event={EVENT_TITLE} seat="Lawn GA" lock={f.outside ? "unlocked" : "unlocking"} outside={f.outside} size="sm" glow />}
                  </Flight>
                ))}

                <AnimatePresence>
                  {banner && flights.length === 0 && (
                    <motion.div
                      key={banner.title}
                      initial={{ opacity: 0, scale: 0.85, y: 10 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      transition={MOTION.dramatic}
                      className={cn("absolute inset-x-3 top-3 z-40 mx-auto max-w-xl rounded-2xl border-2 overlay-white px-4 py-3 text-center", TONE[banner.tone].border, TONE[banner.tone].glow)}
                      role="status"
                    >
                      <p className={cn("text-xl font-extrabold md:text-2xl", TONE[banner.tone].text)}>{banner.title}</p>
                      <p className="mt-1 text-sm text-[#3f3f46]">{banner.text}</p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </ScaledStage>

            {/* Actions */}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {driver === "users" && !role ? (
                <p className="text-sm text-white/60">Choose Seller or Buyer above to get your buttons.</p>
              ) : (
                myRoleActions.map((a) => (
                  <Button
                    key={a.key}
                    size="lg"
                    variant={a.expectFail ? "outline" : "default"}
                    className={cn(a.expectFail && "border-disputed/60 text-disputed hover:bg-disputed/10")}
                    disabled={Boolean(busy) || !a.enabled}
                    title={!a.enabled ? a.why : driver === "presenter" ? `${a.role === "seller" ? "Sam" : "Bea"} signs (server demo wallet)` : "Your Privy wallet signs; the relayer pays gas"}
                    onClick={() => void run(a)}
                  >
                    {busy === a.key && <Loader2 className="animate-spin" />}
                    {driver === "presenter" && <span className="text-xs opacity-70">{a.role === "seller" ? "Sam:" : "Bea:"}</span>}
                    {a.label}
                  </Button>
                ))
              )}
            </div>
            {(notice || fundHint) && <p className={cn("mt-2 text-sm", notice ? "rounded-xl border border-transit/40 bg-transit/10 px-3 py-2" : "text-white/50")}>{notice ?? fundHint}</p>}
          </div>

          <XRayPanel
            runs={runs}
            usdcMint={USDC_MINT.toBase58()}
            labelOf={(addr) => (addr === seller ? "seller" : addr === buyer ? "buyer" : addr === d?.vaultAccount || addr === escrow ? "vault" : addr === "2VHBVmwU6C5NLdKjpykvJdGYWoSUw5uHAq3EKTbLHTqv" ? "SeatSafe fee" : short(addr))}
          />
        </div>

        <div className="mt-4">
          <StackStrip active={active} />
        </div>
        <p className="mt-3 flex items-center gap-1 text-[11px] text-white/40">
          <ExternalLink className="size-3" /> Explorer links on every live number. Seller/buyer actions are real devnet transactions; nothing on this page is scripted.
        </p>
      </section>
    </MotionConfig>
  );
}
