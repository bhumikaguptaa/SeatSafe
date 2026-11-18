// Owner: A. SeatSafe program client: typed Anchor Program, PDA helpers, and one transaction
// builder per instruction the UI uses. Account layouts and seeds follow docs/program.md.
//
// No React and no "@/" imports here, so Node scripts (program/scripts, the integration test)
// can use the same builders as the app.
//
// Every builder returns an UNSIGNED v0 VersionedTransaction whose fee payer is `ctx.payer`
// (the relayer, or the user in fallback mode). `ctx.payer` is also passed as the program's
// `payer` account, so whoever pays fees also pays rent. The user signs; the payer co-signs.

import { AnchorProvider, BN, Program, type Idl } from "@coral-xyz/anchor";
import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import idlJson from "./idl/seatsafe.json";
import type { Seatsafe } from "./idl/seatsafe";

// ---------------------------------------------------------------------------
// Program + connection
// ---------------------------------------------------------------------------

export type SeatsafeProgram = Program<Seatsafe>;

const programCache = new Map<string, SeatsafeProgram>();

/**
 * Read-only Program bound to `connection` (no wallet: we only build instructions and fetch accounts).
 * `programId` defaults to the IDL address; the app passes NEXT_PUBLIC_PROGRAM_ID.
 */
export function getProgram(connection: Connection, programId?: PublicKey): SeatsafeProgram {
  const address = (programId ?? new PublicKey(idlJson.address)).toBase58();
  const key = `${connection.rpcEndpoint}|${address}`;
  let program = programCache.get(key);
  if (!program) {
    const idl = { ...(idlJson as Idl), address } as unknown as Seatsafe;
    // A provider with only a connection is enough for .instruction() and account fetches.
    program = new Program<Seatsafe>(idl, { connection } as unknown as AnchorProvider);
    programCache.set(key, program);
  }
  return program;
}

// ---------------------------------------------------------------------------
// Money: the UI uses dollars (number), the program uses USDC base units (6 decimals).
// ---------------------------------------------------------------------------

export const USDC_DECIMALS = 6;
const UNITS_PER_USD = 10 ** USDC_DECIMALS;

/** $12.34 -> BN(12_340_000). Rounds to the nearest base unit. */
export function toBaseUnits(usd: number): BN {
  if (!Number.isFinite(usd) || usd < 0) throw new Error(`Invalid USD amount: ${usd}`);
  return new BN(Math.round(usd * UNITS_PER_USD).toString());
}

/** BN / bigint / number of base units -> dollars. */
export function fromBaseUnits(units: BN | bigint | number): number {
  const n = typeof units === "number" ? units : Number(units.toString());
  return n / UNITS_PER_USD;
}

// ---------------------------------------------------------------------------
// PDAs (seeds exactly as docs/program.md "Accounts (PDAs)")
// ---------------------------------------------------------------------------

const u64le = (n: number | BN | bigint) => new BN(n.toString()).toArrayLike(Buffer, "le", 8);
const u32le = (n: number) => new BN(n).toArrayLike(Buffer, "le", 4);

export function pdas(programId: PublicKey) {
  const find = (...seeds: Buffer[]) => PublicKey.findProgramAddressSync(seeds, programId)[0];
  return {
    config: () => find(Buffer.from("config")),
    ticketAuthority: () => find(Buffer.from("ticket_authority")),
    event: (organizer: PublicKey, eventId: number | BN | bigint) =>
      find(Buffer.from("event"), organizer.toBuffer(), u64le(eventId)),
    /** `sold` is the event's sold count BEFORE the purchase. */
    ticketMint: (event: PublicKey, sold: number) =>
      find(Buffer.from("ticket_mint"), event.toBuffer(), u32le(sold)),
    ticketRecord: (ticketMint: PublicKey) => find(Buffer.from("ticket"), ticketMint.toBuffer()),
    listing: (ticketMint: PublicKey) => find(Buffer.from("listing"), ticketMint.toBuffer()),
    escrow: (seller: PublicKey, orderId: number | BN | bigint) =>
      find(Buffer.from("escrow"), seller.toBuffer(), u64le(orderId)),
    standingOrder: (owner: PublicKey, orderId: number | BN | bigint) =>
      find(Buffer.from("standing"), owner.toBuffer(), u64le(orderId)),
  };
}

/** Token-2022 ATA holding a ticket (owner may be a PDA, e.g. the listing vault). */
export function ticketAta(ticketMint: PublicKey, owner: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(ticketMint, owner, true, TOKEN_2022_PROGRAM_ID);
}

/** USDC ATA for `owner` under the USDC mint's own token program (classic SPL on devnet). */
export function usdcAta(usdc: UsdcInfo, owner: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(usdc.mint, owner, true, usdc.tokenProgram);
}

/** Vaults: the listing vault holds a Tier 1 ticket; escrow and budget vaults hold USDC. */
export const vaults = {
  listing: (programId: PublicKey, ticketMint: PublicKey) =>
    ticketAta(ticketMint, pdas(programId).listing(ticketMint)),
  escrow: (usdc: UsdcInfo, escrowPda: PublicKey) => usdcAta(usdc, escrowPda),
  budget: (usdc: UsdcInfo, standingOrderPda: PublicKey) => usdcAta(usdc, standingOrderPda),
};

// ---------------------------------------------------------------------------
// Config (cached): treasury and USDC mint come from the onchain Config, not from env,
// so the same builders work on devnet and on a local validator with a test mint.
// ---------------------------------------------------------------------------

export interface UsdcInfo {
  mint: PublicKey;
  /** Owner program of the mint: classic SPL Token for Circle USDC. */
  tokenProgram: PublicKey;
}

export interface ConfigInfo {
  address: PublicKey;
  treasury: PublicKey;
  arbiter: PublicKey;
  feeBps: number;
  disputeWindowSecs: number;
  usdc: UsdcInfo;
}

const configCache = new Map<string, Promise<ConfigInfo>>();

export function getConfig(program: SeatsafeProgram): Promise<ConfigInfo> {
  const key = `${program.provider.connection.rpcEndpoint}|${program.programId.toBase58()}`;
  let p = configCache.get(key);
  if (!p) {
    p = (async () => {
      const address = pdas(program.programId).config();
      const c = await program.account.config.fetch(address);
      const mintInfo = await program.provider.connection.getAccountInfo(c.usdcMint);
      if (!mintInfo) throw new Error(`USDC mint ${c.usdcMint.toBase58()} not found`);
      return {
        address,
        treasury: c.treasury,
        arbiter: c.arbiter,
        feeBps: c.feeBps,
        disputeWindowSecs: Number(c.disputeWindowSecs.toString()),
        usdc: { mint: c.usdcMint, tokenProgram: mintInfo.owner },
      };
    })();
    p.catch(() => configCache.delete(key)); // retry next time if it failed
    configCache.set(key, p);
  }
  return p;
}

// ---------------------------------------------------------------------------
// Transaction assembly
// ---------------------------------------------------------------------------

/** Who signs: `user` authorizes, `payer` (relayer or user) pays fees and rent. */
export interface TxCtx {
  program: SeatsafeProgram;
  user: PublicKey;
  payer: PublicKey;
}

export interface BuiltTx {
  tx: VersionedTransaction;
  /** Blockhash expiry, for confirmTransaction. */
  lastValidBlockHeight: number;
  /** Main account the action created or acted on (event, listing, escrow, ...). */
  address?: PublicKey;
}

/** buy_primary and the swaps mint/move Token-2022 tickets and need more than the 200k CU default. */
const HEAVY_CU = 600_000;

async function toTx(
  ctx: TxCtx,
  ixs: TransactionInstruction[],
  opts: { computeUnits?: number; address?: PublicKey } = {},
): Promise<BuiltTx> {
  const connection = ctx.program.provider.connection;
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const all = opts.computeUnits
    ? [ComputeBudgetProgram.setComputeUnitLimit({ units: opts.computeUnits }), ...ixs]
    : ixs;
  const message = new TransactionMessage({
    payerKey: ctx.payer,
    recentBlockhash: blockhash,
    instructions: all,
  }).compileToV0Message();
  return { tx: new VersionedTransaction(message), lastValidBlockHeight, address: opts.address };
}

// ---------------------------------------------------------------------------
// Builders: Tier 1
// ---------------------------------------------------------------------------

export async function createEvent(
  ctx: TxCtx,
  args: {
    /** Client-chosen, unique per organizer. Default: current time in ms. */
    eventId?: number;
    priceUsd: number;
    supply: number;
    resaleCapUsd: number;
    royaltyBps: number;
    startsAt: Date;
  },
): Promise<BuiltTx> {
  const { program, user, payer } = ctx;
  const eventId = args.eventId ?? Date.now();
  const event = pdas(program.programId).event(user, eventId);
  const ix = await program.methods
    .createEvent(
      new BN(eventId),
      toBaseUnits(args.priceUsd),
      args.supply,
      toBaseUnits(args.resaleCapUsd),
      args.royaltyBps,
      new BN(Math.floor(args.startsAt.getTime() / 1000)),
    )
    .accountsPartial({ payer, organizer: user, event })
    .instruction();
  return toTx(ctx, [ix], { address: event });
}

export async function buyPrimary(
  ctx: TxCtx,
  args: { event: PublicKey; seat: string },
): Promise<BuiltTx> {
  const { program, user, payer } = ctx;
  const cfg = await getConfig(program);
  const ev = await program.account.event.fetch(args.event);
  const ticketMint = pdas(program.programId).ticketMint(args.event, ev.sold);
  const ix = await program.methods
    .buyPrimary(args.seat)
    .accountsPartial({
      payer,
      buyer: user,
      event: args.event,
      organizer: ev.organizer,
      treasury: cfg.treasury,
      usdcMint: cfg.usdc.mint,
      buyerUsdc: usdcAta(cfg.usdc, user),
      ticketMint,
      buyerTicketAccount: ticketAta(ticketMint, user),
      tokenProgram: cfg.usdc.tokenProgram,
      ticketTokenProgram: TOKEN_2022_PROGRAM_ID,
    })
    .instruction();
  return toTx(ctx, [ix], { computeUnits: HEAVY_CU, address: ticketMint });
}

export async function listResale(
  ctx: TxCtx,
  args: { ticketMint: PublicKey; priceUsd: number },
): Promise<BuiltTx> {
  const { program, user, payer } = ctx;
  const p = pdas(program.programId);
  const record = await program.account.ticketRecord.fetch(p.ticketRecord(args.ticketMint));
  const listing = p.listing(args.ticketMint);
  const ix = await program.methods
    .listResale(toBaseUnits(args.priceUsd))
    .accountsPartial({
      payer,
      seller: user,
      ticketMint: args.ticketMint,
      event: record.event,
      sellerTicketAccount: ticketAta(args.ticketMint, user),
      listing,
      listingVault: ticketAta(args.ticketMint, listing),
      ticketTokenProgram: TOKEN_2022_PROGRAM_ID,
    })
    .instruction();
  return toTx(ctx, [ix], { computeUnits: HEAVY_CU, address: listing });
}

export async function cancelListing(
  ctx: TxCtx,
  args: { ticketMint: PublicKey },
): Promise<BuiltTx> {
  const { program, user, payer } = ctx;
  const listing = pdas(program.programId).listing(args.ticketMint);
  const ix = await program.methods
    .cancelListing()
    .accountsPartial({
      payer,
      seller: user,
      ticketMint: args.ticketMint,
      listing,
      listingVault: ticketAta(args.ticketMint, listing),
      sellerTicketAccount: ticketAta(args.ticketMint, user),
      ticketTokenProgram: TOKEN_2022_PROGRAM_ID,
    })
    .instruction();
  return toTx(ctx, [ix], { computeUnits: HEAVY_CU, address: listing });
}

export async function swapResale(
  ctx: TxCtx,
  args: { ticketMint: PublicKey },
): Promise<BuiltTx> {
  const { program, user, payer } = ctx;
  const cfg = await getConfig(program);
  const listing = pdas(program.programId).listing(args.ticketMint);
  const l = await program.account.listing.fetch(listing);
  const ev = await program.account.event.fetch(l.event);
  const ix = await program.methods
    .swapResale()
    .accountsPartial({
      payer,
      buyer: user,
      ticketMint: args.ticketMint,
      listing,
      event: l.event,
      seller: l.seller,
      organizer: ev.organizer,
      treasury: cfg.treasury,
      usdcMint: cfg.usdc.mint,
      buyerUsdc: usdcAta(cfg.usdc, user),
      listingVault: ticketAta(args.ticketMint, listing),
      buyerTicketAccount: ticketAta(args.ticketMint, user),
      tokenProgram: cfg.usdc.tokenProgram,
      ticketTokenProgram: TOKEN_2022_PROGRAM_ID,
    })
    .instruction();
  return toTx(ctx, [ix], { computeUnits: HEAVY_CU, address: args.ticketMint });
}

// ---------------------------------------------------------------------------
// Builders: Tier 2 escrow
// ---------------------------------------------------------------------------

export async function createEscrowListing(
  ctx: TxCtx,
  args: {
    /** Client-chosen, unique per seller. Default: current time in ms. */
    orderId?: number;
    priceUsd: number;
    bondUsd: number;
    shipWindowSecs: number;
    confirmWindowSecs: number;
  },
): Promise<BuiltTx> {
  const { program, user, payer } = ctx;
  const cfg = await getConfig(program);
  const orderId = args.orderId ?? Date.now();
  const escrow = pdas(program.programId).escrow(user, orderId);
  const ix = await program.methods
    .createEscrowListing(
      new BN(orderId),
      toBaseUnits(args.priceUsd),
      toBaseUnits(args.bondUsd),
      new BN(args.shipWindowSecs),
      new BN(args.confirmWindowSecs),
    )
    .accountsPartial({
      payer,
      seller: user,
      escrow,
      usdcMint: cfg.usdc.mint,
      sellerUsdc: usdcAta(cfg.usdc, user),
      escrowVault: vaults.escrow(cfg.usdc, escrow),
      tokenProgram: cfg.usdc.tokenProgram,
    })
    .instruction();
  return toTx(ctx, [ix], { address: escrow });
}

/** fund_escrow has no `payer` account: the buyer only signs; the fee payer is still ctx.payer. */
export async function fundEscrow(ctx: TxCtx, args: { escrow: PublicKey }): Promise<BuiltTx> {
  const { program, user } = ctx;
  const cfg = await getConfig(program);
  const ix = await program.methods
    .fundEscrow()
    .accountsPartial({
      buyer: user,
      escrow: args.escrow,
      usdcMint: cfg.usdc.mint,
      buyerUsdc: usdcAta(cfg.usdc, user),
      escrowVault: vaults.escrow(cfg.usdc, args.escrow),
      tokenProgram: cfg.usdc.tokenProgram,
    })
    .instruction();
  return toTx(ctx, [ix], { address: args.escrow });
}

export async function markSent(ctx: TxCtx, args: { escrow: PublicKey }): Promise<BuiltTx> {
  const ix = await ctx.program.methods
    .markSent()
    .accountsPartial({ seller: ctx.user, escrow: args.escrow })
    .instruction();
  return toTx(ctx, [ix], { address: args.escrow });
}

export async function openDispute(ctx: TxCtx, args: { escrow: PublicKey }): Promise<BuiltTx> {
  const ix = await ctx.program.methods
    .openDispute()
    .accountsPartial({ caller: ctx.user, escrow: args.escrow })
    .instruction();
  return toTx(ctx, [ix], { address: args.escrow });
}

/** Accounts shared by the five payout instructions (SettleEscrow in the program). */
async function settleAccounts(ctx: TxCtx, escrowPda: PublicKey) {
  const { program, user, payer } = ctx;
  const cfg = await getConfig(program);
  const e = await program.account.escrowOrder.fetch(escrowPda);
  if (!e.buyer) throw new Error("This escrow has no buyer yet");
  return {
    payer,
    caller: user,
    escrow: escrowPda,
    seller: e.seller,
    buyer: e.buyer,
    treasury: cfg.treasury,
    usdcMint: cfg.usdc.mint,
    escrowVault: vaults.escrow(cfg.usdc, escrowPda),
    tokenProgram: cfg.usdc.tokenProgram,
  };
}

export async function confirmReceipt(ctx: TxCtx, args: { escrow: PublicKey }): Promise<BuiltTx> {
  const ix = await ctx.program.methods
    .confirmReceipt()
    .accountsPartial(await settleAccounts(ctx, args.escrow))
    .instruction();
  return toTx(ctx, [ix], { address: args.escrow });
}

/** Anyone can call once the ship deadline has passed: price + bond back to the buyer. */
export async function refundExpired(ctx: TxCtx, args: { escrow: PublicKey }): Promise<BuiltTx> {
  const ix = await ctx.program.methods
    .refundExpired()
    .accountsPartial(await settleAccounts(ctx, args.escrow))
    .instruction();
  return toTx(ctx, [ix], { address: args.escrow });
}

/** Anyone can call once the confirm deadline has passed: payment released to the seller. */
export async function releaseExpired(ctx: TxCtx, args: { escrow: PublicKey }): Promise<BuiltTx> {
  const ix = await ctx.program.methods
    .releaseExpired()
    .accountsPartial(await settleAccounts(ctx, args.escrow))
    .instruction();
  return toTx(ctx, [ix], { address: args.escrow });
}

// ---------------------------------------------------------------------------
// Builders: standing orders
// ---------------------------------------------------------------------------

export async function openStandingOrder(
  ctx: TxCtx,
  args: {
    event: PublicKey;
    orderId?: number;
    maxPriceUsd: number;
    quantity: number;
    deadlineSecs: number;
  },
): Promise<BuiltTx> {
  const { program, user, payer } = ctx;
  const cfg = await getConfig(program);
  const orderId = args.orderId ?? Date.now();
  const standingOrder = pdas(program.programId).standingOrder(user, orderId);
  const ix = await program.methods
    .openStandingOrder(
      new BN(orderId),
      toBaseUnits(args.maxPriceUsd),
      args.quantity,
      new BN(args.deadlineSecs),
    )
    .accountsPartial({
      payer,
      owner: user,
      event: args.event,
      standingOrder,
      usdcMint: cfg.usdc.mint,
      ownerUsdc: usdcAta(cfg.usdc, user),
      budgetVault: vaults.budget(cfg.usdc, standingOrder),
      tokenProgram: cfg.usdc.tokenProgram,
    })
    .instruction();
  return toTx(ctx, [ix], { address: standingOrder });
}

/**
 * Crank path for standing orders. `ctx.user` is the crank (the relayer in production);
 * `ctx.payer` pays fees and rent. The program checks event, max price, deadline and
 * seller ≠ owner. Seller rating is not onchain — the matcher checks it before calling this.
 */
export async function fillStandingOrder(
  ctx: TxCtx,
  args: { standingOrder: PublicKey; ticketMint: PublicKey },
): Promise<BuiltTx> {
  const { program, user, payer } = ctx;
  const cfg = await getConfig(program);
  const so = await program.account.standingOrder.fetch(args.standingOrder);
  const listing = pdas(program.programId).listing(args.ticketMint);
  const listed = await program.account.listing.fetch(listing);
  const ev = await program.account.event.fetch(listed.event);
  const ix = await program.methods
    .fillStandingOrder()
    .accountsPartial({
      payer,
      crank: user,
      standingOrder: args.standingOrder,
      owner: so.owner,
      ticketMint: args.ticketMint,
      listing,
      event: listed.event,
      seller: listed.seller,
      organizer: ev.organizer,
      treasury: cfg.treasury,
      usdcMint: cfg.usdc.mint,
      budgetVault: vaults.budget(cfg.usdc, args.standingOrder),
      sellerUsdc: usdcAta(cfg.usdc, listed.seller),
      organizerUsdc: usdcAta(cfg.usdc, ev.organizer),
      treasuryUsdc: usdcAta(cfg.usdc, cfg.treasury),
      listingVault: ticketAta(args.ticketMint, listing),
      ownerTicketAccount: ticketAta(args.ticketMint, so.owner),
      ticketAuthority: pdas(program.programId).ticketAuthority(),
      tokenProgram: cfg.usdc.tokenProgram,
      ticketTokenProgram: TOKEN_2022_PROGRAM_ID,
    })
    .instruction();
  return toTx(ctx, [ix], { computeUnits: HEAVY_CU, address: args.standingOrder });
}

export async function closeStandingOrder(
  ctx: TxCtx,
  args: { standingOrder: PublicKey },
): Promise<BuiltTx> {
  const { program, user, payer } = ctx;
  const cfg = await getConfig(program);
  const so = await program.account.standingOrder.fetch(args.standingOrder);
  const ix = await program.methods
    .closeStandingOrder()
    .accountsPartial({
      payer,
      caller: user,
      standingOrder: args.standingOrder,
      owner: so.owner,
      usdcMint: cfg.usdc.mint,
      budgetVault: vaults.budget(cfg.usdc, args.standingOrder),
      tokenProgram: cfg.usdc.tokenProgram,
    })
    .instruction();
  return toTx(ctx, [ix], { address: args.standingOrder });
}

/**
 * Drafted by D for the in-browser agent crank; A to review. Mirrors swapResale, but pays from the
 * standing order's budget vault and sends the ticket to the order's owner. `user` signs as the
 * crank (any signer may; the program checks every rule). Seller/organizer/treasury USDC ATAs
 * resolve from the IDL like in swapResale.
 */
export async function fillStandingOrder(
  ctx: TxCtx,
  args: { standingOrder: PublicKey; ticketMint: PublicKey },
): Promise<BuiltTx> {
  const { program, user, payer } = ctx;
  const cfg = await getConfig(program);
  const so = await program.account.standingOrder.fetch(args.standingOrder);
  const listing = pdas(program.programId).listing(args.ticketMint);
  const l = await program.account.listing.fetch(listing);
  const ev = await program.account.event.fetch(l.event);
  const ix = await program.methods
    .fillStandingOrder()
    .accountsPartial({
      payer,
      crank: user,
      standingOrder: args.standingOrder,
      owner: so.owner,
      ticketMint: args.ticketMint,
      listing,
      event: l.event,
      seller: l.seller,
      organizer: ev.organizer,
      treasury: cfg.treasury,
      usdcMint: cfg.usdc.mint,
      budgetVault: vaults.budget(cfg.usdc, args.standingOrder),
      listingVault: ticketAta(args.ticketMint, listing),
      ownerTicketAccount: ticketAta(args.ticketMint, so.owner),
      tokenProgram: cfg.usdc.tokenProgram,
      ticketTokenProgram: TOKEN_2022_PROGRAM_ID,
    })
    .instruction();
  return toTx(ctx, [ix], { computeUnits: HEAVY_CU, address: args.ticketMint });
}

export { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID };
