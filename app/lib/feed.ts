// Owner: A. Cleans the protection-ticker feed: hides devnet test noise (< $5) and repeats of the same line
// within 60 s. Used by lib/server/stats.ts and the ticker (mock data too). Input sorted newest first.

export interface FeedItem {
  id: string;
  text: string;
  at: string;
  /** Dollar amount the item is about, when it has one. */
  amountUsd?: number;
}

/** Feed items below this are devnet test noise and are hidden from the ticker. */
export const MIN_FEED_USD = 5;
const DEDUPE_MS = 60_000;

export function cleanFeed<T extends FeedItem>(items: T[]): T[] {
  const lastSeen = new Map<string, number>();
  return items.filter((it) => {
    if (it.amountUsd != null && it.amountUsd < MIN_FEED_USD) return false;
    const t = new Date(it.at).getTime();
    const prev = lastSeen.get(it.text);
    lastSeen.set(it.text, t);
    return prev == null || Math.abs(prev - t) > DEDUPE_MS;
  });
}
