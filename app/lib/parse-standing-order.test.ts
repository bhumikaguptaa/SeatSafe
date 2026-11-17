import assert from "node:assert/strict";
import test from "node:test";
import { parseStandingOrderText } from "./parse-standing-order.ts";
import type { Event } from "./types.ts";

const events: Event[] = [
  {
    id: "evt_ut_am",
    title: "UT vs. A&M: Rivalry Game",
    category: "sports",
    venue: "Memorial Stadium",
    city: "Austin, TX",
    startsAt: "2026-11-28T18:30:00-06:00",
    imageGradient: "",
    priceFromUsd: 85,
    resaleCapUsd: 150,
    royaltyBps: 300,
    organizerName: "UT Athletics",
  },
];

const friday = new Date("2026-11-16T18:00:00-06:00").getTime();

test("plain English becomes quantity, price, rating, event and deadline", () => {
  const parsed = parseStandingOrderText(
    "2 tickets for UT vs A&M, under $90 each, sellers with 4+ stars, before Friday.",
    events,
    friday,
  );
  assert.equal(parsed.eventId, "evt_ut_am");
  assert.equal(parsed.quantity, 2);
  assert.equal(parsed.maxPrice, 90);
  assert.equal(parsed.minRating, 4);
  assert.ok(parsed.deadline);
  assert.equal(new Date(parsed.deadline!).getDay(), 5);
});
