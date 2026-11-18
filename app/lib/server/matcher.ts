// Standing-order matcher. Called when a Tier 1 listing is created (stream) and again by the
// 5-minute reconciler, in case a webhook was missed. Rating is off-chain. Price at or above
// STANDING_ORDER_APPROVAL_USD (default $75) becomes an approval request instead of a fill.

import { PublicKey } from "@solana/web3.js";
import { chainProgram } from "@/lib/chain";
import { fillStandingOrder } from "@/lib/program";
import { supabaseAdmin } from "@/lib/server/supabase-admin";
import { loadRelayer } from "@/lib/server/relayer";
import { sendAsRelayer } from "@/lib/server/send";

export interface MatchListing {
  id: string;
  eventId: string;
  sellerId: string;
  priceUsd: number;
  sellerRating: number | null;
  ticketMint?: string | null;
  seat?: string | null;
}

export function approvalThresholdUsd(): number {
  const raw = process.env.STANDING_ORDER_APPROVAL_USD;
  const n = raw === undefined || raw === "" ? 75 : Number(raw);
  return Number.isFinite(n) ? n : 75;
}

function assumedRating(): { rating: number; assumed: boolean } | null {
  const raw = process.env.DEFAULT_SELLER_RATING;
  if (raw === "none") return null;
  const n = raw === undefined || raw === "" ? 4.8 : Number(raw);
  if (!Number.isFinite(n)) return { rating: 4.8, assumed: true };
  return { rating: n, assumed: true };
}

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

function short(id: string): string {
  return id.length <= 10 ? id : `${id.slice(0, 4)}…${id.slice(-4)}`;
}

function isPubkey(value: string | null | undefined): value is string {
  if (!value) return false;
  try {
    new PublicKey(value);
    return true;
  } catch {
    return false;
  }
}

type Db = NonNullable<ReturnType<typeof supabaseAdmin>>;

async function log(db: Db, standingOrderId: string, kind: string, message: string) {
  const id = `log_${standingOrderId.slice(0, 8)}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  await db.from("agent_log").insert({
    id,
    standing_order_id: standingOrderId,
    kind,
    message,
    at: new Date().toISOString(),
  });
}

/**
 * Compare one listing with every open standing order for that event.
 * Decisions are stored so a replayed webhook does not fill twice or repeat a skip.
 */
export async function considerListing(listing: MatchListing): Promise<{ considered: number }> {
  const db = supabaseAdmin();
  if (!db) return { considered: 0 };
  if (!listing.eventId) return { considered: 0 };

  const now = new Date().toISOString();
  const { data: orders, error } = await db
    .from("standing_orders")
    .select("id, user_id, quantity, filled, max_price_usd, min_seller_rating, budget_usd, spent_usd, deadline, status")
    .eq("status", "OPEN")
    .eq("event_id", listing.eventId)
    .gt("deadline", now);
  if (error || !orders) return { considered: 0 };

  let considered = 0;
  for (const order of orders) {
    const decided = await claimDecision(db, order.id, listing.id);
    if (decided === "skip") continue;
    considered += 1;
    const outcome = await decideOne(db, order, listing);
    await db.from("standing_order_decisions").upsert({
      standing_order_id: order.id,
      listing_id: listing.id,
      decision: outcome,
    });
  }
  return { considered };
}

/** "go" if this pair has not been decided, or the last try errored. "skip" otherwise. */
async function claimDecision(db: Db, standingOrderId: string, listingId: string): Promise<"go" | "skip"> {
  const { data } = await db
    .from("standing_order_decisions")
    .select("decision")
    .eq("standing_order_id", standingOrderId)
    .eq("listing_id", listingId)
    .maybeSingle();
  if (data && data.decision !== "error" && data.decision !== "pending") return "skip";
  if (!data) {
    const { error } = await db.from("standing_order_decisions").insert({
      standing_order_id: standingOrderId,
      listing_id: listingId,
      decision: "pending",
    });
    if (error) return "skip";
  }
  return "go";
}

interface OrderShape {
  id: string;
  user_id: string;
  quantity: number;
  filled: number | null;
  max_price_usd: number | string;
  min_seller_rating: number | string;
  budget_usd: number | string;
  spent_usd: number | string | null;
}

async function decideOne(db: Db, order: OrderShape, listing: MatchListing): Promise<string> {
  const maxPrice = Number(order.max_price_usd);
  const minRating = Number(order.min_seller_rating ?? 0);
  const filled = Number(order.filled ?? 0);
  const remaining = Number(order.quantity) - filled;
  const spent = Number(order.spent_usd ?? 0);
  const budgetLeft = Number(order.budget_usd) - spent;
  const label = short(listing.id);

  await log(db, order.id, "seen", `Seen listing ${label} at ${money(listing.priceUsd)}.`);

  if (remaining <= 0) {
    await log(db, order.id, "skip", `Skipped listing ${label}: this order is already filled.`);
    return "skip_filled";
  }
  if (listing.sellerId === order.user_id) {
    await log(db, order.id, "skip", `Skipped listing ${label}: that is your own listing.`);
    return "skip_self";
  }
  if (listing.priceUsd > maxPrice) {
    await log(db, order.id, "skip", `Skipped listing ${label}: ${money(listing.priceUsd)} is above your max of ${money(maxPrice)}.`);
    return "skip_price";
  }
  if (listing.priceUsd > budgetLeft) {
    await log(db, order.id, "skip", `Skipped listing ${label}: ${money(listing.priceUsd)} is above the ${money(budgetLeft)} left in the vault.`);
    return "skip_budget";
  }

  const known = listing.sellerRating;
  const assumed = known === null ? assumedRating() : null;
  const rating = known ?? assumed?.rating ?? null;
  if (rating === null || rating + 1e-9 < minRating) {
    const shown = rating === null ? "no" : rating.toFixed(1);
    await log(db, order.id, "skip", `Skipped listing ${label}: seller ${shown} stars (need ${minRating}+).`);
    return "skip_rating";
  }
  const ratingNote = assumed ? ` (no profile, using default ${assumed.rating.toFixed(1)})` : "";

  const needsVoice = listing.priceUsd >= approvalThresholdUsd();
  if (needsVoice || !isPubkey(order.id) || !isPubkey(listing.ticketMint)) {
    const prompt = `Found a ticket at ${money(listing.priceUsd)} from a ${rating.toFixed(1)}-star seller. Say yes to buy.`;
    const detail = `${listing.seat ? `${listing.seat} · ` : ""}${rating.toFixed(1)} stars${ratingNote}`;
    await db.from("approval_requests").insert({
      id: `apr_${order.id.slice(0, 6)}_${listing.id.slice(0, 6)}_${Date.now()}`,
      standing_order_id: order.id,
      listing_id: listing.id,
      price_usd: listing.priceUsd,
      quantity: 1,
      seller_rating: rating,
      prompt,
      detail,
      total_usd: listing.priceUsd,
      status: "pending",
    });
    await log(db, order.id, "found", `Asking you to approve listing ${label} at ${money(listing.priceUsd)} from a ${rating.toFixed(1)}-star seller.`);
    return "approval";
  }

  const relayer = loadRelayer();
  if (!relayer) {
    await log(db, order.id, "waiting", `Listing ${label} matches, but the relayer key is not configured so it was not filled.`);
    return "error";
  }
  try {
    const program = chainProgram();
    const built = await fillStandingOrder(
      { program, user: relayer.publicKey, payer: relayer.publicKey },
      { standingOrder: new PublicKey(order.id), ticketMint: new PublicKey(listing.ticketMint) },
    );
    const signature = await sendAsRelayer(built, relayer);
    await log(db, order.id, "filled", `Filled listing ${label} at ${money(listing.priceUsd)}. Tx ${signature.slice(0, 8)}….`);
    return "filled";
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await log(db, order.id, "waiting", `Could not fill listing ${label}: ${message}`);
    return "error";
  }
}

/** Re-run the matcher for every active Tier 1 listing. Safe to call from cron. */
export async function matchOpenListings(): Promise<{ considered: number }> {
  const db = supabaseAdmin();
  if (!db) return { considered: 0 };
  const { data } = await db
    .from("listings")
    .select("id, event_id, seller_id, price_usd, seller_rating, ticket_mint, status, tier")
    .eq("status", "active")
    .eq("tier", 1);
  let considered = 0;
  for (const row of data ?? []) {
    const result = await considerListing({
      id: row.id,
      eventId: row.event_id,
      sellerId: row.seller_id,
      priceUsd: Number(row.price_usd),
      sellerRating: row.seller_rating === null ? null : Number(row.seller_rating),
      ticketMint: row.ticket_mint,
    });
    considered += result.considered;
  }
  return { considered };
}
