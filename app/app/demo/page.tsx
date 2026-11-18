"use client";

// Owner: A. Judge mode: the presenter's run sheet for the 4-minute demo. Not linked in the nav (/demo only).
// Live readiness checks + one card per demo step with an "Open" button to the exact page. Every address
// comes from devnet / Supabase at load time (refreshes every 15 s), so it stays right after `reset-demo`.

import Link from "next/link";
import { useState } from "react";
import { Check, Copy, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { Keypair, PublicKey } from "@solana/web3.js";
import { getEvents, getListingsForEvent, getMyTickets, USE_MOCK, type ChainEvent, type ChainListing, type ChainTicket } from "@/lib/chain";
import { connection, USDC_MINT } from "@/lib/solana";
import { supabase } from "@/lib/supabase";
import { useTxWallet } from "@/lib/tx";
import { useAsyncData } from "@/lib/use-chain";
import { formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/** The seed seller wallet (program/scripts/seed-devnet.ts). A wallet, not a PDA; override per deployment. */
const SEED_SELLER = process.env.NEXT_PUBLIC_DEMO_SELLER ?? "29ZQN6eHpp5VJH3zLSgC7UVUYsrb6czgrqEKb61LnzUs";
const AGENT_EXAMPLE = "2 tickets for Battle of the Bands under $15, before Dec 14";
const RESET = "cd program && anchor run reset-demo --provider.cluster devnet";

type Level = "ok" | "warn" | "fail";
interface Check {
  label: string;
  level: Level;
  detail: string;
  fix?: string;
}
interface DemoData {
  checks: Check[];
  demoEvent: ChainEvent | null;
  primaryEvent: ChainEvent | null;
  resale: ChainListing | null;
  escrow: ChainListing | null;
  held: ChainTicket | null;
  fakeAddress: string;
  voice: boolean;
  loggedIn: boolean;
}

async function usdcOf(owner: string): Promise<number> {
  const res = await connection.getParsedTokenAccountsByOwner(new PublicKey(owner), { mint: USDC_MINT }, "confirmed");
  return res.value.reduce((s, a) => s + Number(a.account.data.parsed?.info?.tokenAmount?.uiAmount ?? 0), 0);
}
const settle = async <T,>(p: Promise<T>): Promise<T | null> => p.catch(() => null);

async function load(owner: string | null): Promise<DemoData> {
  const checks: Check[] = [];
  const voice = Boolean(process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID);
  const fakeAddress = Keypair.generate().publicKey.toBase58();

  // Events and listings (devnet).
  const events = (await settle(getEvents())) ?? [];
  const demoEvent = events.find((e) => /battle of the bands/i.test(e.title)) ?? events[0] ?? null;
  const primaryEvent = events.find((e) => /neon harbor/i.test(e.title)) ?? demoEvent;
  const listings = demoEvent ? (await settle(getListingsForEvent(demoEvent.id))) ?? [] : [];
  const resale = listings.filter((l) => l.tier === 1 && l.sellerId !== owner).sort((a, b) => a.priceUsd - b.priceUsd)[0] ?? null;
  const escrow = listings.filter((l) => l.tier === 2).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;

  // Relayer + health.
  const relay = await settle(fetch("/api/relay").then((r) => r.json() as Promise<{ enabled: boolean; relayer: string | null }>));
  const relayerSol = relay?.relayer ? ((await settle(connection.getBalance(new PublicKey(relay.relayer)))) ?? 0) / 1e9 : null;
  checks.push(
    !relay?.enabled || relayerSol == null
      ? { label: "Relayer", level: "fail", detail: "Gas sponsorship is off", fix: "Set RELAYER_SECRET_KEY in Vercel and redeploy" }
      : { label: "Relayer SOL", level: relayerSol < 0.2 ? "warn" : "ok", detail: `${relayerSol.toFixed(3)} SOL`, fix: relayerSol < 0.2 ? "solana transfer 7r2Ssz… 0.5 --url devnet" : undefined },
  );
  const health = await settle(fetch("/api/health").then((r) => r.json() as Promise<{ ok: boolean; errors?: Record<string, string> }>));
  checks.push(
    health?.ok
      ? { label: "/api/health", level: "ok", detail: "ok" }
      : { label: "/api/health", level: "fail", detail: health ? Object.values(health.errors ?? {}).join("; ") || "not ok" : "unreachable", fix: "Check Vercel logs and env vars" },
  );

  // Balances.
  const sellerUsdc = await settle(usdcOf(SEED_SELLER));
  checks.push({
    label: "Seed seller USDC",
    level: sellerUsdc == null ? "warn" : sellerUsdc < 12 ? "warn" : "ok",
    detail: sellerUsdc == null ? "unknown" : formatUsd(sellerUsdc),
    fix: sellerUsdc != null && sellerUsdc < 12 ? `Needs $12 for reset-demo: faucet.circle.com → ${SEED_SELLER.slice(0, 4)}…` : undefined,
  });
  let held: ChainTicket | null = null;
  if (owner) {
    const usdc = await settle(usdcOf(owner));
    checks.push({
      label: "Your wallet USDC",
      level: usdc == null ? "warn" : usdc < 20 ? "warn" : "ok",
      detail: usdc == null ? "unknown" : formatUsd(usdc),
      fix: usdc != null && usdc < 20 ? "Escrow step needs $20: faucet.circle.com" : undefined,
    });
    const mine = (await settle(getMyTickets(owner))) ?? [];
    held = mine.find((t) => t.tier === 1 && !t.listed && (!demoEvent || t.eventId === demoEvent.id)) ?? mine.find((t) => t.tier === 1 && !t.listed) ?? null;
    checks.push(held
      ? { label: "Ticket to resell", level: "ok", detail: held.seatLabel }
      : { label: "Ticket to resell", level: "warn", detail: "None unlisted in this wallet", fix: "Do step 1 (buy) first" });
  } else {
    checks.push({ label: "Demo wallet", level: "warn", detail: "Not logged in", fix: "Log in as wallet 1 to check its balance and tickets" });
  }

  // Listings.
  checks.push(resale
    ? { label: "Open resale listing", level: "ok", detail: `${resale.seat || "GA"} · ${formatUsd(resale.priceUsd)}` }
    : { label: "Open resale listing", level: "fail", detail: "None", fix: RESET });
  checks.push(escrow
    ? { label: "Open escrow listing", level: "ok", detail: `${formatUsd(escrow.priceUsd)}${escrow.bondUsd > 0 ? ` + ${formatUsd(escrow.bondUsd)} bond` : ""}` }
    : { label: "Open escrow listing", level: "fail", detail: "None", fix: RESET });

  // Stream freshness (newest order_events row).
  if (supabase) {
    const { data } = await supabase.from("order_events").select("at").order("at", { ascending: false }).limit(1);
    const at = data?.[0]?.at as string | undefined;
    const mins = at ? (Date.now() - new Date(at).getTime()) / 60_000 : null;
    checks.push(mins == null
      ? { label: "QuickNode Stream", level: "warn", detail: "No deliveries yet", fix: "Do any resale or escrow action and recheck" }
      : { label: "QuickNode Stream", level: mins < 120 ? "ok" : "warn", detail: `last event ${mins < 1 ? "<1" : Math.round(mins)} min ago`, fix: mins < 120 ? undefined : "Check the Stream is active in QuickNode" });
  } else {
    checks.push({ label: "QuickNode Stream", level: "fail", detail: "Supabase not configured", fix: "Set NEXT_PUBLIC_SUPABASE_URL / ANON_KEY" });
  }
  checks.push(voice
    ? { label: "ElevenLabs voice", level: "ok", detail: "agent ID set" }
    : { label: "ElevenLabs voice", level: "warn", detail: "not configured: skip the voice part", fix: "Add NEXT_PUBLIC_ELEVENLABS_AGENT_ID in Vercel" });

  return { checks, demoEvent, primaryEvent, resale, escrow, held, fakeAddress, voice, loggedIn: owner !== null };
}

const DOT: Record<Level, string> = { ok: "bg-released", warn: "bg-transit", fail: "bg-disputed" };

function Dot({ level }: { level: Level }) {
  return <span className={cn("mt-1.5 size-2.5 shrink-0 rounded-full", DOT[level])} aria-label={level === "ok" ? "ready" : level === "warn" ? "warning" : "not ready"} role="img" />;
}

function Step(props: {
  n: number;
  title: string;
  say: string;
  expect: string;
  ready: Level;
  links: { label: string; href: string }[];
  note?: React.ReactNode;
}) {
  return (
    <Card className="gap-3 p-4">
      <div className="flex items-start gap-3">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-white/10 text-sm font-bold">{props.n}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <p className="flex-1 font-semibold">{props.title}</p>
            <Dot level={props.ready} />
          </div>
          <p className="mt-1 text-sm">&ldquo;{props.say}&rdquo;</p>
          <p className="mt-1 text-xs text-muted-foreground">Expect: {props.expect}</p>
          {props.note && <div className="mt-2 text-xs text-muted-foreground">{props.note}</div>}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {props.links.map((l) => (
          <Link key={l.href + l.label} href={l.href} className={buttonVariants({ size: "lg", className: "flex-1 sm:flex-none" })}>
            {l.label}
          </Link>
        ))}
      </div>
    </Card>
  );
}

function CopyText({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => void navigator.clipboard.writeText(text).then(() => setDone(true)).catch(() => undefined)}
      className="inline-flex items-center gap-1 rounded bg-white/10 px-2 py-0.5 font-mono"
    >
      {done ? <Check className="size-3" /> : <Copy className="size-3" />} {text}
    </button>
  );
}

export default function DemoPage() {
  const wallet = useTxWallet();
  const owner = wallet?.address.toBase58() ?? null;
  const { data, loading, refresh } = useAsyncData(USE_MOCK ? null : `demo:${owner ?? "-"}`, () => load(owner), { pollMs: 15_000 });

  if (USE_MOCK) {
    return (
      <section className="mx-auto w-full max-w-2xl px-4 py-8">
        <h1 className="text-2xl font-bold">Judge mode</h1>
        <p className="mt-2 text-sm text-muted-foreground">Mock mode: set NEXT_PUBLIC_USE_MOCK=false to run the live demo checks.</p>
      </section>
    );
  }

  const d = data;
  const ev = d?.demoEvent;
  const step = (ok: boolean, warn = false): Level => (ok ? (warn ? "warn" : "ok") : "fail");
  /** Steps that need the demo wallet: amber until logged in, then green/red on whether it holds a ticket. */
  const walletStep = (): Level => (!d?.loggedIn ? "warn" : d.held ? "ok" : "fail");

  return (
    <section className="mx-auto w-full max-w-2xl px-4 py-6 md:py-8">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Judge mode</h1>
          <p className="text-sm text-muted-foreground">4-minute demo, in order. Rechecks every 15 s.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}>
          {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />} Recheck
        </Button>
      </div>

      <Card className="mt-5 gap-0 p-0">
        <p className="border-b border-border px-4 py-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Readiness</p>
        {!d ? (
          <p className="flex items-center gap-2 px-4 py-4 text-sm"><Loader2 className="size-4 animate-spin" /> Checking devnet, relayer and Stream…</p>
        ) : (
          <ul className="divide-y divide-border">
            {d.checks.map((c) => (
              <li key={c.label} className="flex items-start gap-3 px-4 py-2 text-sm">
                <Dot level={c.level} />
                <span className="w-36 shrink-0 font-medium">{c.label}</span>
                <span className="min-w-0 flex-1">
                  {c.detail}
                  {c.fix && <span className="block text-xs text-muted-foreground">Fix: {c.fix.startsWith("cd program") ? <CopyText text={c.fix} /> : c.fix}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {d && (
        <div className="mt-5 space-y-3">
          <Step
            n={0}
            title="Live Lab (real devnet, 60–90 s)"
            say="Everything on this screen is read from Solana after confirmation. Watch the X-ray: wallet, relayer, program, tokens, event, QuickNode, UI."
            expect="A: $50 rejected (AboveResaleCap), $14 swaps atomically, padlock frozen in the buyer's wallet. B: withdraw rejected (InvalidState), refund after the onchain deadline empties the vault."
            ready="ok"
            links={[
              { label: "Seller window", href: "/simulator?scenario=fair&role=seller" },
              { label: "Presenter (backup)", href: "/simulator?scenario=fair&driver=presenter" },
            ]}
            note={<>Two windows, two logins: Seller → Prepare → Copy link for the buyer → Buyer opens it. Presenter needs SIM_LIVE_ENABLED. Emergency: <b>/simulator?offline=1</b>.</>}
          />
          <Step
            n={1}
            title="Primary buy"
            say="Buy a ticket with just an email login. No wallet, no SOL: SeatSafe pays the gas."
            expect="Toast “Ticket bought!”, USDC drops by the price, bell: “You're in!”"
            ready={step(Boolean(d.primaryEvent))}
            links={d.primaryEvent ? [{ label: `Open ${d.primaryEvent.title}`, href: `/events/${d.primaryEvent.id}` }] : []}
          />
          <Step
            n={2}
            title="Scalper blocked"
            say="Try to resell above the artist's cap. The program itself refuses it."
            expect="Red “caps resale at …” message, no listing; ticker “scalpers blocked” +1"
            ready={walletStep()}
            links={[{ label: d.held ? "Open resell dialog" : "Open My tickets", href: d.held ? `/tickets?resell=${d.held.id}` : "/tickets" }]}
            note={ev?.resaleCapUsd != null && <>Type <b>{formatUsd(ev.resaleCapUsd * 3)}</b> (cap {formatUsd(ev.resaleCapUsd)}).</>}
          />
          <Step
            n={3}
            title="Fair resale (atomic swap)"
            say="Buy a resale ticket: ticket and money swap in one transaction, at or under the cap."
            expect="Wallet 2 gets the ticket; seller's bell: “Your ticket sold”; ticker fair resales +1"
            ready={step(Boolean(d.resale))}
            links={ev ? [{ label: "Open resale list", href: `/events/${ev.id}` }] : []}
            note={d.resale ? <>Buy the {formatUsd(d.resale.priceUsd)} listing ({d.resale.seat || "GA"}) as wallet 2.</> : <>No listing: <CopyText text={RESET} /></>}
          />
          <Step
            n={4}
            title="Scam auto-refund (escrow)"
            say="Outside ticket: the money waits in a program vault. Seller never ships, the buyer gets it all back automatically."
            expect="/orders tracker HELD with countdown → Claim refund → “your $ is back” notification, ticker refunds +1"
            ready={step(Boolean(d.escrow))}
            links={ev ? [{ label: "Open escrow listing", href: `/events/${ev.id}` }] : []}
            note={d.escrow ? <>Buy with escrow protection ({formatUsd(d.escrow.priceUsd)}), then wait 60 s.</> : <>No escrow: <CopyText text={RESET} /></>}
          />
          <Step
            n={5}
            title="In person (Solana Pay)"
            say="At the gate: seller shows a QR, buyer scans, swap happens on the spot."
            expect="Laptop QR → phone /scan → confirm → laptop flips to “Sold!”"
            ready={walletStep()}
            links={[{ label: "Open My tickets", href: "/tickets" }, { label: "Open Scan (phone)", href: "/scan" }]}
            note={<>Tap <b>Sell in person</b> on a ticket.</>}
          />
          <Step
            n={6}
            title="Agent"
            say="Tell the agent what you want in plain English; it buys within a capped budget."
            expect="Standing order created; a matching listing gets filled; bell: “Your agent bought a ticket”"
            ready={step(true, !d.voice)}
            links={[{ label: "Open Agent", href: "/agent" }]}
            note={<>Paste: <CopyText text={AGENT_EXAMPLE} />{!d.voice && " · Voice approval off (no ElevenLabs agent ID): use the buttons."}</>}
          />
          <Step
            n={7}
            title="Verify a listing"
            say="Before paying anyone, check it on the chain: real SeatSafe listing vs a fake address."
            expect="Real: “Protected SeatSafe resale”. Fake: “This is not a SeatSafe listing. Don't pay.”"
            ready={step(Boolean(d.resale))}
            links={[
              ...(d.resale ? [{ label: "Open real listing", href: `/verify/${d.resale.id}` }] : []),
              { label: "Open fake address", href: `/verify/${d.fakeAddress}` },
            ]}
          />
          <p className="flex items-center gap-1 pt-2 text-xs text-muted-foreground">
            <ExternalLink className="size-3" /> Full click-by-click steps: docs/demo-checklist.md
          </p>
        </div>
      )}
    </section>
  );
}
