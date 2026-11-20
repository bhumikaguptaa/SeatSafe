// Owner: A. ONE seat naming scheme for the whole app: formatSeat(event, seat) -> { area, section, row, seat, label }.
// Used by the listing list, the listing detail / checkout card, My tickets, the gate pass and the Solana Pay sheet.
//
// Seats come in three shapes:
//   - a stadium seat code stored onchain by the seat map ("WL R3 S12"; lib/stadium-map.ts)
//   - a structured { section, row, seat } (mock tickets)
//   - free text from older tickets / outside listings ("Sec 112 Row 28 Seat 5", "Lawn GA 5")
// The zone word depends on the event category, so a concert never says "End zone" or "Sideline":
//   sports  -> Sideline / End zone / Lower bowl / Upper bowl (+ Suites)
//   concert -> Floor / Lower tier / Upper tier / Balcony
//   campus  -> GA / Lawn
// Section numbers (101–140, 201–240, 301–320) are the same ones the 2D map draws (components/SeatMap.tsx).

import { buildLayout, parseSeatCode, SECTIONS, VIP, type SectionDef, type SectionId, type SeatSlot } from "./stadium-map";
import type { Event } from "./types";

export type Category = Event["category"];

/** Map areas (geometry), named per category by AREA_NAMES. */
export type AreaKey = "premium" | "club" | "sideline" | "endzone" | "upper";

export const AREA_NAMES: Record<Category, Record<AreaKey, string>> = {
  sports: { premium: "Suites", club: "Lower bowl", sideline: "Sideline", endzone: "End zone", upper: "Upper bowl" },
  concert: { premium: "Balcony", club: "Upper tier", sideline: "Lower tier", endzone: "Floor", upper: "Balcony" },
  campus: { premium: "GA", club: "Lawn", sideline: "GA", endzone: "GA", upper: "Lawn" },
};

/** Area word for free-text seats (no geometry to go on). */
const DEFAULT_AREA: Record<Category, string> = { sports: "Lower bowl", concert: "Floor", campus: "GA" };

export function areaName(category: Category | undefined, key: AreaKey): string {
  return AREA_NAMES[category ?? "concert"][key];
}

// ---- Section numbering (shared with the 2D map) ----

/** How many numbered sections each stand is split into. */
export const SPLIT: Record<SectionId, number> = { N: 6, NE: 4, EL: 6, SE: 4, S: 6, SW: 4, WL: 6, NW: 4, EU: 10, WU: 10, VIP: 1 };
export const LOWER_ORDER: SectionId[] = ["N", "NE", "EL", "SE", "S", "SW", "WL", "NW"];
export const frontRows = (def: SectionDef) => (def.tier === "lower" ? Math.ceil(def.rows / 2) : def.rows);
const DEF_BY_ID = new Map<SectionId, SectionDef>([...SECTIONS, VIP].map((d) => [d.id, d]));

/** Ring of a seat: 0 = VIP, 1 = lower front (100s), 2 = lower back (200s), 3 = upper decks (300s). */
export function ringOf(def: SectionDef, row: number): 0 | 1 | 2 | 3 {
  return def.tier === "upper" ? 3 : def.tier === "vip" ? 0 : row <= frontRows(def) ? 1 : 2;
}

/** Index of the numbered section inside its stand (0..SPLIT-1), from the seat's angle. */
export function splitIndex(def: SectionDef, theta: number): number {
  const k = SPLIT[def.id];
  return Math.min(k - 1, Math.max(0, Math.floor(((theta - def.from) / (def.to - def.from)) * k)));
}

/** "134", "212", "305" or "VIP" for a stand / ring / split index. */
export function sectionNumber(stand: SectionId, ring: 0 | 1 | 2 | 3, i: number): string {
  if (stand === "VIP") return "VIP";
  if (ring === 3) return String(301 + (stand === "WU" ? SPLIT.EU : 0) + i);
  let n = ring * 100 + 1;
  for (const id of LOWER_ORDER) {
    if (id === stand) return String(n + i);
    n += SPLIT[id];
  }
  return "?";
}

export function areaKeyOf(stand: SectionId, ring: 0 | 1 | 2 | 3): AreaKey {
  if (ring === 0) return "premium";
  if (ring === 3) return "upper";
  if (ring === 2) return "club";
  return stand === "EL" || stand === "WL" ? "sideline" : "endzone";
}

let slotIndex: Map<string, SeatSlot> | null = null;
function slotAt(stand: SectionId, row: number, seat: number): SeatSlot | undefined {
  if (!slotIndex) {
    slotIndex = new Map();
    for (const l of buildLayout()) for (const s of l.slots) slotIndex.set(`${s.section}|${s.row}|${s.seat}`, s);
  }
  return slotIndex.get(`${stand}|${row}|${seat}`);
}

// ---- formatSeat ----

export interface FormattedSeat {
  /** Zone word for this category, e.g. "Sideline", "Lower tier", "GA". */
  area: string;
  /** Section number or name ("134", "VIP", "112"); "" for general admission. */
  section: string;
  row: string;
  seat: string;
  /** "Sideline · Sec 134 · Row 19 · Seat 4" (parts that don't apply are left out). */
  label: string;
}

export type SeatInput =
  | string
  | { stand: SectionId; row: number; seat: number }
  | { section: string; row: string; seat: string };

function join(area: string, section: string, row: string, seat: string): string {
  const parts = [area];
  if (section && section.toLowerCase() !== area.toLowerCase()) parts.push(section === "VIP" ? "VIP box" : `Sec ${section}`);
  if (row && row !== "-") parts.push(`Row ${row}`);
  if (seat && seat !== "-") parts.push(`Seat ${seat}`);
  return parts.join(" · ");
}

function fromStadium(category: Category | undefined, stand: SectionId, row: number, seat: number): FormattedSeat {
  const def = DEF_BY_ID.get(stand)!;
  const ring = ringOf(def, row);
  const slot = slotAt(stand, row, seat);
  const section = sectionNumber(stand, ring, slot ? splitIndex(def, slot.theta) : 0);
  const area = areaName(category, areaKeyOf(stand, ring));
  return { area, section, row: String(row), seat: String(seat), label: join(area, section, String(row), String(seat)) };
}

/**
 * One label for a seat everywhere. `event` only needs its category (undefined -> concert wording).
 */
export function formatSeat(event: { category?: Category } | null | undefined, seat: SeatInput | null | undefined): FormattedSeat {
  const category = event?.category;
  if (seat == null || seat === "") {
    const area = DEFAULT_AREA[category ?? "concert"];
    return { area, section: "", row: "", seat: "", label: area };
  }
  if (typeof seat === "object" && "stand" in seat) return fromStadium(category, seat.stand, seat.row, seat.seat);

  let parts: { section: string; row: string; seat: string };
  if (typeof seat === "string") {
    const code = parseSeatCode(seat);
    if (code) return fromStadium(category, code.section, code.row, code.seat);
    const m = /Sec(?:tion)?\.?\s+(\S+?),?\s+Row\s+(\S+?),?\s+Seat\s+(\S+)/i.exec(seat);
    if (m) parts = { section: m[1], row: m[2], seat: m[3] };
    else {
      // "Lawn GA 5", "GA", "Lawn GA (outside ticket)": general admission, maybe with a number.
      const lawn = /lawn/i.test(seat);
      const area = lawn && category === "campus" ? "Lawn" : DEFAULT_AREA[category ?? "concert"];
      const num = /\b(\d+)\b/.exec(seat)?.[1] ?? "";
      const extra = /\(([^)]+)\)/.exec(seat)?.[1];
      const label = [area === "Lawn" ? "Lawn · GA" : area, num && `No. ${num}`, extra].filter(Boolean).join(" · ");
      return { area, section: "", row: "", seat: num, label };
    }
  } else parts = seat;

  if (!parts.row || parts.row === "-") {
    // Section only (e.g. "GA" or "Lawn"): general admission.
    const lawn = /lawn/i.test(parts.section);
    const area = lawn && category === "campus" ? "Lawn" : DEFAULT_AREA[category ?? "concert"];
    return { area, section: "", row: "", seat: "", label: area };
  }
  const n = Number(parts.section);
  // Numbered sections follow the map's rings: 100s lower, 200s lower back, 300s upper.
  const key: AreaKey = !Number.isFinite(n) ? "endzone" : n >= 300 ? "upper" : n >= 200 ? "club" : "sideline";
  const area = Number.isFinite(n) ? areaName(category, key) : DEFAULT_AREA[category ?? "concert"];
  return { ...parts, area, label: join(area, parts.section, parts.row, parts.seat) };
}
