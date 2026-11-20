"use client";

// Owner: A. Live Lab "under the hood" panel: one run per action, seven layers lighting up in order, each with
// the real timestamp and data (signer, relayer fee, program logs + compute units, token movement, decoded event,
// QuickNode Stream delivery time, UI update). A rejected action stops at the program layer in red with the
// real error name and log line. Also: the tech stack strip.

import { AnimatePresence, motion } from "motion/react";
import { Check, ExternalLink, Loader2, X } from "lucide-react";
import type { ReactNode } from "react";
import { explorerAddress, explorerTx } from "@/lib/solana";
import { short, type XRay as XRayData } from "@/lib/live-lab";
import { cn } from "@/lib/utils";

export type LayerKey = "sign" | "relayer" | "program" | "tokens" | "event" | "stream" | "ui";
export type LayerState = "idle" | "active" | "done" | "failed" | "skipped";

export interface Run {
  id: string;
  label: string;
  who: string; // "Sam (seller)"
  startedAt: number;
  blocked?: { errorName: string; message: string; logs: string[] } | null;
  signature?: string | null;
  signer?: string;
  x?: XRayData | null;
  streamSeconds?: number | null; // Stream delivery time (processed_at - blockTime)
  streamState?: "waiting" | "done" | "timeout";
  realtimeAt?: number | null; // when Supabase Realtime pushed the order_events row to this page
  uiAt?: number | null;
  layers: Record<LayerKey, { state: LayerState; at?: number }>;
}

export const LAYERS: { key: LayerKey; title: string }[] = [
  { key: "sign", title: "Wallet signs" },
  { key: "relayer", title: "Relayer pays gas" },
  { key: "program", title: "SeatSafe program runs" },
  { key: "tokens", title: "Tokens move" },
  { key: "event", title: "Event emitted" },
  { key: "stream", title: "QuickNode Stream delivers" },
  { key: "ui", title: "UI updated" },
];

export function freshLayers(): Run["layers"] {
  return Object.fromEntries(LAYERS.map((l) => [l.key, { state: "idle" }])) as Run["layers"];
}

const time = (ms?: number) => (ms ? new Date(ms).toLocaleTimeString("en-US", { hour12: false }) + "." + String(ms % 1000).padStart(3, "0").slice(0, 1) : "");
const Addr = ({ k }: { k: string }) => (
  <a href={explorerAddress(k)} target="_blank" rel="noopener noreferrer" className="font-mono underline decoration-white/30 underline-offset-2 hover:text-white">{short(k)}</a>
);

function Dot({ state }: { state: LayerState }) {
  if (state === "active") return <Loader2 className="size-3.5 animate-spin text-transit" aria-label="running" />;
  if (state === "done") return <Check className="size-3.5 text-released" aria-label="done" />;
  if (state === "failed") return <X className="size-3.5 text-disputed" aria-label="failed" />;
  return <span className={cn("size-2 rounded-full", state === "skipped" ? "bg-white/20" : "bg-white/30")} aria-hidden />;
}

function Detail({ run, k, usdcMint, labelOf }: { run: Run; k: LayerKey; usdcMint: string; labelOf: (addr: string) => string }): ReactNode {
  const x = run.x;
  switch (k) {
    case "sign":
      return run.signer ? <>{run.who} signed · <Addr k={run.signer} /></> : <>{run.who} signing…</>;
    case "relayer":
      return x ? <>Fee payer <Addr k={x.feePayer} /> paid {x.feeSol.toFixed(6)} SOL · {run.who.split(" ")[0]} paid <b>0 SOL</b></> : run.blocked ? "Nothing sent: the program refused it in simulation, no fee." : null;
    case "program":
      if (run.blocked) {
        return (
          <span className="text-disputed">
            <b>{run.blocked.errorName || "Rejected"}</b>: {run.blocked.message}
            {run.blocked.logs.length > 0 && <code className="mt-1 block font-mono text-[10px] break-all text-disputed/90">{run.blocked.logs.slice(-2).join("\n")}</code>}
          </span>
        );
      }
      return x ? (
        <>
          <b className="font-mono">{x.instructions[0] ?? "?"}</b> · {x.computeUnits?.toLocaleString() ?? "?"} compute units ·{" "}
          <a href={explorerTx(x.signature)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 font-mono underline underline-offset-2">{short(x.signature)} <ExternalLink className="size-3" /></a>
          <code className="mt-1 block max-h-20 overflow-y-auto font-mono text-[10px] leading-snug text-white/60">
            {x.programLogs.filter((l) => !l.startsWith("Program data:")).slice(0, 8).join("\n")}
          </code>
        </>
      ) : null;
    case "tokens":
      return x ? (
        <span className="flex flex-wrap gap-x-3 gap-y-0.5">
          {x.deltas.map((d, i) => (
            <span key={i} className={cn("num", d.delta > 0 ? "text-released" : "text-disputed")}>
              {d.delta > 0 ? "+" : "−"}{d.isUsdc ? `$${Math.abs(d.delta).toFixed(2)}` : `${Math.abs(d.delta)} ticket`} {labelOf(d.owner)}
            </span>
          ))}
          {x.deltas.length === 0 && <span className="text-white/60">no token balance changed</span>}
          {x.instructions.includes("FreezeAccount") && <span className="text-vault">ticket re-frozen (FreezeAccount)</span>}
        </span>
      ) : null;
    case "event":
      return x?.events.length ? (
        <>
          {x.events.map((e) => (
            <span key={e.name} className="block">
              <b className="font-mono">{e.name}</b>{" "}
              <span className="font-mono text-[10px] text-white/60">
                {Object.entries(e.fields).filter(([f]) => !/^(at|bump)$/.test(f)).slice(0, 5).map(([f, v]) => `${f}=${v.length > 12 ? short(v) : v}`).join(" ")}
              </span>
            </span>
          ))}
        </>
      ) : x ? <span className="text-white/60">no SeatSafe event</span> : null;
    case "stream":
      if (run.streamState === "done") return <>Delivered by QuickNode in <b className="num">{run.streamSeconds?.toFixed(1)} s</b> (block time → webhook stored it){run.realtimeAt ? " · pushed here by Supabase Realtime" : ""}</>;
      if (run.streamState === "timeout") return <span className="text-white/60">Not seen in 45 s (Stream lag or not configured)</span>;
      return run.streamState === "waiting" ? <>Waiting for the Stream…</> : null;
    case "ui":
      return run.uiAt ? <>Screen redrawn from the new chain state · {usdcMint ? "USDC balances re-read" : ""}</> : null;
  }
}

export function XRayPanel({ runs, usdcMint, labelOf }: { runs: Run[]; usdcMint: string; labelOf: (addr: string) => string }) {
  const run = runs[0];
  return (
    <section aria-label="Under the hood" className="rounded-3xl border border-white/10 bg-black/40 p-3 text-xs md:p-4">
      <p className="mb-2 flex items-center justify-between font-semibold tracking-wide text-white/70 uppercase">
        Under the hood {run && <span className="font-normal normal-case text-white/50">{run.label} · {run.who}</span>}
      </p>
      {!run ? (
        <p className="text-white/50">Do an action: each layer of the stack lights up here as it really happens.</p>
      ) : (
        <ol className="space-y-1.5">
          {LAYERS.map((l, i) => {
            const st = run.layers[l.key];
            return (
              <motion.li
                key={`${run.id}-${l.key}`}
                initial={{ opacity: 0.4 }}
                animate={{ opacity: st.state === "idle" || st.state === "skipped" ? 0.45 : 1 }}
                className={cn(
                  "rounded-xl border px-2.5 py-1.5",
                  st.state === "done" && "border-released/30 bg-released/5",
                  st.state === "active" && "border-transit/40 bg-transit/5",
                  st.state === "failed" && "border-disputed/60 bg-disputed/10 glow-disputed",
                  (st.state === "idle" || st.state === "skipped") && "border-white/10",
                )}
              >
                <div className="flex items-center gap-2">
                  <span className="w-4 text-white/40">{i + 1}</span>
                  <Dot state={st.state} />
                  <span className="font-semibold">{l.title}</span>
                  <span className="ml-auto font-mono text-[10px] text-white/40">{time(st.at)}</span>
                </div>
                <AnimatePresence>
                  {st.state !== "idle" && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="mt-0.5 pl-10 text-white/80">
                      <Detail run={run} k={l.key} usdcMint={usdcMint} labelOf={labelOf} />
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.li>
            );
          })}
        </ol>
      )}
      {runs.length > 1 && (
        <p className="mt-2 text-white/40">
          Earlier: {runs.slice(1, 6).map((r) => `${r.label}${r.blocked ? " (blocked)" : ""}`).join(" · ")}
        </p>
      )}
    </section>
  );
}

export type StackKey = "anchor" | "token2022" | "escrow" | "swap" | "relayer" | "privy" | "quicknode" | "realtime" | "solanapay";
const STACK: { key: StackKey; label: string; href: string }[] = [
  { key: "anchor", label: "Anchor program", href: "https://explorer.solana.com/address/7fnVUPd18tDr2CbEgjTxt55Emq4CMMskR9qxprjQjypy?cluster=devnet" },
  { key: "token2022", label: "Token-2022 (frozen tickets)", href: "/verify" },
  { key: "escrow", label: "Escrow vault PDAs", href: "/verify" },
  { key: "swap", label: "Atomic swap", href: "/simulator" },
  { key: "relayer", label: "Relayer (gasless)", href: "https://explorer.solana.com/address/7r2SszeUx3xyJsjAeUYvveMMmvkjjvxbPhxUGiP78g61?cluster=devnet" },
  { key: "privy", label: "Privy embedded wallets", href: "/tickets" },
  { key: "quicknode", label: "QuickNode Streams", href: "/demo" },
  { key: "realtime", label: "Supabase Realtime", href: "/" },
  { key: "solanapay", label: "Solana Pay", href: "/scan" },
];

export function StackStrip({ active }: { active: Set<StackKey> }) {
  return (
    <nav aria-label="Tech stack" className="flex flex-wrap gap-1.5">
      {STACK.map((s) => {
        const on = active.has(s.key);
        return (
          <a
            key={s.key}
            href={s.href}
            target={s.href.startsWith("http") ? "_blank" : undefined}
            rel="noopener noreferrer"
            className={cn(
              "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all duration-300",
              on ? "border-primary bg-primary/15 text-white glow-primary" : "border-white/10 bg-white/[0.03] text-white/50 hover:text-white/80",
            )}
          >
            {s.label}
          </a>
        );
      })}
    </nav>
  );
}
