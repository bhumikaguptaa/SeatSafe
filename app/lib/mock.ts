// Mock data for building UI without any API keys.
// Everything here follows lib/types.ts exactly. Artists, teams, venues and people are invented.
// Transaction signatures and addresses are fake placeholders: Explorer links built from them will 404.

import type {
  ChatMessage,
  Event,
  Listing,
  Order,
  StandingOrder,
  Ticket,
} from "./types";

/** The "logged-in" user in mock mode. */
export const MOCK_USER_ID = "user_me";

const HOUR = 60 * 60 * 1000;
// Order deadlines are relative to page load so the countdowns always have time left.
const now = Date.now();
const fromNow = (ms: number) => new Date(now + ms).toISOString();

// ---------------------------------------------------------------------------
// Events (6): 2 concerts, 2 sports, 2 campus. Times are US Central (UTC-6).
// ---------------------------------------------------------------------------
export const events: Event[] = [
  {
    id: "evt_neon_harbor",
    title: "Neon Harbor: Midnight Tides Tour",
    category: "concert",
    venue: "Riverside Amphitheater",
    city: "Austin, TX",
    startsAt: "2026-11-21T20:00:00-06:00",
    imageGradient: "bg-gradient-to-br from-fuchsia-600 via-purple-700 to-indigo-900",
    priceFromUsd: 75,
    resaleCapUsd: 120,
    royaltyBps: 500,
    organizerName: "Neon Harbor",
  },
  {
    id: "evt_lila_vance",
    title: "Lila Vance & The Static",
    category: "concert",
    venue: "The Foundry Hall",
    city: "Dallas, TX",
    startsAt: "2026-12-05T19:30:00-06:00",
    imageGradient: "bg-gradient-to-br from-orange-500 via-rose-600 to-red-900",
    priceFromUsd: 55,
    resaleCapUsd: 90,
    royaltyBps: 750,
    organizerName: "Static Sound Co.",
  },
  {
    id: "evt_ut_am",
    title: "UT vs. A&M: Rivalry Game",
    category: "sports",
    venue: "Memorial Stadium",
    city: "Austin, TX",
    startsAt: "2026-11-28T18:30:00-06:00",
    imageGradient: "bg-gradient-to-br from-orange-600 via-amber-700 to-red-950",
    priceFromUsd: 85,
    resaleCapUsd: 150,
    royaltyBps: 300,
    organizerName: "UT Athletics",
  },
  {
    id: "evt_soccer",
    title: "Austin Riverhawks vs. Dallas Comets",
    category: "sports",
    venue: "Lakeside Park Stadium",
    city: "Austin, TX",
    startsAt: "2026-12-12T15:00:00-06:00",
    imageGradient: "bg-gradient-to-br from-emerald-500 via-green-700 to-slate-900",
    priceFromUsd: 35,
    resaleCapUsd: 60,
    royaltyBps: 500,
    organizerName: "Riverhawks FC",
  },
  {
    id: "evt_winter_gala",
    title: "Campus Lights Winter Gala",
    category: "campus",
    venue: "Student Union Ballroom",
    city: "Austin, TX",
    startsAt: "2026-12-04T19:00:00-06:00",
    imageGradient: "bg-gradient-to-br from-sky-400 via-blue-600 to-indigo-950",
    priceFromUsd: 20,
    resaleCapUsd: 30,
    royaltyBps: 0,
    organizerName: "Student Activities Board",
  },
  {
    id: "evt_battle_bands",
    title: "Battle of the Bands: Dorm Edition",
    category: "campus",
    venue: "West Quad Lawn",
    city: "Austin, TX",
    startsAt: "2026-12-15T18:00:00-06:00",
    imageGradient: "bg-gradient-to-br from-yellow-400 via-lime-600 to-teal-900",
    priceFromUsd: 10,
    resaleCapUsd: null, // no cap: free-for-all campus event
    royaltyBps: 0,
    organizerName: "Campus Radio KSRF",
  },
];

// ---------------------------------------------------------------------------
// Seat-map demo inventory: 8 extra listed seats per event, spread across sections and tiers so the
// event page seat map has something to show. All priced within each event's resaleCapUsd
// (lst_02 above stays the one over-cap listing). Each row becomes one Ticket + one Listing.
// ---------------------------------------------------------------------------
type DemoSeat = [eventId: string, section: string, row: string, seat: string, tier: 1 | 2, priceUsd: number, sellerId: string, sellerName: string, sellerRating: number];

const demoSeats: DemoSeat[] = [
  // Neon Harbor (cap $120)
  ["evt_neon_harbor", "Floor", "A", "8", 1, 118, "user_dana", "Dana W.", 4.9],
  ["evt_neon_harbor", "Floor", "B", "3", 2, 115, "user_chris", "Chris L.", 4.1],
  ["evt_neon_harbor", "104", "H", "7", 1, 92, "user_mei", "Mei H.", 4.7],
  ["evt_neon_harbor", "106", "D", "2", 2, 88, "user_tomas", "Tomás G.", 3.8],
  ["evt_neon_harbor", "203", "L", "14", 1, 79, "user_riley", "Riley B.", 4.5],
  ["evt_neon_harbor", "208", "F", "9", 2, 70, "user_ola", "Ola N.", 4.3],
  ["evt_neon_harbor", "305", "R", "21", 1, 64, "user_dana", "Dana W.", 4.9],
  ["evt_neon_harbor", "Lawn", "L", "30", 2, 55, "user_chris", "Chris L.", 4.1],
  // Lila Vance (cap $90)
  ["evt_lila_vance", "Floor", "C", "11", 1, 88, "user_mei", "Mei H.", 4.7],
  ["evt_lila_vance", "102", "E", "5", 1, 72, "user_riley", "Riley B.", 4.5],
  ["evt_lila_vance", "105", "G", "9", 2, 66, "user_tomas", "Tomás G.", 3.8],
  ["evt_lila_vance", "109", "B", "1", 1, 85, "user_dana", "Dana W.", 4.9],
  ["evt_lila_vance", "201", "M", "4", 1, 60, "user_ola", "Ola N.", 4.3],
  ["evt_lila_vance", "207", "J", "15", 2, 58, "user_chris", "Chris L.", 4.1],
  ["evt_lila_vance", "Balcony", "F", "18", 1, 52, "user_sam", "Sam R.", 5.0],
  ["evt_lila_vance", "310", "P", "6", 2, 48, "user_alex", "Alex K.", 3.9],
  // UT vs. A&M (cap $150)
  ["evt_ut_am", "103", "D", "10", 1, 140, "user_dana", "Dana W.", 4.9],
  ["evt_ut_am", "106", "J", "3", 2, 128, "user_tomas", "Tomás G.", 3.8],
  ["evt_ut_am", "109", "S", "22", 1, 118, "user_mei", "Mei H.", 4.7],
  ["evt_ut_am", "Student", "4", "30", 1, 90, "user_riley", "Riley B.", 4.5],
  ["evt_ut_am", "205", "K", "8", 2, 105, "user_ola", "Ola N.", 4.3],
  ["evt_ut_am", "211", "C", "12", 1, 99, "user_sam", "Sam R.", 5.0],
  ["evt_ut_am", "304", "W", "7", 1, 86, "user_chris", "Chris L.", 4.1],
  ["evt_ut_am", "314", "Y", "19", 2, 80, "user_alex", "Alex K.", 3.9],
  // Riverhawks vs. Comets (cap $60)
  ["evt_soccer", "101", "A", "6", 1, 58, "user_dana", "Dana W.", 4.9],
  ["evt_soccer", "104", "F", "2", 2, 52, "user_chris", "Chris L.", 4.1],
  ["evt_soccer", "110", "H", "13", 1, 45, "user_mei", "Mei H.", 4.7],
  ["evt_soccer", "Supporters", "D", "4", 2, 44, "user_tomas", "Tomás G.", 3.8],
  ["evt_soccer", "209", "N", "8", 1, 38, "user_riley", "Riley B.", 4.5],
  ["evt_soccer", "302", "T", "15", 1, 33, "user_ola", "Ola N.", 4.3],
  ["evt_soccer", "312", "V", "1", 2, 30, "user_alex", "Alex K.", 3.9],
  ["evt_soccer", "Student", "2", "11", 1, 36, "user_sam", "Sam R.", 5.0],
  // Winter Gala (cap $30)
  ["evt_winter_gala", "Floor", "B", "2", 1, 29, "user_mei", "Mei H.", 4.7],
  ["evt_winter_gala", "Floor", "D", "7", 2, 27, "user_chris", "Chris L.", 4.1],
  ["evt_winter_gala", "103", "C", "5", 1, 24, "user_riley", "Riley B.", 4.5],
  ["evt_winter_gala", "107", "E", "9", 2, 22, "user_tomas", "Tomás G.", 3.8],
  ["evt_winter_gala", "202", "G", "3", 1, 21, "user_dana", "Dana W.", 4.9],
  ["evt_winter_gala", "206", "H", "11", 1, 19, "user_ola", "Ola N.", 4.3],
  ["evt_winter_gala", "304", "K", "6", 2, 18, "user_sam", "Sam R.", 5.0],
  ["evt_winter_gala", "Balcony", "A", "2", 1, 26, "user_alex", "Alex K.", 3.9],
  // Battle of the Bands (no cap)
  ["evt_battle_bands", "Floor", "A", "3", 1, 15, "user_riley", "Riley B.", 4.5],
  ["evt_battle_bands", "Floor", "C", "9", 2, 14, "user_chris", "Chris L.", 4.1],
  ["evt_battle_bands", "101", "B", "4", 1, 12, "user_mei", "Mei H.", 4.7],
  ["evt_battle_bands", "105", "D", "8", 1, 11, "user_dana", "Dana W.", 4.9],
  ["evt_battle_bands", "108", "F", "2", 2, 10, "user_tomas", "Tomás G.", 3.8],
  ["evt_battle_bands", "204", "H", "6", 1, 9, "user_ola", "Ola N.", 4.3],
  ["evt_battle_bands", "Lawn", "L", "12", 1, 8, "user_sam", "Sam R.", 5.0],
  ["evt_battle_bands", "Lawn", "M", "20", 2, 8, "user_alex", "Alex K.", 3.9],
];

const demoTickets: Ticket[] = demoSeats.map(([eventId, section, row, seat, tier, , sellerId], i) => ({
  id: `tkt_demo_${i + 1}`,
  eventId,
  section,
  row,
  seat,
  tier,
  ownerId: sellerId,
  ...(tier === 1 && { mintAddress: `MockMintDemo${String(i + 1).padStart(30, "0")}` }),
}));

const demoListings: Listing[] = demoSeats.map(([eventId, , , , tier, priceUsd, sellerId, sellerName, sellerRating], i) => ({
  id: `lst_demo_${i + 1}`,
  ticketId: `tkt_demo_${i + 1}`,
  eventId,
  sellerId,
  sellerName,
  sellerRating,
  priceUsd,
  tier,
  bondUsd: tier === 2 ? Math.max(5, Math.round(priceUsd * 0.15)) : 0,
  createdAt: new Date(Date.UTC(2026, 10, 16, 12, i)).toISOString(),
}));

// ---------------------------------------------------------------------------
// Tickets (12 + demo seats), mixed Tier 1 (onchain, has mintAddress) and Tier 2 (outside ticket).
// ---------------------------------------------------------------------------
export const tickets: Ticket[] = [
  { id: "tkt_01", eventId: "evt_neon_harbor", section: "GA", row: "-", seat: "-", tier: 1, ownerId: MOCK_USER_ID, mintAddress: "MockMint1111111111111111111111111111111111" },
  { id: "tkt_02", eventId: "evt_neon_harbor", section: "101", row: "C", seat: "12", tier: 1, ownerId: "user_jordan", mintAddress: "MockMint2222222222222222222222222222222222" },
  { id: "tkt_03", eventId: "evt_neon_harbor", section: "101", row: "C", seat: "13", tier: 1, ownerId: "user_jordan", mintAddress: "MockMint3333333333333333333333333333333333" },
  { id: "tkt_04", eventId: "evt_lila_vance", section: "Floor", row: "A", seat: "4", tier: 2, ownerId: "user_priya" },
  { id: "tkt_05", eventId: "evt_lila_vance", section: "Balcony", row: "F", seat: "22", tier: 2, ownerId: MOCK_USER_ID },
  { id: "tkt_06", eventId: "evt_ut_am", section: "112", row: "28", seat: "5", tier: 2, ownerId: "user_marcus" },
  { id: "tkt_07", eventId: "evt_ut_am", section: "112", row: "28", seat: "6", tier: 2, ownerId: "user_marcus" },
  { id: "tkt_08", eventId: "evt_ut_am", section: "Student", row: "GA", seat: "-", tier: 1, ownerId: MOCK_USER_ID, mintAddress: "MockMint8888888888888888888888888888888888" },
  { id: "tkt_09", eventId: "evt_soccer", section: "Supporters", row: "B", seat: "9", tier: 1, ownerId: "user_sam", mintAddress: "MockMint9999999999999999999999999999999999" },
  { id: "tkt_10", eventId: "evt_soccer", section: "204", row: "K", seat: "17", tier: 2, ownerId: "user_priya" },
  { id: "tkt_11", eventId: "evt_winter_gala", section: "GA", row: "-", seat: "-", tier: 1, ownerId: "user_alex", mintAddress: "MockMintAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" },
  { id: "tkt_12", eventId: "evt_battle_bands", section: "Lawn", row: "-", seat: "-", tier: 1, ownerId: "user_alex", mintAddress: "MockMintBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB" },
  ...demoTickets,
];

// ---------------------------------------------------------------------------
// Listings (8 + demo seats). Tier 1 has bondUsd 0; Tier 2 sellers post a bond.
// ---------------------------------------------------------------------------
export const listings: Listing[] = [
  { id: "lst_01", ticketId: "tkt_02", eventId: "evt_neon_harbor", sellerId: "user_jordan", sellerName: "Jordan P.", sellerRating: 4.8, priceUsd: 110, tier: 1, bondUsd: 0, createdAt: "2026-11-14T16:05:00Z" },
  // SCALPER DEMO: Tier 1 listing priced ABOVE the event's resaleCapUsd ($120).
  // The program must reject this listing ("scalper blocked" demo).
  { id: "lst_02", ticketId: "tkt_03", eventId: "evt_neon_harbor", sellerId: "user_jordan", sellerName: "Jordan P.", sellerRating: 4.8, priceUsd: 260, tier: 1, bondUsd: 0, createdAt: "2026-11-14T16:07:00Z" },
  { id: "lst_03", ticketId: "tkt_04", eventId: "evt_lila_vance", sellerId: "user_priya", sellerName: "Priya S.", sellerRating: 4.6, priceUsd: 82, tier: 2, bondUsd: 10, createdAt: "2026-11-13T21:40:00Z" },
  { id: "lst_04", ticketId: "tkt_06", eventId: "evt_ut_am", sellerId: "user_marcus", sellerName: "Marcus T.", sellerRating: 4.2, priceUsd: 95, tier: 2, bondUsd: 15, createdAt: "2026-11-15T02:10:00Z" },
  { id: "lst_05", ticketId: "tkt_07", eventId: "evt_ut_am", sellerId: "user_marcus", sellerName: "Marcus T.", sellerRating: 4.2, priceUsd: 95, tier: 2, bondUsd: 15, createdAt: "2026-11-15T02:11:00Z" },
  { id: "lst_06", ticketId: "tkt_09", eventId: "evt_soccer", sellerId: "user_sam", sellerName: "Sam R.", sellerRating: 5.0, priceUsd: 48, tier: 1, bondUsd: 0, createdAt: "2026-11-12T18:30:00Z" },
  { id: "lst_07", ticketId: "tkt_10", eventId: "evt_soccer", sellerId: "user_priya", sellerName: "Priya S.", sellerRating: 4.6, priceUsd: 40, tier: 2, bondUsd: 5, createdAt: "2026-11-15T23:55:00Z" },
  { id: "lst_08", ticketId: "tkt_11", eventId: "evt_winter_gala", sellerId: "user_alex", sellerName: "Alex K.", sellerRating: 3.9, priceUsd: 25, tier: 1, bondUsd: 0, createdAt: "2026-11-16T09:15:00Z" },
  ...demoListings,
];

// ---------------------------------------------------------------------------
// Orders (3): HELD (Tier 2), IN_TRANSIT (Tier 2), RELEASED (Tier 1 via swap).
// ---------------------------------------------------------------------------
export const orders: Order[] = [
  {
    id: "ord_held",
    listingId: "lst_04",
    eventId: "evt_ut_am",
    buyerId: MOCK_USER_ID,
    sellerId: "user_marcus",
    amountUsd: 95,
    tier: 2,
    state: "HELD",
    shipDeadline: fromNow(2 * HOUR),
    confirmDeadline: fromNow(26 * HOUR),
    vaultAddress: "MockVau1tHe1d111111111111111111111111111111",
    events: [
      { id: "oe_held_1", orderId: "ord_held", type: "FUNDED", message: "You paid $95.00. It's locked in the SeatSafe vault.", at: fromNow(-10 * 60 * 1000) },
      { id: "oe_held_2", orderId: "ord_held", type: "FUNDED", message: "Seller posted a $15.00 bond. They have 2 hours to send the ticket.", at: fromNow(-9 * 60 * 1000) },
    ],
  },
  {
    id: "ord_transit",
    listingId: "lst_03",
    eventId: "evt_lila_vance",
    buyerId: MOCK_USER_ID,
    sellerId: "user_priya",
    amountUsd: 82,
    tier: 2,
    state: "IN_TRANSIT",
    shipDeadline: fromNow(-1 * HOUR),
    confirmDeadline: fromNow(23 * HOUR),
    vaultAddress: "MockVau1tTransit11111111111111111111111111",
    events: [
      { id: "oe_tr_1", orderId: "ord_transit", type: "FUNDED", message: "You paid $82.00. It's locked in the SeatSafe vault.", at: fromNow(-3 * HOUR) },
      { id: "oe_tr_2", orderId: "ord_transit", type: "FUNDED", message: "Seller posted a $10.00 bond.", at: fromNow(-3 * HOUR + 2 * 60 * 1000) },
      { id: "oe_tr_3", orderId: "ord_transit", type: "TICKET_SENT", message: "Seller sent the ticket to your email. Check it and confirm.", at: fromNow(-90 * 60 * 1000) },
    ],
  },
  {
    id: "ord_released",
    listingId: "lst_06",
    eventId: "evt_soccer",
    buyerId: MOCK_USER_ID,
    sellerId: "user_sam",
    amountUsd: 48,
    tier: 1,
    state: "RELEASED",
    shipDeadline: "2026-11-15T20:00:00Z",
    confirmDeadline: "2026-11-15T20:00:00Z",
    events: [
      { id: "oe_rel_1", orderId: "ord_released", type: "FUNDED", message: "You paid $48.00.", at: "2026-11-15T19:58:10Z" },
      { id: "oe_rel_2", orderId: "ord_released", type: "SWAPPED", message: "Ticket and payment swapped in one transaction.", txSignature: "MockSig5wapXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX", at: "2026-11-15T19:58:12Z" },
      { id: "oe_rel_3", orderId: "ord_released", type: "RELEASED", message: "Seller received $45.60 (artist royalty $2.40 paid automatically).", txSignature: "MockSigRe1easeXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX", at: "2026-11-15T19:58:12Z" },
    ],
  },
];

// ---------------------------------------------------------------------------
// Standing orders (2) for the agent page.
// ---------------------------------------------------------------------------
export const standingOrders: StandingOrder[] = [
  { id: "so_01", userId: MOCK_USER_ID, eventId: "evt_ut_am", quantity: 2, maxPriceUsd: 90, minSellerRating: 4.0, deadline: "2026-11-27T23:59:00-06:00", budgetUsd: 180, status: "OPEN" },
  { id: "so_02", userId: MOCK_USER_ID, eventId: "evt_neon_harbor", quantity: 1, maxPriceUsd: 100, minSellerRating: 4.5, deadline: "2026-11-20T23:59:00-06:00", budgetUsd: 100, status: "FILLED" },
];

// ---------------------------------------------------------------------------
// Chat messages (4) on the in-transit order. One is high risk (off-platform payment).
// ---------------------------------------------------------------------------
export const chatMessages: ChatMessage[] = [
  { id: "msg_01", orderId: "ord_transit", senderId: MOCK_USER_ID, body: "Hi! Just paid. Are these the floor seats in row A?", risk: "low", at: fromNow(-170 * 60 * 1000) },
  { id: "msg_02", orderId: "ord_transit", senderId: "user_priya", body: "Yep, Floor A seat 4. Sending it over now.", risk: "low", at: fromNow(-150 * 60 * 1000) },
  { id: "msg_03", orderId: "ord_transit", senderId: "user_priya", body: "Actually can you cancel and just pay me on Zelle, faster that way", risk: "high", riskReason: "Asks to pay outside SeatSafe, so the payment would not be protected.", at: fromNow(-120 * 60 * 1000) },
  { id: "msg_04", orderId: "ord_transit", senderId: MOCK_USER_ID, body: "I'll stick with SeatSafe, thanks.", risk: "low", at: fromNow(-115 * 60 * 1000) },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
export function getEvent(id: string): Event | undefined {
  return events.find((e) => e.id === id);
}

export function getOrder(id: string): Order | undefined {
  return orders.find((o) => o.id === id);
}

export function getListingsForEvent(id: string): Listing[] {
  return listings.filter((l) => l.eventId === id);
}

// Sample notifications for the nav bell in mock mode (real mode: Supabase `notifications`, Stream-fed).
export const notifications: import("./notifications").AppNotification[] = [
  { id: "ntf_1", wallet: MOCK_USER_ID, kind: "sold", title: "Your ticket sold: $13.58 received", body: "Resold at $14.00 · Battle of the Bands: Dorm Edition. Paid in the same transaction.", url: "/tickets", tx_signature: null, created_at: "2026-11-18T19:40:00Z", read_at: null },
  { id: "ntf_2", wallet: MOCK_USER_ID, kind: "refunded", title: "Seller didn't deliver: your $20.00 (+ $2.00 bond) is back", body: "The ship deadline passed, so SeatSafe refunded you automatically.", url: "/orders/ord_released", tx_signature: null, created_at: "2026-11-18T19:30:00Z", read_at: null },
  { id: "ntf_3", wallet: MOCK_USER_ID, kind: "minted", title: "You're in! Ticket for Neon Harbor: Midnight Tides Tour", body: "GA. Find it in My tickets.", url: "/tickets", tx_signature: null, created_at: "2026-11-18T18:00:00Z", read_at: null },
];
