// SeatSafe shared types: the contract the whole team codes against.
// Change these only with A's sign-off; mocks, hooks, API routes and the DB all follow them.

export type OrderState =
  | "HELD" | "IN_TRANSIT" | "CONFIRMED" | "RELEASED"
  | "REFUNDED" | "DISPUTED" | "SWAPPED";

export type Tier = 1 | 2; // 1 = SeatSafe onchain ticket (atomic swap), 2 = outside ticket (escrow)

export interface Event {
  id: string;
  title: string;
  category: "concert" | "sports" | "campus";
  venue: string;
  city: string;
  startsAt: string;          // ISO
  imageGradient: string;     // Tailwind gradient classes (legacy; art now comes from imageUrl)
  imageUrl?: string;         // original art in public/events/ (lib/event-image.ts picks a default)
  priceFromUsd: number;
  resaleCapUsd: number | null;
  royaltyBps: number;        // 500 = 5%
  organizerName: string;
}

export interface Ticket {
  id: string;
  eventId: string;
  section: string;
  row: string;
  seat: string;
  tier: Tier;
  ownerId: string;
  mintAddress?: string;      // Tier 1 only
}

export interface Listing {
  id: string;
  ticketId: string;
  eventId: string;
  sellerId: string;
  sellerName: string;
  sellerRating: number;      // 0-5
  priceUsd: number;
  tier: Tier;
  bondUsd: number;           // Tier 2 seller bond; 0 for Tier 1
  createdAt: string;
}

export interface OrderEvent {
  id: string;
  orderId: string;
  type: "FUNDED" | "TICKET_SENT" | "CONFIRMED" | "RELEASED" | "REFUNDED" | "DISPUTE_OPENED" | "DISPUTE_RESOLVED" | "SWAPPED";
  message: string;           // human-readable, e.g. "Seller sent the ticket"
  txSignature?: string;
  at: string;                // ISO
}

export interface Order {
  id: string;
  listingId: string;
  eventId: string;
  buyerId: string;
  sellerId: string;
  amountUsd: number;
  tier: Tier;
  state: OrderState;
  shipDeadline: string;      // ISO
  confirmDeadline: string;   // ISO
  vaultAddress?: string;
  events: OrderEvent[];
}

export interface StandingOrder {
  id: string;
  userId: string;
  eventId: string;
  quantity: number;
  maxPriceUsd: number;
  minSellerRating: number;
  deadline: string;
  budgetUsd: number;
  status: "OPEN" | "FILLED" | "EXPIRED" | "CANCELLED";
}

export interface ChatMessage {
  id: string;
  orderId: string;
  senderId: string;
  body: string;
  risk: "low" | "high";
  riskReason?: string;
  at: string;
}
