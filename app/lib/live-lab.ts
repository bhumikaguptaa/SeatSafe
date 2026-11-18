// Owner: A. Live Lab: real devnet state for /simulator. Every number and padlock on the Live Lab stage comes
// from here, never from the click that started an action.
//   snapshot(): ONE getMultipleAccountsInfo per poll (public devnet rate-limits): order/listing account,
//               vault token account, both wallets' USDC, the ticket's token accounts (amount + frozen flag).
//   xray(sig):  the confirmed transaction: signer, fee payer, SOL fee, instruction names, program log lines,
//               compute units, token balance changes, decoded SeatSafe events.

import { BorshCoder, type Idl } from "@coral-xyz/anchor";
import { PublicKey, type AccountInfo } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, unpackAccount } from "@solana/spl-token";
import { chainProgram } from "./chain";
import { pdas, ticketAta } from "./program";
import { connection, PROGRAM_ID, USDC_MINT } from "./solana";
import idl from "./idl/seatsafe.json";

export const LIVE_PROGRAM_ID = PROGRAM_ID ?? new PublicKey((idl as { address: string }).address);
const usdcAta = (owner: PublicKey) => getAssociatedTokenAddressSync(USDC_MINT, owner, true, TOKEN_PROGRAM_ID);
const usd = (raw: bigint | number | string) => Number(raw) / 1_000_000;

export type EscrowStateName = "listed" | "funded" | "sent" | "completed" | "refunded" | "cancelled" | "disputed" | "resolved";

export interface TicketHolding {
  /** Which known account holds the ticket right now. */
  holder: "seller" | "buyer" | "vault" | "unknown";
  frozen: boolean;
  /** Token-2022 account that holds it (explorer link). */
  account: string | null;
}

export interface LiveSnapshot {
  at: number;
  slot: number;
  sellerUsd: number | null;
  buyerUsd: number | null;
  /** USDC in the escrow vault (Tier 2). Tier 1 listing vaults hold the ticket, not USDC: 0. */
  vaultUsd: number;
  vaultAccount: string | null;
  ticket: TicketHolding | null;
  /** Tier 1: the listing account exists (ticket for sale). */
  listingOpen?: boolean;
  listingPriceUsd?: number;
  listingSeller?: string;
  /** Tier 2 */
  escrowState?: EscrowStateName | null;
  escrowSeller?: string;
  escrowBuyer?: string | null;
  priceUsd?: number;
  bondUsd?: number;
  shipDeadline?: number | null; // unix ms
  confirmDeadline?: number | null;
}

function decodeAccount<T>(names: string[], data: Buffer): T | null {
  const coder = chainProgram().coder.accounts;
  for (const n of names) {
    try {
      return coder.decode(n, data) as T;
    } catch {
      // try the next spelling (Anchor converts IDL names to camelCase in some versions)
    }
  }
  return null;
}

function tokenAccount(address: PublicKey, info: AccountInfo<Buffer> | null, programId: PublicKey) {
  if (!info) return null;
  try {
    return unpackAccount(address, info, programId);
  } catch {
    return null;
  }
}

/** Tier 1: listing (PDA of the mint) + ticket token accounts for seller, buyer and the listing vault. */
export async function snapshotTier1(args: { mint: string; seller: string | null; buyer: string | null }): Promise<LiveSnapshot> {
  const mint = new PublicKey(args.mint);
  const listing = pdas(LIVE_PROGRAM_ID).listing(mint);
  const vault = ticketAta(mint, listing);
  const seller = args.seller ? new PublicKey(args.seller) : null;
  const buyer = args.buyer ? new PublicKey(args.buyer) : null;
  const keys = [listing, vault, seller && usdcAta(seller), buyer && usdcAta(buyer), seller && ticketAta(mint, seller), buyer && ticketAta(mint, buyer)].filter(
    (k): k is PublicKey => k !== null,
  );
  const res = await connection.getMultipleAccountsInfoAndContext(keys, "confirmed");
  const byKey = new Map(keys.map((k, i) => [k.toBase58(), res.value[i]]));
  const get = (k: PublicKey | null) => (k ? byKey.get(k.toBase58()) ?? null : null);

  const l = get(listing) ? decodeAccount<{ seller: PublicKey; price: { toString(): string } }>(["listing", "Listing"], get(listing)!.data) : null;
  const holdings: [TicketHolding["holder"], PublicKey | null][] = [["vault", vault], ["seller", seller && ticketAta(mint, seller)], ["buyer", buyer && ticketAta(mint, buyer)]];
  let ticket: TicketHolding | null = null;
  for (const [holder, acct] of holdings) {
    if (!acct) continue;
    const t = tokenAccount(acct, get(acct), TOKEN_2022_PROGRAM_ID);
    if (t && t.amount > BigInt(0)) {
      ticket = { holder, frozen: t.isFrozen, account: acct.toBase58() };
      break;
    }
  }
  const sellerUsdc = seller ? tokenAccount(usdcAta(seller), get(usdcAta(seller)), TOKEN_PROGRAM_ID) : null;
  const buyerUsdc = buyer ? tokenAccount(usdcAta(buyer), get(usdcAta(buyer)), TOKEN_PROGRAM_ID) : null;
  return {
    at: Date.now(),
    slot: res.context.slot,
    sellerUsd: seller ? usd(sellerUsdc?.amount ?? BigInt(0)) : null,
    buyerUsd: buyer ? usd(buyerUsdc?.amount ?? BigInt(0)) : null,
    vaultUsd: 0,
    vaultAccount: vault.toBase58(),
    ticket,
    listingOpen: Boolean(l),
    listingPriceUsd: l ? usd(l.price.toString()) : undefined,
    listingSeller: l?.seller.toBase58(),
  };
}

/** Tier 2: escrow order + its USDC vault + both wallets. Buyer defaults to the escrow's buyer once funded. */
export async function snapshotTier2(args: { escrow: string; seller: string | null; buyer: string | null }): Promise<LiveSnapshot> {
  const escrow = new PublicKey(args.escrow);
  const vault = usdcAta(escrow);
  // First read the order to learn seller/buyer if the caller didn't pass them.
  const first = await connection.getAccountInfo(escrow, "confirmed");
  type Raw = {
    seller: PublicKey;
    buyer: PublicKey | null;
    price: { toString(): string };
    bond: { toString(): string };
    state: Record<string, unknown>;
    shipDeadline: { toString(): string };
    confirmDeadline: { toString(): string };
  };
  const e = first ? decodeAccount<Raw>(["escrowOrder", "EscrowOrder"], first.data) : null;
  const sellerKey = args.seller ?? e?.seller.toBase58() ?? null;
  const buyerKey = args.buyer ?? e?.buyer?.toBase58() ?? null;
  const seller = sellerKey ? new PublicKey(sellerKey) : null;
  const buyer = buyerKey ? new PublicKey(buyerKey) : null;
  const keys = [vault, seller && usdcAta(seller), buyer && usdcAta(buyer)].filter((k): k is PublicKey => k !== null);
  const res = await connection.getMultipleAccountsInfoAndContext(keys, "confirmed");
  const byKey = new Map(keys.map((k, i) => [k.toBase58(), res.value[i]]));
  const bal = (k: PublicKey | null) => (k ? usd(tokenAccount(k, byKey.get(k.toBase58()) ?? null, TOKEN_PROGRAM_ID)?.amount ?? BigInt(0)) : null);
  const secs = (v: { toString(): string } | undefined) => {
    const n = v ? Number(v.toString()) : 0;
    return n > 0 ? n * 1000 : null;
  };
  return {
    at: Date.now(),
    slot: res.context.slot,
    sellerUsd: seller ? bal(usdcAta(seller)) : null,
    buyerUsd: buyer ? bal(usdcAta(buyer)) : null,
    vaultUsd: bal(vault) ?? 0,
    vaultAccount: vault.toBase58(),
    ticket: null,
    escrowState: e ? (Object.keys(e.state)[0] as EscrowStateName) : null,
    escrowSeller: e?.seller.toBase58(),
    escrowBuyer: e?.buyer?.toBase58() ?? null,
    priceUsd: e ? usd(e.price.toString()) : undefined,
    bondUsd: e ? usd(e.bond.toString()) : undefined,
    shipDeadline: secs(e?.shipDeadline),
    confirmDeadline: secs(e?.confirmDeadline),
  };
}

// ---------------------------------------------------------------------------
// X-ray of a confirmed transaction
// ---------------------------------------------------------------------------

export interface TokenDelta {
  owner: string;
  mint: string;
  /** USDC in dollars; tickets in units (+1 / −1). */
  delta: number;
  isUsdc: boolean;
}
export interface DecodedEvent {
  name: string;
  fields: Record<string, string>;
}
export interface XRay {
  signature: string;
  blockTime: number | null; // unix ms
  slot: number;
  feePayer: string;
  signers: string[];
  feeSol: number;
  computeUnits: number | null;
  instructions: string[];
  programLogs: string[];
  deltas: TokenDelta[];
  events: DecodedEvent[];
  err: unknown;
}

let coder: BorshCoder | null = null;
function eventCoder(): BorshCoder {
  if (!coder) coder = new BorshCoder(idl as Idl);
  return coder;
}

function plain(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "object" && v !== null && "toBase58" in v && typeof (v as PublicKey).toBase58 === "function") return (v as PublicKey).toBase58();
  if (typeof v === "object" && v !== null && "toString" in v) {
    const s = String(v);
    return s === "[object Object]" ? JSON.stringify(v) : s;
  }
  return String(v);
}

export function decodeEvents(logs: string[]): DecodedEvent[] {
  const out: DecodedEvent[] = [];
  for (const line of logs) {
    const i = line.indexOf("Program data: ");
    if (i < 0) continue;
    try {
      const ev = eventCoder().events.decode(line.slice(i + "Program data: ".length).trim());
      if (ev) out.push({ name: ev.name, fields: Object.fromEntries(Object.entries(ev.data as Record<string, unknown>).map(([k, v]) => [k, plain(v)])) });
    } catch {
      // not one of our events
    }
  }
  return out;
}

/** Waits for the confirmed transaction to be queryable (RPC lag), then reads it. */
export async function xray(signature: string, tries = 10): Promise<XRay | null> {
  for (let i = 0; i < tries; i++) {
    const tx = await connection.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 }).catch(() => null);
    if (tx?.meta) {
      const keys = tx.transaction.message.getAccountKeys({ accountKeysFromLookups: tx.meta.loadedAddresses });
      const nSigners = tx.transaction.message.header.numRequiredSignatures;
      const signers = Array.from({ length: nSigners }, (_, k) => keys.get(k)!.toBase58());
      const logs = tx.meta.logMessages ?? [];
      const pre = tx.meta.preTokenBalances ?? [];
      const post = tx.meta.postTokenBalances ?? [];
      const ids = new Set([...pre, ...post].map((b) => `${b.accountIndex}`));
      const deltas: TokenDelta[] = [];
      for (const id of ids) {
        const a = pre.find((b) => `${b.accountIndex}` === id);
        const b = post.find((x) => `${x.accountIndex}` === id);
        const mint = (b ?? a)!.mint;
        const owner = (b ?? a)!.owner ?? "";
        const before = Number(a?.uiTokenAmount.uiAmount ?? 0);
        const after = Number(b?.uiTokenAmount.uiAmount ?? 0);
        const d = Math.round((after - before) * 1e6) / 1e6;
        if (d !== 0) deltas.push({ owner, mint, delta: d, isUsdc: mint === USDC_MINT.toBase58() });
      }
      return {
        signature,
        blockTime: tx.blockTime ? tx.blockTime * 1000 : null,
        slot: tx.slot,
        feePayer: signers[0] ?? "",
        signers,
        feeSol: tx.meta.fee / 1e9,
        computeUnits: tx.meta.computeUnitsConsumed ?? null,
        instructions: logs.filter((l) => l.startsWith("Program log: Instruction: ")).map((l) => l.slice("Program log: Instruction: ".length)),
        programLogs: logs.filter((l) => l.includes(LIVE_PROGRAM_ID.toBase58()) || l.startsWith("Program log:") || l.startsWith("Program data:")),
        deltas,
        events: decodeEvents(logs),
        err: tx.meta.err,
      };
    }
    await new Promise((r) => setTimeout(r, 700));
  }
  return null;
}

export const short = (k: string | null | undefined) => (k ? `${k.slice(0, 4)}…${k.slice(-4)}` : "");
