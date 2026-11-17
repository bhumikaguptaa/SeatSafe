// Owner: A. Reads SeatSafe state straight from devnet and maps it to the shared types in
// lib/types.ts. B can call these from hooks (no React here). Display data (titles, venues) comes
// from lib/event-meta.ts.
//
// ---------------------------------------------------------------------------------------------
// EscrowState (onchain) -> OrderState (lib/types.ts)
//   Listed     -> not an Order yet (no buyer). Shown to the seller as a ChainEscrow with state "LISTED".
//   Funded     -> "HELD"         buyer's payment + seller's bond locked in the vault
//   Sent       -> "IN_TRANSIT"   seller marked the ticket sent; buyer's confirm window running
//   Completed  -> "RELEASED"     paid out to the seller. The chain can't tell a buyer confirmation
//                                from an auto-release (both end in Completed); the OrderCompleted
//                                event's `auto` flag can (B's stream may set "CONFIRMED" from it).
//   Refunded   -> "REFUNDED"     ship deadline missed; price + bond back to the buyer
//   Cancelled  -> not an Order (seller withdrew before anyone bought). ChainEscrow state "CANCELLED".
//   Disputed   -> "DISPUTED"
//   Resolved   -> "RELEASED"     dispute settled and the vault paid out (split per arbiter / timeout)
// Tier 1 resales are atomic, so they never become escrow orders: a swap is a "SWAPPED" OrderEvent.
// ---------------------------------------------------------------------------------------------

import type { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { connection, PROGRAM_ID } from "./solana";
import { fromBaseUnits, getConfig, getProgram, pdas, vaults, type SeatsafeProgram } from "./program";
import { DEFAULT_EVENT_META, getMetaMap, type MetaMap } from "./event-meta";
import type { Event, Listing, Order, OrderEvent, OrderState, StandingOrder, Ticket } from "./types";

/** Same switch as lib/hooks.ts: mock data unless NEXT_PUBLIC_USE_MOCK is exactly "false". */
export const USE_MOCK = process.env.NEXT_PUBLIC_USE_MOCK !== "false";

export function chainProgram(): SeatsafeProgram {
  return getProgram(connection, PROGRAM_ID ?? undefined);
}

// Byte offsets for memcmp filters: 8-byte discriminator, then fields in IDL order.
const OFFSET = {
  listingSeller: 8, // Listing { seller, ticket_mint, event, ... }
  listingEvent: 8 + 32 + 32,
  escrowSeller: 8, // EscrowOrder { seller, ... }
  standingOwner: 8, // StandingOrder { owner, ... }
  eventOrganizer: 8, // Event { organizer, ... }
};
const memcmp = (offset: number, key: PublicKey) => ({ memcmp: { offset, bytes: key.toBase58() } });

const iso = (unixSecs: BN | number) => new Date(Number(unixSecs.toString()) * 1000).toISOString();
const usd = fromBaseUnits;

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/** Event (lib/types.ts) plus the onchain numbers my pages need. id = event PDA. */
export interface ChainEvent extends Event {
  organizer: string;
  priceUsd: number;
  supply: number;
  sold: number;
}

type RawEvent = Awaited<ReturnType<SeatsafeProgram["account"]["event"]["fetch"]>>;

function toEvent(address: PublicKey, e: RawEvent, meta: MetaMap): ChainEvent {
  const m = meta.events[address.toBase58()] ?? DEFAULT_EVENT_META;
  const price = usd(e.price);
  return {
    id: address.toBase58(),
    title: m.title,
    category: m.category,
    venue: m.venue,
    city: m.city,
    startsAt: iso(e.startsAt),
    imageGradient: m.imageGradient,
    priceFromUsd: price,
    resaleCapUsd: usd(e.resaleCap),
    royaltyBps: e.royaltyBps,
    organizerName: m.organizerName,
    organizer: e.organizer.toBase58(),
    priceUsd: price,
    supply: e.supply,
    sold: e.sold,
  };
}

/** All events onchain, soonest first. */
export async function getEvents(): Promise<ChainEvent[]> {
  const program = chainProgram();
  const [rows, meta] = await Promise.all([program.account.event.all(), getMetaMap()]);
  return rows
    .map((r) => toEvent(r.publicKey, r.account, meta))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

export async function getEvent(eventPda: string): Promise<ChainEvent | null> {
  const program = chainProgram();
  let key: PublicKey;
  try {
    key = new PublicKey(eventPda);
  } catch {
    return null;
  }
  const [e, meta] = await Promise.all([program.account.event.fetchNullable(key), getMetaMap()]);
  return e ? toEvent(key, e, meta) : null;
}

// ---------------------------------------------------------------------------
// Listings (Tier 1 resale listings + open Tier 2 escrow listings)
// ---------------------------------------------------------------------------

/** Listing (lib/types.ts) plus what the buy buttons need. */
export interface ChainListing extends Listing {
  /** Tier 1: the ticket mint (pass to swapResale). */
  ticketMint?: string;
  /** Tier 2: the escrow PDA (pass to fundEscrow; also the order id after funding). */
  escrow?: string;
  /** Tier 1: seat from the TicketRecord. Tier 2: seat text from event-meta. */
  seat: string;
}

const shortKey = (k: string) => `${k.slice(0, 4)}…${k.slice(-4)}`;

export async function getListingsForEvent(eventPda: string): Promise<ChainListing[]> {
  const program = chainProgram();
  const event = new PublicKey(eventPda);
  const [tier1, escrows, meta] = await Promise.all([
    program.account.listing.all([memcmp(OFFSET.listingEvent, event)]),
    program.account.escrowOrder.all(),
    getMetaMap(),
  ]);

  const p = pdas(program.programId);
  const records = await program.account.ticketRecord.fetchMultiple(
    tier1.map((l) => p.ticketRecord(l.account.ticketMint)),
  );

  const t1: ChainListing[] = tier1.map((l, i) => ({
    id: l.publicKey.toBase58(),
    ticketId: l.account.ticketMint.toBase58(),
    eventId: eventPda,
    sellerId: l.account.seller.toBase58(),
    sellerName: shortKey(l.account.seller.toBase58()),
    sellerRating: 0, // ratings are off-chain (B)
    priceUsd: usd(l.account.price),
    tier: 1,
    bondUsd: 0,
    createdAt: iso(l.account.createdAt),
    ticketMint: l.account.ticketMint.toBase58(),
    seat: records[i]?.seat ?? "",
  }));

  const t2: ChainListing[] = escrows
    .filter((e) => "listed" in e.account.state && meta.escrows[e.publicKey.toBase58()]?.eventId === eventPda)
    .map((e) => {
      const m = meta.escrows[e.publicKey.toBase58()];
      return {
        id: e.publicKey.toBase58(),
        ticketId: e.publicKey.toBase58(),
        eventId: eventPda,
        sellerId: e.account.seller.toBase58(),
        sellerName: m.sellerName ?? shortKey(e.account.seller.toBase58()),
        sellerRating: 0,
        priceUsd: usd(e.account.price),
        tier: 2,
        bondUsd: usd(e.account.bond),
        createdAt: new Date(Number(e.account.orderId.toString())).toISOString(), // orderId = ms timestamp from our builders
        escrow: e.publicKey.toBase58(),
        seat: m.seat,
      };
    });

  return [...t1, ...t2].sort((a, b) => a.priceUsd - b.priceUsd);
}

// ---------------------------------------------------------------------------
// My tickets
// ---------------------------------------------------------------------------

/** Ticket (lib/types.ts) plus status. id = mintAddress = ticket mint. */
export interface ChainTicket extends Ticket {
  /** Full seat label as stored onchain (≤ 32 bytes). */
  seatLabel: string;
  /** Listed for resale: the ticket sits in the listing vault until sold or cancelled. */
  listed: boolean;
  listingPriceUsd?: number;
}

/** "Sec 101 Row C Seat 12" -> { section: "101", row: "C", seat: "12" }; anything else -> section = label. */
export function parseSeat(label: string): Pick<Ticket, "section" | "row" | "seat"> {
  const m = /Sec(?:tion)?\s+(\S+)\s+Row\s+(\S+)\s+Seat\s+(\S+)/i.exec(label);
  return m ? { section: m[1], row: m[2], seat: m[3] } : { section: label || "GA", row: "-", seat: "-" };
}

/**
 * Tier 1 tickets the wallet holds (Token-2022 accounts with amount 1 whose mint has a
 * TicketRecord) plus tickets it has listed for resale (held by the listing vault).
 */
export async function getMyTickets(owner: string): Promise<ChainTicket[]> {
  const program = chainProgram();
  const ownerKey = new PublicKey(owner);
  const p = pdas(program.programId);

  const [accounts, myListings] = await Promise.all([
    connection.getParsedTokenAccountsByOwner(ownerKey, { programId: TOKEN_2022_PROGRAM_ID }, "confirmed"),
    program.account.listing.all([memcmp(OFFSET.listingSeller, ownerKey)]),
  ]);

  const held = accounts.value
    .map((a) => a.account.data.parsed?.info as { mint: string; tokenAmount: { amount: string } } | undefined)
    .filter((i): i is { mint: string; tokenAmount: { amount: string } } => i?.tokenAmount.amount === "1")
    .map((i) => ({ mint: new PublicKey(i.mint), listed: false, price: undefined as number | undefined }));
  const listed = myListings.map((l) => ({
    mint: l.account.ticketMint,
    listed: true,
    price: usd(l.account.price) as number | undefined,
  }));
  const all = [...held, ...listed];
  if (all.length === 0) return [];

  const records = await program.account.ticketRecord.fetchMultiple(all.map((t) => p.ticketRecord(t.mint)));
  return all.flatMap((t, i) => {
    const r = records[i];
    if (!r) return []; // not a SeatSafe ticket
    const label = r.seat;
    return [{
      id: t.mint.toBase58(),
      eventId: r.event.toBase58(),
      ...parseSeat(label),
      tier: 1 as const,
      ownerId: owner,
      mintAddress: t.mint.toBase58(),
      seatLabel: label,
      listed: t.listed,
      listingPriceUsd: t.price,
    }];
  });
}

// ---------------------------------------------------------------------------
// Escrow orders
// ---------------------------------------------------------------------------

type RawEscrow = Awaited<ReturnType<SeatsafeProgram["account"]["escrowOrder"]["fetch"]>>;
type EscrowStateName = "listed" | "funded" | "sent" | "completed" | "refunded" | "cancelled" | "disputed" | "resolved";

const stateName = (s: RawEscrow["state"]) => Object.keys(s)[0] as EscrowStateName;

/** EscrowState -> OrderState. null = not an Order (Listed, Cancelled). See the table at the top. */
export function toOrderState(s: EscrowStateName): OrderState | null {
  switch (s) {
    case "funded": return "HELD";
    case "sent": return "IN_TRANSIT";
    case "completed": return "RELEASED";
    case "refunded": return "REFUNDED";
    case "disputed": return "DISPUTED";
    case "resolved": return "RELEASED";
    default: return null;
  }
}

/** Timeline reconstructed from the account's own timestamps (no tx history lookup). */
function synthEvents(id: string, e: RawEscrow, state: EscrowStateName): OrderEvent[] {
  const out: OrderEvent[] = [];
  const ship = Number(e.shipDeadline.toString());
  const confirm = Number(e.confirmDeadline.toString());
  if (ship > 0) {
    out.push({ id: `${id}:funded`, orderId: id, type: "FUNDED", message: "Payment locked in the SeatSafe vault.", at: iso(ship - Number(e.shipWindowSecs.toString())) });
  }
  if (confirm > 0) {
    out.push({ id: `${id}:sent`, orderId: id, type: "TICKET_SENT", message: "Seller sent the ticket.", at: iso(confirm - Number(e.confirmWindowSecs.toString())) });
  }
  if (state === "refunded") out.push({ id: `${id}:refunded`, orderId: id, type: "REFUNDED", message: "Deadline missed. Buyer refunded in full.", at: iso(Math.max(ship, Date.now() / 1000)) });
  if (state === "completed") out.push({ id: `${id}:released`, orderId: id, type: "RELEASED", message: "Payment released to the seller.", at: new Date().toISOString() });
  if (state === "disputed" || state === "resolved") {
    const dl = Number(e.disputeDeadline.toString());
    out.push({ id: `${id}:dispute`, orderId: id, type: "DISPUTE_OPENED", message: "A dispute was opened. Funds stay locked.", at: new Date().toISOString() });
    if (state === "resolved") out.push({ id: `${id}:resolved`, orderId: id, type: "DISPUTE_RESOLVED", message: "Dispute resolved.", at: iso(dl) });
  }
  return out;
}

/** Order (lib/types.ts) for a funded escrow; null if it doesn't exist or isn't an Order (see mapping). */
export async function getEscrowOrder(escrowPda: string): Promise<Order | null> {
  const program = chainProgram();
  let key: PublicKey;
  try {
    key = new PublicKey(escrowPda);
  } catch {
    return null;
  }
  const [e, meta] = await Promise.all([program.account.escrowOrder.fetchNullable(key), getMetaMap()]);
  if (!e || !e.buyer) return null;
  const s = stateName(e.state);
  const state = toOrderState(s);
  if (!state) return null;
  const cfg = await getConfig(program);
  return {
    id: escrowPda,
    listingId: escrowPda,
    eventId: meta.escrows[escrowPda]?.eventId ?? "",
    buyerId: e.buyer.toBase58(),
    sellerId: e.seller.toBase58(),
    amountUsd: usd(e.price),
    tier: 2,
    state,
    shipDeadline: iso(e.shipDeadline),
    confirmDeadline: iso(e.confirmDeadline),
    vaultAddress: vaults.escrow(cfg.usdc, key).toBase58(),
    events: synthEvents(escrowPda, e, s),
  };
}

/** Raw-ish escrow for the seller's "My escrow sales" (includes Listed and Cancelled). */
export interface ChainEscrow {
  id: string;
  state: "LISTED" | "CANCELLED" | OrderState;
  priceUsd: number;
  bondUsd: number;
  seller: string;
  buyer: string | null;
  shipDeadline: string | null;
  confirmDeadline: string | null;
  eventId: string | null;
  seat: string;
}

function toChainEscrow(key: PublicKey, e: RawEscrow, meta: MetaMap): ChainEscrow {
  const s = stateName(e.state);
  const id = key.toBase58();
  const ship = Number(e.shipDeadline.toString());
  const confirm = Number(e.confirmDeadline.toString());
  return {
    id,
    state: s === "listed" ? "LISTED" : s === "cancelled" ? "CANCELLED" : toOrderState(s)!,
    priceUsd: usd(e.price),
    bondUsd: usd(e.bond),
    seller: e.seller.toBase58(),
    buyer: e.buyer?.toBase58() ?? null,
    shipDeadline: ship > 0 ? iso(ship) : null,
    confirmDeadline: confirm > 0 ? iso(confirm) : null,
    eventId: meta.escrows[id]?.eventId ?? null,
    seat: meta.escrows[id]?.seat ?? "",
  };
}

export async function getEscrow(escrowPda: string): Promise<ChainEscrow | null> {
  const program = chainProgram();
  const key = new PublicKey(escrowPda);
  const [e, meta] = await Promise.all([program.account.escrowOrder.fetchNullable(key), getMetaMap()]);
  return e ? toChainEscrow(key, e, meta) : null;
}

export async function getMyEscrowSales(seller: string): Promise<ChainEscrow[]> {
  const program = chainProgram();
  const [rows, meta] = await Promise.all([
    program.account.escrowOrder.all([memcmp(OFFSET.escrowSeller, new PublicKey(seller))]),
    getMetaMap(),
  ]);
  return rows
    .map((r) => toChainEscrow(r.publicKey, r.account, meta))
    .sort((a, b) => b.id.localeCompare(a.id));
}

// ---------------------------------------------------------------------------
// Standing orders
// ---------------------------------------------------------------------------

/**
 * StandingOrderState -> StandingOrder.status:
 *   Open (deadline not passed) -> "OPEN"; Open (deadline passed) -> "EXPIRED";
 *   Filled -> "FILLED"; Closed -> "FILLED" if every ticket was bought, else "CANCELLED".
 * minSellerRating is off-chain (backend matcher), so it's 0 here. budgetUsd = max price × quantity.
 */
export async function getMyStandingOrders(owner: string): Promise<StandingOrder[]> {
  const program = chainProgram();
  const rows = await program.account.standingOrder.all([memcmp(OFFSET.standingOwner, new PublicKey(owner))]);
  const now = Date.now() / 1000;
  return rows.map(({ publicKey, account: s }) => {
    const st = Object.keys(s.state)[0] as "open" | "filled" | "closed";
    const deadline = Number(s.deadline.toString());
    const status: StandingOrder["status"] =
      st === "open" ? (now > deadline ? "EXPIRED" : "OPEN")
      : st === "filled" ? "FILLED"
      : s.filled >= s.quantity ? "FILLED" : "CANCELLED";
    return {
      id: publicKey.toBase58(),
      userId: owner,
      eventId: s.event.toBase58(),
      quantity: s.quantity,
      maxPriceUsd: usd(s.maxPrice),
      minSellerRating: 0,
      deadline: iso(s.deadline),
      budgetUsd: usd(s.maxPrice) * s.quantity,
      status,
    };
  });
}
