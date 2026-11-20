// Owner: B to review, added by A. Live mode of the Resale Simulator (/simulator): runs each step as a real
// devnet transaction between two server-held demo wallets ("Sam" seller, "Bea" buyer), relayer as fee payer.
//
// Keys (never sent to the client, never committed): SIM_SELLER_SECRET_KEY / SIM_BUYER_SECRET_KEY env vars
// (JSON byte array or base58), else ../.keys/sim-seller.json / sim-buyer.json (local dev).
// Every tx: built by lib/program.ts, checked by lib/relay-policy.ts, SIMULATED first (expected program errors
// such as AboveResaleCap come back as { ok:false } without sending), then sent and confirmed.

import * as fs from "fs";
import * as path from "path";
import { Keypair, PublicKey } from "@solana/web3.js";
import { utils } from "@coral-xyz/anchor";
import * as P from "@/lib/program";
import { connection, PROGRAM_ID } from "@/lib/solana";
import { checkRelayTx } from "@/lib/relay-policy";
import { friendlyError, programErrorName, TxError } from "@/lib/errors";
import { getMyTickets } from "@/lib/chain";
import { loadRelayer } from "@/lib/server/relayer";
import idl from "@/lib/idl/seatsafe.json";
import bundledMeta from "@/lib/event-meta.json";
import type { LiveAction } from "@/app/simulator/scenarios";

const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
export const SIM = { resale: 14, over: 50, escrowPrice: 20, bond: 2, windowSecs: 60 } as const;

function parseKey(raw: string): Keypair {
  const s = raw.trim();
  return Keypair.fromSecretKey(s.startsWith("[") ? Uint8Array.from(JSON.parse(s) as number[]) : utils.bytes.bs58.decode(s));
}
function loadKey(envName: string, file: string): Keypair | null {
  try {
    const env = process.env[envName]?.trim();
    if (env) return parseKey(env);
    const p = path.join(process.cwd(), "..", ".keys", file);
    return fs.existsSync(p) ? parseKey(fs.readFileSync(p, "utf8")) : null;
  } catch {
    return null;
  }
}

let devnetChecked: boolean | null = null;
async function isDevnet(): Promise<boolean> {
  if (devnetChecked === null) devnetChecked = (await connection.getGenesisHash().catch(() => "")) === DEVNET_GENESIS;
  return devnetChecked;
}

/** Battle of the Bands ($10, cap $15, 0% royalty): the event the live scenarios use. */
export function demoEventId(): PublicKey {
  const events = (bundledMeta as { events?: Record<string, { title?: string }> }).events ?? {};
  const id = Object.entries(events).find(([, m]) => /battle of the bands/i.test(m.title ?? ""))?.[0];
  if (!id) throw new Error("Battle of the Bands not found in event-meta.json");
  return new PublicKey(id);
}

export interface SimWallets {
  seller: Keypair;
  buyer: Keypair;
  relayer: Keypair;
}

/** Why live mode is off, or the wallets. */
export async function simWallets(): Promise<{ ok: true; w: SimWallets } | { ok: false; reason: string }> {
  if (process.env.SIM_LIVE_ENABLED !== "true") return { ok: false, reason: "Live mode is off (set SIM_LIVE_ENABLED=true on the server)." };
  if (!(await isDevnet())) return { ok: false, reason: "Live mode only runs on Solana devnet." };
  const relayer = loadRelayer();
  if (!relayer) return { ok: false, reason: "Relayer not configured (RELAYER_SECRET_KEY)." };
  const seller = loadKey("SIM_SELLER_SECRET_KEY", "sim-seller.json");
  const buyer = loadKey("SIM_BUYER_SECRET_KEY", "sim-buyer.json");
  if (!seller || !buyer) return { ok: false, reason: "Simulator wallets not configured (SIM_SELLER_SECRET_KEY / SIM_BUYER_SECRET_KEY)." };
  return { ok: true, w: { seller, buyer, relayer } };
}

async function usdc(owner: PublicKey): Promise<number> {
  const cfg = await P.getConfig(P.getProgram(connection, programId()));
  const r = await connection.getTokenAccountBalance(P.usdcAta(cfg.usdc, owner)).catch(() => null);
  return Number(r?.value.uiAmount ?? 0);
}
const programId = () => PROGRAM_ID ?? new PublicKey((idl as { address: string }).address);

export async function balances(w: SimWallets) {
  const [seller, buyer, relayerLamports] = await Promise.all([usdc(w.seller.publicKey), usdc(w.buyer.publicKey), connection.getBalance(w.relayer.publicKey)]);
  return { seller, buyer, relayerSol: relayerLamports / 1e9, sellerAddress: w.seller.publicKey.toBase58(), buyerAddress: w.buyer.publicKey.toBase58() };
}

export interface StepContext {
  ticketMint?: string;
  escrow?: string;
}
export interface StepResult {
  /** Program log lines of a rejected (simulated) transaction. */
  logs?: string[];
  ok: boolean;
  signature?: string;
  /** Program error name for expected rejections (AboveResaleCap, InvalidState, ...). */
  errorName?: string;
  /** Plain-English message for the UI. */
  message?: string;
  /** Funding problem: what to send where. */
  needsFunding?: string;
  context: StepContext;
  shipDeadline?: string;
}

/** Plain English for the rejections the scenarios trigger on purpose. */
function explain(action: LiveAction, err: unknown): string {
  const name = programErrorName(err);
  if (action === "a_list_over" && name === "AboveResaleCap") return `Blocked by the program: $${SIM.over} is above the artist's $15 cap. Nothing was listed.`;
  if (action === "b_steal" && name === "InvalidState") return "Blocked by the program: the vault only pays Sam after Bea confirms the ticket (or her confirm window ends).";
  if (action === "b_refund" && name === "DeadlineNotReached") return "Not yet: Sam still has time to send the ticket.";
  return friendlyError(err, { resaleCapUsd: 15 }).message;
}

async function sendAs(w: SimWallets, signer: Keypair, built: P.BuiltTx, action: LiveAction): Promise<{ ok: boolean; signature?: string; errorName?: string; message?: string; logs?: string[] }> {
  const verdict = checkRelayTx(built.tx, w.relayer.publicKey, programId(), { requireOtherSignatures: false });
  if (!verdict.ok) return { ok: false, message: `Rejected by relay policy: ${verdict.reason}` };
  const sim = await connection.simulateTransaction(built.tx, { sigVerify: false });
  if (sim.value.err) {
    const err = new TxError("Simulation failed", sim.value.logs ?? []);
    // Logs let the Live Lab X-ray show the program's own error line.
    return { ok: false, errorName: programErrorName(err), message: explain(action, err), logs: (sim.value.logs ?? []).filter((l) => /Program log|failed|Error/.test(l)).slice(-6) };
  }
  built.tx.sign([signer, w.relayer]);
  const signature = await connection.sendRawTransaction(built.tx.serialize(), { preflightCommitment: "confirmed" });
  const res = await connection.confirmTransaction(
    { signature, blockhash: built.tx.message.recentBlockhash, lastValidBlockHeight: built.lastValidBlockHeight },
    "confirmed",
  );
  if (res.value.err) return { ok: false, signature, message: `Transaction failed: ${JSON.stringify(res.value.err)}` };
  return { ok: true, signature };
}

export async function runStep(w: SimWallets, action: LiveAction, ctx: StepContext): Promise<StepResult> {
  const program = P.getProgram(connection, programId());
  const asSeller = { program, user: w.seller.publicKey, payer: w.relayer.publicKey };
  const asBuyer = { program, user: w.buyer.publicKey, payer: w.relayer.publicKey };
  const event = demoEventId();
  const need = async (who: "seller" | "buyer", amount: number): Promise<string | null> => {
    const kp = who === "seller" ? w.seller : w.buyer;
    const have = await usdc(kp.publicKey);
    return have + 1e-9 >= amount
      ? null
      : `${who === "seller" ? "Sam (seller)" : "Bea (buyer)"} needs $${amount} devnet USDC and has $${have}. Send it to ${kp.publicKey.toBase58()} (faucet.circle.com, Solana devnet).`;
  };
  const mint = () => {
    if (!ctx.ticketMint) throw new Error("No ticket yet: run the first step again.");
    return new PublicKey(ctx.ticketMint);
  };
  const escrow = () => {
    if (!ctx.escrow) throw new Error("No escrow yet: run the listing step again.");
    return new PublicKey(ctx.escrow);
  };
  const done = (r: Awaited<ReturnType<typeof sendAs>>, context: StepContext = ctx): StepResult => ({ ...r, context });

  switch (action) {
    case "a_prepare": {
      // Reuse an unlisted Battle of the Bands ticket Sam holds; take back a leftover listing; else buy one.
      const mine = (await getMyTickets(w.seller.publicKey.toBase58())).filter((t) => t.eventId === event.toBase58() && t.tier === 1);
      const free = mine.find((t) => !t.listed);
      if (free) return { ok: true, context: { ticketMint: free.id }, message: "Sam already holds a ticket." };
      const listed = mine.find((t) => t.listed);
      if (listed) {
        const r = await sendAs(w, w.seller, await P.cancelListing(asSeller, { ticketMint: new PublicKey(listed.id) }), action);
        return done(r, { ticketMint: listed.id });
      }
      const ev = await program.account.event.fetch(event);
      const short = await need("seller", P.fromBaseUnits(ev.price));
      if (short) return { ok: false, needsFunding: short, message: short, context: ctx };
      const built = await P.buyPrimary(asSeller, { event, seat: `Sim GA ${ev.sold + 1}` });
      return done(await sendAs(w, w.seller, built, action), { ticketMint: built.address!.toBase58() });
    }
    case "a_list_over":
      return done(await sendAs(w, w.seller, await P.listResale(asSeller, { ticketMint: mint(), priceUsd: SIM.over }), action));
    case "a_list":
      return done(await sendAs(w, w.seller, await P.listResale(asSeller, { ticketMint: mint(), priceUsd: SIM.resale }), action));
    case "a_buy": {
      const short = await need("buyer", SIM.resale);
      if (short) return { ok: false, needsFunding: short, message: short, context: ctx };
      return done(await sendAs(w, w.buyer, await P.swapResale(asBuyer, { ticketMint: mint() }), action));
    }
    case "b_list": {
      const short = await need("seller", SIM.bond);
      if (short) return { ok: false, needsFunding: short, message: short, context: ctx };
      const built = await P.createEscrowListing(asSeller, { priceUsd: SIM.escrowPrice, bondUsd: SIM.bond, shipWindowSecs: SIM.windowSecs, confirmWindowSecs: SIM.windowSecs });
      return done(await sendAs(w, w.seller, built, action), { escrow: built.address!.toBase58() });
    }
    case "b_fund": {
      const short = await need("buyer", SIM.escrowPrice);
      if (short) return { ok: false, needsFunding: short, message: short, context: ctx };
      const r = await sendAs(w, w.buyer, await P.fundEscrow(asBuyer, { escrow: escrow() }), action);
      const e = r.ok ? await program.account.escrowOrder.fetch(escrow()) : null;
      return { ...done(r), shipDeadline: e ? new Date(Number(e.shipDeadline.toString()) * 1000).toISOString() : undefined };
    }
    case "b_steal":
      // Sam (as caller) tries to release the payment to himself while the order is only Funded.
      return done(await sendAs(w, w.seller, await P.releaseExpired(asSeller, { escrow: escrow() }), action));
    case "b_refund":
      return done(await sendAs(w, w.buyer, await P.refundExpired(asBuyer, { escrow: escrow() }), action));
    case "c_sent":
      return done(await sendAs(w, w.seller, await P.markSent(asSeller, { escrow: escrow() }), action));
    case "c_confirm":
      return done(await sendAs(w, w.buyer, await P.confirmReceipt(asBuyer, { escrow: escrow() }), action));
  }
}
