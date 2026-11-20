// Owner: A. Event artwork: original abstract renders in public/events/ (generated for SeatSafe; no logos,
// no real artists, no copyrighted art). event.imageUrl wins; otherwise the art is picked by event id
// (demo events), then by category.

import type { Event } from "./types";

const BY_ID: Record<string, string> = {
  // devnet events (lib/event-meta.json)
  Hw1cWsKxef959oD338Qx86TjDt2km4XXRBqPgxjjvL7a: "/events/concert-neon.svg",
  "6hW7X8JNFfwhU7Qx3dFTyy3LUa5tsCvMWyFhREdZZXzs": "/events/sports.svg",
  EMhrDn2puUvJac9PZ15CCTUftj2Axv6E7wp81oV1RzxE: "/events/campus.svg",
  // mock events (lib/mock.ts)
  evt_neon_harbor: "/events/concert-neon.svg",
  evt_lila_vance: "/events/concert-warm.svg",
  evt_ut_am: "/events/sports.svg",
  evt_soccer: "/events/sports.svg",
  evt_winter_gala: "/events/campus.svg",
  evt_battle_bands: "/events/campus.svg",
};

const BY_CATEGORY: Record<Event["category"], string> = {
  concert: "/events/concert-warm.svg",
  sports: "/events/sports.svg",
  campus: "/events/campus.svg",
};

export function eventImage(e: Pick<Event, "id" | "category"> & { imageUrl?: string }): string {
  return e.imageUrl || BY_ID[e.id] || BY_CATEGORY[e.category] || BY_CATEGORY.concert;
}
