// Owner: A. The simulator's script: three scenarios as lists of frames. A frame is what the stage shows once
// a step is done (balances, where the ticket is, vault state, banner); `flights` are the coins/ticket that fly
// on the way there. Live mode attaches a real devnet action to a step (see /api/sim/step).

import type { LockState } from "@/components/sim/TicketCard";
import type { VaultState } from "@/components/sim/Vault";
import type { Tone } from "@/lib/design";

export type Anchor = "seller" | "buyer" | "vault" | "artist" | "seatsafe";
export type ScenarioId = "fair" | "scam" | "honest";

export interface FlightSpec {
  id: string;
  kind: "coin" | "ticket";
  amount?: number;
  label?: string;
  tone?: Tone;
  from: Anchor;
  to: Anchor;
  delay?: number;
}

export interface Frame {
  seller: number;
  buyer: number;
  artist: number;
  seatsafe: number;
  vault: number;
  vaultState: VaultState;
  ticket: { at: Anchor | "hidden"; lock: LockState; outside: boolean };
  flights: FlightSpec[];
  banner?: { tone: Tone; title: string; text: string };
  cap?: { price: number; cap: number };
  /** Ship deadline countdown, in seconds (escrow). */
  countdown?: number;
  sellerTone?: Tone;
  buyerTone?: Tone;
}

export type LiveAction = "a_prepare" | "a_list_over" | "a_list" | "a_buy" | "b_list" | "b_fund" | "b_steal" | "b_refund" | "c_sent" | "c_confirm";

export interface Step {
  title: string;
  /** Button label for doing this step. */
  action: string;
  caption: string;
  frame: Frame;
  live?: { action: LiveAction; expectFail?: boolean };
  /** Wait for the ship deadline before this step can run (live mode). */
  waitForDeadline?: boolean;
}

export interface Terms {
  event: string;
  seat: string;
  outsideSeat: string;
  /** Tier 1 */
  resale: number;
  over: number;
  cap: number;
  royaltyBps: number;
  feeBps: number;
  /** Tier 2 */
  escrowPrice: number;
  bond: number;
  windowSecs: number;
  /** Starting wallets (simulated mode). */
  sellerStart: number;
  buyerStart: number;
}

export const SIMULATED_TERMS: Terms = {
  event: "Neon Harbor · Midnight Tides",
  seat: "Floor GA",
  outsideSeat: "Sec 104 · Row C (PDF)",
  resale: 14,
  over: 50,
  cap: 15,
  royaltyBps: 500,
  feeBps: 300,
  escrowPrice: 20,
  bond: 2,
  windowSecs: 60,
  sellerStart: 5,
  buyerStart: 50,
};

const r2 = (n: number) => Math.round(n * 100) / 100;

export const SCENARIOS: { id: ScenarioId; name: string; tagline: string }[] = [
  { id: "fair", name: "Fair resale", tagline: "Atomic swap, capped price" },
  { id: "scam", name: "Seller tries to scam", tagline: "Escrow sends the money back" },
  { id: "honest", name: "Honest outside sale", tagline: "Escrow pays the seller" },
];

export function buildSteps(id: ScenarioId, t: Terms): Step[] {
  const fee = r2((t.resale * t.feeBps) / 10_000);
  const royalty = r2((t.resale * t.royaltyBps) / 10_000);
  const sellerGets = r2(t.resale - fee - royalty);
  const escrowFee = r2((t.escrowPrice * t.feeBps) / 10_000);
  const base: Frame = {
    seller: t.sellerStart,
    buyer: t.buyerStart,
    artist: 0,
    seatsafe: 0,
    vault: 0,
    vaultState: "idle",
    ticket: { at: "seller", lock: "locked", outside: false },
    flights: [],
  };

  if (id === "fair") {
    const s0: Frame = { ...base };
    const s1: Frame = {
      ...s0,
      cap: { price: t.over, cap: t.cap },
      sellerTone: "disputed",
      banner: { tone: "disputed", title: "Blocked by the program", text: `${money(t.over)} is above the artist's ${money(t.cap)} cap. Nothing was listed.` },
    };
    const s2: Frame = {
      ...s0,
      cap: { price: t.resale, cap: t.cap },
      ticket: { at: "vault", lock: "locked", outside: false },
      vaultState: "holding",
      flights: [{ id: "t-list", kind: "ticket", from: "seller", to: "vault" }],
    };
    const s3: Frame = {
      ...s2,
      seller: r2(s2.seller + sellerGets),
      buyer: r2(s2.buyer - t.resale),
      artist: royalty,
      seatsafe: fee,
      vaultState: "open",
      ticket: { at: "buyer", lock: "locked", outside: false },
      buyerTone: "released",
      flights: [
        { id: "c-pay", kind: "coin", amount: t.resale, label: "Bea pays", from: "buyer", to: "vault" },
        { id: "t-swap", kind: "ticket", from: "vault", to: "buyer", delay: 0.05 },
        { id: "c-seller", kind: "coin", amount: sellerGets, label: "to Sam", tone: "released", from: "vault", to: "seller", delay: 1.0 },
        ...(royalty > 0 ? [{ id: "c-royalty", kind: "coin" as const, amount: royalty, label: "artist royalty", tone: "transit" as Tone, from: "vault" as Anchor, to: "artist" as Anchor, delay: 1.15 }] : []),
        { id: "c-fee", kind: "coin", amount: fee, label: "SeatSafe fee", tone: "neutral", from: "vault", to: "seatsafe", delay: 1.3 },
      ],
    };
    const s4: Frame = {
      ...s3,
      flights: [],
      vaultState: "idle",
      banner: { tone: "released", title: "Done in one transaction", text: "Ticket and money moved together. If any part had failed, nothing would have moved." },
    };
    return [
      { title: "Sam's ticket", action: "Show Sam's ticket", caption: "Sam owns a ticket. The padlock means it's frozen on Solana: only the SeatSafe program can move it, so it can't be sold around the rules.", frame: s0, live: { action: "a_prepare" } },
      { title: `Try ${money(t.over)}`, action: `List at ${money(t.over)}`, caption: `Sam tries to resell for ${money(t.over)}. The artist capped resale at ${money(t.cap)}, and the program itself refuses.`, frame: s1, live: { action: "a_list_over", expectFail: true } },
      { title: `List at ${money(t.resale)}`, action: `List at ${money(t.resale)}`, caption: `Sam lists at ${money(t.resale)}, under the cap. The ticket now waits in a SeatSafe listing vault, still locked.`, frame: s2, live: { action: "a_list" } },
      { title: "Bea buys", action: "Bea buys", caption: `In ONE transaction: Bea's ${money(t.resale)} goes in, the ticket goes to Bea, and the money splits: ${money(sellerGets)} to Sam${royalty > 0 ? `, ${money(royalty)} to the artist` : ""}, ${money(fee)} to SeatSafe.`, frame: s3, live: { action: "a_buy" } },
      { title: "Done", action: "Finish", caption: "The ticket is frozen again, now in Bea's wallet. No screenshots, no trust, no way to scam.", frame: s4 },
    ];
  }

  // Escrow scenarios share the first two steps.
  const e0: Frame = { ...base, ticket: { at: "seller", lock: "unlocked", outside: true } };
  const e1: Frame = { ...e0, seller: r2(e0.seller - t.bond), vault: t.bond, vaultState: "holding", flights: [{ id: "c-bond", kind: "coin", amount: t.bond, label: "Sam's bond", tone: "transit", from: "seller", to: "vault" }] };
  const e2: Frame = { ...e1, buyer: r2(e1.buyer - t.escrowPrice), vault: r2(e1.vault + t.escrowPrice), countdown: t.windowSecs, flights: [{ id: "c-pay", kind: "coin", amount: t.escrowPrice, label: "Bea pays", from: "buyer", to: "vault" }] };
  const intro: Step = { title: "Outside ticket", action: "Start", caption: "Sam says he has a ticket from another site (a PDF). SeatSafe can't see it, so it protects the money instead.", frame: e0 };
  const list: Step = { title: `List + ${money(t.bond)} bond`, action: `List for ${money(t.escrowPrice)}`, caption: `Sam lists it for ${money(t.escrowPrice)}. To list, he must lock a ${money(t.bond)} bond in the vault: he loses it if he doesn't deliver.`, frame: e1, live: { action: "b_list" } };
  const pay: Step = { title: "Bea pays", action: `Bea pays ${money(t.escrowPrice)}`, caption: `Bea's ${money(t.escrowPrice)} goes into the vault, not to Sam. Sam can't touch this money. He has ${t.windowSecs} seconds to send the ticket.`, frame: e2, live: { action: "b_fund" } };

  if (id === "scam") {
    const e3: Frame = { ...e2, flights: [], vaultState: "slammed", sellerTone: "disputed", banner: { tone: "disputed", title: "Blocked by the program", text: "The vault won't pay Sam before Bea has her ticket. Only the rules in SeatSafe's code can open it." } };
    const e4: Frame = { ...e3, vaultState: "holding", banner: undefined, sellerTone: "disputed", countdown: 0 };
    const e5: Frame = {
      ...e4,
      buyer: r2(e4.buyer + e4.vault),
      vault: 0,
      vaultState: "open",
      countdown: undefined,
      buyerTone: "released",
      flights: [
        { id: "c-refund", kind: "coin", amount: t.escrowPrice, label: "refund", tone: "released", from: "vault", to: "buyer" },
        { id: "c-bond-back", kind: "coin", amount: t.bond, label: "Sam's bond", tone: "released", from: "vault", to: "buyer", delay: 0.25 },
      ],
      banner: { tone: "released", title: "Scam stopped", text: `Bea got her ${money(t.escrowPrice)} back, plus Sam's ${money(t.bond)} bond. Automatically, no support ticket.` },
    };
    return [
      intro,
      list,
      pay,
      { title: "Sam grabs the money", action: "Sam tries to withdraw", caption: "Sam tries to take Bea's money without sending the ticket. The vault slams shut.", frame: e3, live: { action: "b_steal", expectFail: true } },
      { title: "Sam vanishes", action: "Fast-forward 60 s", caption: "Sam never sends the ticket. The deadline runs out.", frame: e4, waitForDeadline: true },
      { title: "Refund", action: "Bea claims refund", caption: "The deadline passed, so the program sends everything in the vault back to Bea.", frame: e5, live: { action: "b_refund" } },
    ];
  }

  // honest
  const h3: Frame = { ...e2, flights: [{ id: "t-sent", kind: "ticket", from: "seller", to: "buyer" }], ticket: { at: "buyer", lock: "unlocked", outside: true }, countdown: undefined, buyerTone: "transit" };
  const h4: Frame = {
    ...h3,
    seller: r2(h3.seller + t.escrowPrice - escrowFee + t.bond),
    seatsafe: escrowFee,
    vault: 0,
    vaultState: "open",
    buyerTone: "released",
    sellerTone: "released",
    flights: [
      { id: "c-paid", kind: "coin", amount: r2(t.escrowPrice - escrowFee), label: "to Sam", tone: "released", from: "vault", to: "seller" },
      { id: "c-bond-back", kind: "coin", amount: t.bond, label: "bond back", tone: "released", from: "vault", to: "seller", delay: 0.2 },
      { id: "c-fee", kind: "coin", amount: escrowFee, label: "SeatSafe fee", tone: "neutral", from: "vault", to: "seatsafe", delay: 0.35 },
    ],
    banner: { tone: "released", title: "Honest sale complete", text: "Bea confirmed the ticket works, so the vault paid Sam and returned his bond." },
  };
  return [
    intro,
    list,
    pay,
    { title: "Sam sends it", action: "Sam sends the ticket", caption: "Sam sends the ticket (email / app transfer) and marks it sent. Now Bea has a window to check it.", frame: h3, live: { action: "c_sent" } },
    { title: "Bea confirms", action: "Bea confirms", caption: "Bea confirms it works. Only now does the vault pay Sam.", frame: h4, live: { action: "c_confirm" } },
  ];
}

function money(n: number): string {
  return `$${Number.isInteger(n) ? n : n.toFixed(2)}`;
}
