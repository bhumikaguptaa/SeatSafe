// Row <-> lib/types.ts mappers. Safe to import from client hooks: no secrets, no server-only modules.

import type { ChatMessage, Event, Order, OrderEvent, OrderState, StandingOrder } from "./types";

export interface EventRow {
  id: string;
  title: string;
  category: Event["category"];
  venue: string;
  city: string;
  starts_at: string;
  image_gradient: string;
  price_from_usd: number | string;
  resale_cap_usd: number | string | null;
  royalty_bps: number;
  organizer_name: string;
}

export interface OrderEventRow {
  id: string;
  order_id: string;
  type: OrderEvent["type"];
  message: string;
  tx_signature?: string | null;
  at: string;
}

export interface OrderRow {
  id: string;
  listing_id: string;
  event_id: string;
  buyer_id: string;
  seller_id: string;
  amount_usd: number | string;
  tier: number;
  state: OrderState;
  ship_deadline: string;
  confirm_deadline: string;
  vault_address?: string | null;
  order_events?: OrderEventRow[] | null;
}

export interface ChatRow {
  id: string;
  order_id: string;
  sender_id: string;
  body: string;
  risk: "low" | "high";
  risk_reason?: string | null;
  at: string;
}

export interface StandingOrderRow {
  id: string;
  user_id: string;
  event_id: string;
  quantity: number;
  max_price_usd: number | string;
  min_seller_rating: number | string;
  deadline: string;
  budget_usd: number | string;
  status: string;
  filled?: number | null;
}

export interface AgentLogRow {
  id: string;
  standing_order_id: string;
  kind: string;
  message: string;
  at: string;
}

export interface ApprovalRow {
  id: string;
  standing_order_id: string;
  listing_id: string;
  price_usd: number | string;
  quantity: number;
  seller_rating: number | string;
  prompt: string;
  detail: string;
  total_usd: number | string;
  status: string;
  created_at: string;
}

const num = (v: number | string | null | undefined) => Number(v ?? 0);

export function eventFromRow(row: EventRow): Event {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    venue: row.venue,
    city: row.city,
    startsAt: row.starts_at,
    imageGradient: row.image_gradient,
    priceFromUsd: num(row.price_from_usd),
    resaleCapUsd: row.resale_cap_usd === null || row.resale_cap_usd === undefined ? null : num(row.resale_cap_usd),
    royaltyBps: row.royalty_bps,
    organizerName: row.organizer_name,
  };
}

export function orderEventFromRow(row: OrderEventRow): OrderEvent {
  return {
    id: row.id,
    orderId: row.order_id,
    type: row.type,
    message: row.message,
    txSignature: row.tx_signature ?? undefined,
    at: row.at,
  };
}

export function orderFromRow(row: OrderRow): Order {
  const events = (row.order_events ?? []).map(orderEventFromRow).sort((a, b) => a.at.localeCompare(b.at));
  return {
    id: row.id,
    listingId: row.listing_id,
    eventId: row.event_id,
    buyerId: row.buyer_id,
    sellerId: row.seller_id,
    amountUsd: num(row.amount_usd),
    tier: row.tier === 1 ? 1 : 2,
    state: row.state,
    shipDeadline: row.ship_deadline,
    confirmDeadline: row.confirm_deadline,
    vaultAddress: row.vault_address ?? undefined,
    events,
  };
}

export function chatFromRow(row: ChatRow): ChatMessage {
  return {
    id: row.id,
    orderId: row.order_id,
    senderId: row.sender_id,
    body: row.body,
    risk: row.risk,
    riskReason: row.risk_reason ?? undefined,
    at: row.at,
  };
}

const STANDING_STATUS = new Set(["OPEN", "FILLED", "EXPIRED", "CANCELLED"]);

export function standingOrderFromRow(row: StandingOrderRow): StandingOrder | null {
  if (!STANDING_STATUS.has(row.status)) return null;
  return {
    id: row.id,
    userId: row.user_id,
    eventId: row.event_id,
    quantity: row.quantity,
    maxPriceUsd: num(row.max_price_usd),
    minSellerRating: num(row.min_seller_rating),
    deadline: row.deadline,
    budgetUsd: num(row.budget_usd),
    status: row.status as StandingOrder["status"],
  };
}
