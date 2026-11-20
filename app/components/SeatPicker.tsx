"use client";

// Owner: D. Seat picker on /events/[id]: the listings + seat-map marketplace (components/SeatMap.tsx).
// The only seat picker on the site; the 3D stadium is not rendered. Seat data, the ticket card and the buy
// code come from components/stadium/seat-buy.tsx.

import type { ChainListing } from "@/lib/chain";
import type { PickerEvent } from "@/components/stadium/seat-buy";
import { SeatMap } from "@/components/SeatMap";

export function SeatPicker({ event, listings, onDone }: { event: PickerEvent; listings: ChainListing[]; onDone: () => Promise<void> }) {
  return <SeatMap event={event} listings={listings} onDone={onDone} />;
}
