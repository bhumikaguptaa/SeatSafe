"use client";

// Owner: A. Resale Simulator: two people trading a ticket, with every padlock, coin and vault movement
// animated so a non-crypto judge sees what SeatSafe does. Scenarios: fair resale (Tier 1 atomic swap),
// seller tries to scam (Tier 2 escrow → refund), honest outside sale.
// Modes: Simulated (scripted, no network, default) and Live on devnet (/api/sim/step runs each step as a real
// transaction between two demo wallets; rejections come from the real program).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, MotionConfig, useReducedMotion } from "motion/react";
import { ChevronLeft, ChevronRight, Loader2, Pause, Play, Radio, RotateCcw, Timer } from "lucide-react";
import { buildSteps, SCENARIOS, SIMULATED_TERMS, type Anchor, type Frame, type LiveAction, type ScenarioId, type Terms } from "./scenarios";
import { Persona } from "@/components/sim/Persona";
import { Vault } from "@/components/sim/Vault";
import { TicketCard } from "@/components/sim/TicketCard";
import { Coin, Flight, type Point } from "@/components/sim/Coin";
import { StepRail } from "@/components/sim/StepRail";
import { TxBadge } from "@/components/sim/TxBadge";
import { MOTION, SHAKE_X, TONE, money } from "@/lib/design";
import { cn } from "@/lib/utils";
import { useNow } from "@/lib/use-chain";
import { Button } from "@/components/ui/button";

/** Live mode uses the real devnet event: Battle of the Bands ($15 cap, 0% royalty). */
const LIVE_TERMS: Terms = { ...SIMULATED_TERMS, event: "Battle of the Bands", seat: "Lawn GA", royaltyBps: 0 };

/** Stage anchors in % of the stage box (match the 3-column layout below). */
const ANCHORS: Record<Anchor, Point> = {
  seller: { x: 17, y: 66 },
  buyer: { x: 83, y: 66 },
  vault: { x: 50, y: 44 },
  artist: { x: 33, y: 95 },
  seatsafe: { x: 67, y: 95 },
};

interface LogEntry {
  step: string;
  signature: string | null;
  failed?: boolean;
  note?: string;
}
interface LiveBalances {
  seller: number;
  buyer: number;
  relayerSol: number;
  sellerAddress: string;
  buyerAddress: string;
}

/** The stage is designed at 900 px; on narrower screens it scales down as a whole (flights use % so they still line up). */
const STAGE_W = 900;
function ScaledStage({ children }: { children: React.ReactNode }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ scale: 1, height: 0 });
  useEffect(() => {
    const o = outer.current;
    const i = inner.current;
    if (!o || !i) return;
    const measure = () => {
      const scale = Math.min(1, o.clientWidth / STAGE_W);
      setBox({ scale, height: i.offsetHeight * scale });
    };
    const ro = new ResizeObserver(measure);
    ro.observe(o);
    ro.observe(i);
    return () => ro.disconnect();
  }, []);
  const scaled = box.scale < 1;
  return (
    <div ref={outer} className="w-full overflow-hidden" style={scaled ? { height: box.height } : undefined}>
      <div ref={inner} style={scaled ? { width: STAGE_W, transform: `scale(${box.scale})`, transformOrigin: "top left" } : undefined}>
        {children}
      </div>
    </div>
  );
}

export function SimulatedLab() {
  const reduced = useReducedMotion() ?? false;
  const [scenario, setScenario] = useState<ScenarioId>("fair");
  const [live, setLive] = useState(false);
  const [liveInfo, setLiveInfo] = useState<{ enabled: boolean; reason?: string; balances?: LiveBalances | null } | null>(null);
  const terms = live ? LIVE_TERMS : SIMULATED_TERMS;
  const steps = useMemo(() => buildSteps(scenario, terms), [scenario, terms]);
  const [index, setIndex] = useState(0);
  const [flying, setFlying] = useState<string[]>([]); // flight ids in the air
  const [log, setLog] = useState<LogEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [auto, setAuto] = useState(false);
  const [liveBanner, setLiveBanner] = useState<string | null>(null);
  const [balances, setBalances] = useState<LiveBalances | null>(null);
  const [deadline, setDeadline] = useState<number | null>(null); // ms epoch (live) for the ship countdown
  const [ffLeft, setFfLeft] = useState<number | null>(null); // simulated fast-forward seconds left
  const ctxRef = useRef<{ ticketMint?: string; escrow?: string }>({});
  const now = useNow(); // 0 until mounted, then every second

  const step = steps[index];
  const frame: Frame = step.frame;

  // Live availability (server decides).
  useEffect(() => {
    void fetch("/api/sim/step")
      .then((r) => r.json())
      .then((j) => {
        setLiveInfo(j);
        if (j.balances) setBalances(j.balances);
      })
      .catch(() => setLiveInfo({ enabled: false, reason: "Couldn't reach the server." }));
  }, []);

  const startFlights = useCallback((f: Frame) => {
    setFlying(f.flights.map((x) => x.id));
  }, []);

  const reset = useCallback((nextScenario = scenario) => {
    setScenario(nextScenario);
    setIndex(0);
    setFlying([]);
    setLog([]);
    setError(null);
    setLiveBanner(null);
    setDeadline(null);
    setFfLeft(null);
    setAuto(false);
    ctxRef.current = {};
  }, [scenario]);

  // Simulated fast-forward of the 60 s window (5 s on screen).
  useEffect(() => {
    if (ffLeft === null || ffLeft <= 0) return;
    const id = setTimeout(() => setFfLeft((s) => (s === null ? null : Math.max(0, s - 12))), 1000);
    return () => clearTimeout(id);
  }, [ffLeft]);

  const secondsLeft = useMemo(() => {
    if (live && deadline) return now ? Math.max(0, Math.ceil((deadline - now) / 1000)) : null;
    if (ffLeft !== null) return ffLeft;
    return frame.countdown ?? null;
  }, [live, deadline, ffLeft, frame.countdown, now]);

  const go = useCallback(async (to: number) => {
    setError(null);
    setLiveBanner(null);
    if (to <= index) {
      setIndex(Math.max(0, to));
      setFlying([]);
      return;
    }
    const next = steps[to];
    // Deadline step: simulated = fast-forward animation first; live = wait for the real deadline.
    if (next.waitForDeadline) {
      if (live) {
        if (!deadline || (secondsLeft ?? 1) > 0) {
          setError(`Waiting for the real deadline: ${secondsLeft ?? "…"} s left.`);
          return;
        }
      } else if (ffLeft === null) {
        setFfLeft(60);
        await new Promise((r) => setTimeout(r, reduced ? 0 : 5200));
        setFfLeft(0);
      }
    }
    if (live && next.live) {
      setBusy(true);
      const res = await fetch("/api/sim/step", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: next.live.action as LiveAction, context: ctxRef.current }),
      }).then((r) => r.json()).catch(() => ({ ok: false, message: "Couldn't reach the server." }));
      setBusy(false);
      if (res.balances) setBalances(res.balances);
      if (res.context) ctxRef.current = { ...ctxRef.current, ...res.context };
      if (res.shipDeadline) setDeadline(new Date(res.shipDeadline).getTime());
      const expectFail = Boolean(next.live.expectFail);
      if (res.ok === expectFail) {
        // Unexpected: a planned rejection went through, or a real step failed.
        setError(res.needsFunding ?? res.message ?? (expectFail ? "Expected the program to refuse this, but it went through." : "Step failed."));
        if (res.signature) setLog((l) => [...l, { step: next.title, signature: res.signature, failed: !res.ok }]);
        return;
      }
      setLog((l) => [...l, { step: next.title, signature: res.signature ?? null, failed: !res.ok, note: res.errorName }]);
      if (!res.ok && res.message) setLiveBanner(res.message);
    } else if (!live && next.live) {
      setLog((l) => [...l, { step: next.title, signature: null, failed: Boolean(next.live?.expectFail) }]);
    }
    setIndex(to);
    startFlights(next.frame);
  }, [index, steps, live, deadline, secondsLeft, ffLeft, reduced, startFlights]);

  // Auto-play (simulated only).
  useEffect(() => {
    if (!auto || live || busy) return;
    if (index >= steps.length - 1) {
      const id = setTimeout(() => setAuto(false), 0);
      return () => clearTimeout(id);
    }
    const id = setTimeout(() => void go(index + 1), steps[index + 1]?.waitForDeadline ? 1500 : 4200);
    return () => clearTimeout(id);
  }, [auto, live, busy, index, steps, go]);

  // Numbers only change when the coins land: while flights are in the air, show the previous frame's money.
  const prev = index > 0 ? steps[index - 1].frame : null;
  const money$ = flying.length > 0 && prev ? prev : frame;
  // Live mode: Sam/Bea are the real demo wallets (updated after each confirmed transaction).
  const sellerUsd = live && balances ? balances.seller : money$.seller;
  const buyerUsd = live && balances ? balances.buyer : money$.buyer;
  const delta = (who: "seller" | "buyer") => (prev && !live && flying.length === 0 ? { amount: Math.round((frame[who] - prev[who]) * 100) / 100, key: `${scenario}-${index}-${who}` } : null);

  const ticketFlying = flying.some((id) => frame.flights.find((f) => f.id === id)?.kind === "ticket");
  const ticketNode = (at: Anchor) =>
    frame.ticket.at === at && !ticketFlying ? (
      <motion.div
        key={`${at}-${index}`}
        animate={frame.cap && frame.cap.price > frame.cap.cap && at === "seller" && !reduced ? { x: SHAKE_X } : { x: 0 }}
        transition={MOTION.shake}
      >
        <TicketCard
          event={terms.event}
          seat={frame.ticket.outside ? terms.outsideSeat : terms.seat}
          price={frame.cap ? frame.cap.price : undefined}
          lock={frame.ticket.lock}
          outside={frame.ticket.outside}
          glow
          size={at === "vault" ? "sm" : "md"}
        />
      </motion.div>
    ) : null;

  const banner = liveBanner
    ? { tone: "disputed" as const, title: "Blocked by the program", text: liveBanner }
    : frame.banner;
  const lastSig = [...log].reverse().find((l) => l.signature)?.signature ?? null;

  return (
    <MotionConfig reducedMotion="user">
      <section className="mx-auto w-full max-w-6xl px-3 py-4 md:px-6 md:py-6">
        {/* Header */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight md:text-3xl">SeatSafe Live Lab · offline backup</h1>
            <p className="text-sm text-white/70">Two people trade a ticket. Watch where the money and the ticket go.</p>
          </div>
          <div className="flex items-center gap-1 rounded-full border border-white/15 bg-black/30 p-1 text-xs" role="group" aria-label="Mode">
            <button type="button" onClick={() => { setLive(false); reset(); }} className={cn("rounded-full px-3 py-1.5 font-semibold", !live && "bg-white text-black")}>Simulated</button>
            <button
              type="button"
              disabled={!liveInfo?.enabled}
              title={liveInfo?.enabled ? "Run real devnet transactions" : liveInfo?.reason ?? "Checking…"}
              onClick={() => { setLive(true); reset(); }}
              className={cn("flex items-center gap-1 rounded-full px-3 py-1.5 font-semibold disabled:opacity-40", live && "bg-primary text-primary-foreground")}
            >
              <Radio className="size-3" /> Live on devnet
            </button>
          </div>
        </div>

        {/* Scenario switcher */}
        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3" role="tablist" aria-label="Scenario">
          {SCENARIOS.map((s) => (
            <button
              key={s.id}
              role="tab"
              aria-selected={scenario === s.id}
              type="button"
              onClick={() => reset(s.id)}
              className={cn(
                "rounded-2xl border px-4 py-3 text-left transition-colors",
                scenario === s.id ? (s.id === "scam" ? "border-disputed bg-disputed/10 glow-disputed" : "border-primary bg-primary/10 glow-primary") : "border-white/10 bg-card hover:bg-secondary",
              )}
            >
              <p className="font-bold">{s.name}</p>
              <p className="text-xs text-white/60">{s.tagline}</p>
            </button>
          ))}
        </div>

        <div className="mt-4"><StepRail steps={steps} current={index} onSelect={live ? undefined : (i) => { setIndex(i); setFlying([]); setFfLeft(null); }} /></div>

        {/* Stage */}
        <div className="mt-4">
        <ScaledStage>
        <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-background p-3 md:p-6">
          <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-2 md:gap-6">
            <Persona name="Sam" role={scenario === "fair" ? "Seller · owns a ticket" : "Seller · says he has a ticket"} initial="S" usdc={sellerUsd} tone={frame.sellerTone ?? "neutral"} delta={delta("seller")}>
              {ticketNode("seller")}
            </Persona>
            <div className="flex flex-col items-center gap-2 pt-2">
              <Vault balance={money$.vault} state={frame.vaultState}>{ticketNode("vault")}</Vault>
              {frame.cap && (
                <div className={cn("w-44 rounded-xl border px-3 py-2 text-center text-xs md:w-56", frame.cap.price > frame.cap.cap ? "border-disputed/60 bg-disputed/10" : "border-released/50 bg-released/10")} title="The artist sets a maximum resale price. The program refuses anything above it.">
                  <p className="font-semibold">Price {money(frame.cap.price)} · Max {money(frame.cap.cap)}</p>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-secondary">
                    <motion.div
                      className={cn("h-full rounded-full", frame.cap.price > frame.cap.cap ? "bg-disputed" : "bg-released")}
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.min(100, (frame.cap.price / frame.cap.cap) * 100)}%` }}
                      transition={MOTION.dramatic}
                    />
                  </div>
                  <p className="mt-1 text-white/60">artist&apos;s cap</p>
                </div>
              )}
              {secondsLeft !== null && scenario !== "fair" && (
                <div className={cn("flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-bold", secondsLeft > 0 ? "border-transit/60 text-transit" : "border-disputed/60 text-disputed")} aria-live="polite">
                  <Timer className="size-4" /> {secondsLeft > 0 ? `Sam must send it: ${secondsLeft}s` : "Deadline passed"}
                </div>
              )}
            </div>
            <Persona name="Bea" role="Buyer · a fan" initial="B" usdc={buyerUsd} tone={frame.buyerTone ?? "neutral"} delta={delta("buyer")}>
              {ticketNode("buyer")}
            </Persona>
          </div>

          {/* Payout receivers */}
          <div className="mt-4 flex justify-center gap-6 text-xs">
            <span className={cn("rounded-full border px-3 py-1", money$.artist > 0 ? "border-transit/60 text-transit" : "border-white/10 text-white/50")} title="The artist earns a royalty on every SeatSafe resale.">
              Artist {money(money$.artist)}
            </span>
            <span className={cn("rounded-full border px-3 py-1", money$.seatsafe > 0 ? "border-white/40 text-white" : "border-white/10 text-white/50")} title="SeatSafe's 3% fee.">
              SeatSafe fee {money(money$.seatsafe)}
            </span>
          </div>

          {/* Flights */}
          {frame.flights.filter((f) => flying.includes(f.id)).map((f) => (
            <Flight
              key={`${scenario}-${index}-${f.id}`}
              from={ANCHORS[f.from]}
              to={ANCHORS[f.to]}
              delay={f.delay}
              arc={f.kind === "ticket" ? -20 : -12}
              onDone={() => setFlying((ids) => ids.filter((x) => x !== f.id))}
            >
              {f.kind === "coin" ? (
                <Coin amount={f.amount ?? 0} label={f.label} tone={f.tone ?? "vault"} />
              ) : (
                <TicketCard event={terms.event} seat={frame.ticket.outside ? terms.outsideSeat : terms.seat} lock={frame.ticket.outside ? "unlocked" : "unlocking"} outside={frame.ticket.outside} size="sm" glow />
              )}
            </Flight>
          ))}

          {/* Banner */}
          <AnimatePresence>
            {banner && flying.length === 0 && (
              <motion.div
                key={`${scenario}-${index}-banner`}
                initial={{ opacity: 0, scale: 0.85, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={MOTION.dramatic}
                className={cn("absolute inset-x-3 top-3 z-40 mx-auto max-w-xl rounded-2xl border-2 bg-[#0B0B0F] px-4 py-3 text-center md:top-6", TONE[banner.tone].border, TONE[banner.tone].glow)}
                role="status"
              >
                <p className={cn("text-lg font-extrabold md:text-2xl", TONE[banner.tone].text)}>{banner.title}</p>
                <p className="mt-1 text-sm text-white/85">{banner.text}</p>
                {banner.tone === "released" && index === steps.length - 1 && (
                  <div className="mt-2"><TxBadge signature={live ? lastSig : null} label={live ? "tx" : "simulated"} /></div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        </ScaledStage>
        </div>

        {/* Narration + controls */}
        <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-center">
          <motion.p key={`${scenario}-${index}`} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="min-h-12 flex-1 text-base font-medium md:text-lg" aria-live="polite">
            {step.caption}
          </motion.p>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="ghost" size="icon" aria-label="Previous step" disabled={busy || index === 0 || live} onClick={() => void go(index - 1)}><ChevronLeft /></Button>
            {!live && (
              <Button variant="outline" size="icon" aria-label={auto ? "Pause auto-play" : "Auto-play"} onClick={() => setAuto((a) => !a)}>{auto ? <Pause /> : <Play />}</Button>
            )}
            <Button size="lg" className="min-w-44" disabled={busy || index >= steps.length - 1} onClick={() => void go(index + 1)}>
              {busy ? <Loader2 className="animate-spin" /> : null}
              {busy ? "Sending to devnet…" : index >= steps.length - 1 ? "Done" : steps[index + 1].action}
              {!busy && index < steps.length - 1 && <ChevronRight />}
            </Button>
            <Button variant="ghost" size="icon" aria-label="Restart" onClick={() => reset()}><RotateCcw /></Button>
          </div>
        </div>
        {error && <p className="mt-2 rounded-xl border border-disputed/50 bg-disputed/10 px-3 py-2 text-sm">{error}</p>}

        {/* Transaction log */}
        <div className="mt-4 rounded-2xl border border-white/10 bg-black/30 p-3 text-xs">
          <p className="mb-2 font-semibold tracking-wide text-white/60 uppercase">
            {live ? "Devnet transactions" : "Steps (simulated: switch to Live on devnet for real transactions)"}
          </p>
          {log.length === 0 ? (
            <p className="text-white/50">Nothing yet.</p>
          ) : (
            <ul className="space-y-1">
              {log.map((l, i) => (
                <li key={i} className="flex flex-wrap items-center gap-2">
                  <span className="w-40 shrink-0 font-medium">{l.step}</span>
                  <TxBadge signature={l.signature} failed={l.failed} label={l.failed && l.note ? `rejected: ${l.note}` : undefined} />
                </li>
              ))}
            </ul>
          )}
          {live && balances && (
            <p className="mt-2 text-white/50">
              Demo wallets: Sam {balances.sellerAddress.slice(0, 4)}…{balances.sellerAddress.slice(-4)} · Bea {balances.buyerAddress.slice(0, 4)}…{balances.buyerAddress.slice(-4)} · gas paid by the SeatSafe relayer ({balances.relayerSol.toFixed(3)} SOL)
            </p>
          )}
        </div>
      </section>
    </MotionConfig>
  );
}
