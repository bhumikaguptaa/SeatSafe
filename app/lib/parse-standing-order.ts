// Turns one English sentence into standing-order rules.
// The API calls an LLM first and falls back to this parser when no key is set or the model fails.
// Event matching is against the catalog the caller passes in (Supabase and/or chain).

import type { Event } from "./types";

export interface ParsedStandingOrder {
  eventId: string | null;
  quantity: number;
  maxPrice: number | null;
  minRating: number | null;
  /** ISO-8601, or null when the sentence had no deadline. */
  deadline: string | null;
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  a: 1,
  an: 1,
};
const STOPWORDS = new Set([
  "tickets", "ticket", "for", "under", "the", "and", "seats", "seat", "before", "star",
  "stars", "sellers", "seller", "vs", "game", "max", "with", "from", "each", "than",
  "less", "below", "want", "need", "please", "get", "buy", "me",
]);

function words(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/&/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
}

/** Best event whose title shares at least two meaningful words, or one rare word of length >= 4. */
export function matchEvent(text: string, events: Event[]): Event | null {
  const asked = new Set(words(text));
  let best: Event | null = null;
  let bestScore = 0;
  for (const e of events) {
    const titleWords = words(e.title);
    const score = titleWords.filter((w) => asked.has(w)).length;
    const singleStrong = titleWords.some((w) => w.length >= 4 && asked.has(w));
    const rank = score >= 2 ? score : singleStrong ? 1 : 0;
    if (rank > bestScore) {
      best = e;
      bestScore = rank;
    }
  }
  return best;
}

/** "before Friday" / "by Friday" -> the next matching weekday at 23:59 local time. */
export function parseDeadline(text: string, nowMs: number): string | null {
  const lower = text.toLowerCase();
  const named = lower.match(/(?:before|by)\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)/);
  if (named) {
    const target = WEEKDAYS.indexOf(named[1]);
    const d = new Date(nowMs);
    const ahead = (target - d.getDay() + 7) % 7 || 7;
    d.setDate(d.getDate() + ahead);
    d.setHours(23, 59, 0, 0);
    return d.toISOString();
  }
  const iso = lower.match(/\b(20\d{2}-\d{2}-\d{2})(?:[t ](\d{2}:\d{2}))?/);
  if (iso) {
    const d = new Date(`${iso[1]}T${iso[2] ?? "23:59"}:00`);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return null;
}

export function parseStandingOrderText(text: string, events: Event[], nowMs = Date.now()): ParsedStandingOrder {
  const lower = text.toLowerCase();
  const qtyMatch = lower.match(/\b(\d+|one|two|three|four|five|six|a|an)\s+(?:tickets?|seats?)/);
  const quantity = qtyMatch ? (NUMBER_WORDS[qtyMatch[1]] ?? Number(qtyMatch[1])) : 1;
  const priceMatch = lower.match(/(?:under|below|max|less than|up to|<)\s*\$?\s*(\d+(?:\.\d+)?)/);
  const maxPrice = priceMatch ? Number(priceMatch[1]) : null;
  const ratingMatch = lower.match(/(\d(?:\.\d)?)\s*\+?\s*(?:-|\s)?(?:stars?|★)/);
  const minRating = ratingMatch ? Math.min(5, Number(ratingMatch[1])) : null;
  const event = matchEvent(text, events);
  return {
    eventId: event?.id ?? null,
    quantity: Number.isFinite(quantity) && quantity > 0 ? Math.min(8, Math.floor(quantity)) : 1,
    maxPrice,
    minRating,
    deadline: parseDeadline(text, nowMs),
  };
}
