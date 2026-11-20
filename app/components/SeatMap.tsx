"use client";

// Owner: D. Event marketplace for /events/[id]: a listings column + a large venue map, in the style of the
// big ticket marketplaces (recreated from scratch: our own geometry, art, copy and SeatSafe branding).
//
// • Map: the 10 stands of lib/stadium-map.ts split into 100 numbered sections in 3 rings (101–140 lower
//   front, 201–240 lower back / club, 301–320 upper decks) + VIP suites, light pastel area tints, a detailed
//   field with HOME / AWAY (sports) or a stage + floor (concerts / campus). Smooth pan + zoom (wheel, drag,
//   pinch, + / − / reset). Price pins (lowest price per section, icon = cheapest / best deal / selling fast)
//   with collision detection. Mid zoom: listings drawn as strips on their rows; deep zoom: every seat as a
//   dot (available = colour by seat type, the rest faint).
// • Listings: runs of free seats in the same row, same seat type (e.g. "Section 134 · Row 19 · 2 tickets").
//   Filters (quantity, price, instant delivery), area tabs, sort. Hovering a listing highlights its section
//   and vice versa; clicking a listing / pin / seat selects it and opens our ticket card with Buy.
// • "How many tickets?" on load. Quantity filters listings to runs with enough seats together; checkout is
//   unchanged (the shared buy code buys the selected seat).
//
// Seat data, the ticket card and the buy code come from components/stadium/seat-buy.tsx (unchanged).

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, Banknote, ChevronDown, ChevronLeft, ChevronRight, Flame, Minus, Plus, RotateCcw, ShieldCheck, SlidersHorizontal, Star, Tag, X, Zap } from "lucide-react";
import type { ChainListing } from "@/lib/chain";
import { buildLayout, innerRadius, SECTIONS, VIP, type SectionDef, type SectionId, type SeatKind, type SeatSlot, type SeatState } from "@/lib/stadium-map";
import { KIND_COLOR, TicketCard, useSeatBuy, useStadiumStates, type PickerEvent, type SeatPick } from "@/components/stadium/seat-buy";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// World geometry (metres). θ = 0 → +x (right); world y = -r·sin θ, so West Lower sits at the bottom.
// ---------------------------------------------------------------------------

const RD = 0.85; // row depth
const STRIP_PX_PER_M = 4.2; // listing strips appear
const DOTS_PX_PER_M = 8; // individual seats appear
const MAX_PX_PER_M = 44;
const PAD = 16;

const r2 = (n: number) => Math.round(n * 100) / 100;
function polar(thetaDeg: number, r: number): [number, number] {
  const t = (thetaDeg * Math.PI) / 180;
  return [r * Math.cos(t), -r * Math.sin(t)];
}
/**
 * Visual-only geometry (seat data and seat codes are untouched). Everything is measured in "row space":
 * rowPos 0 = the front edge of row 1, rowPos n = the back edge of row n, so section edges, row lines and
 * seat dots all come from the same function and line up exactly (dots sit at rowPos = row - 0.5).
 * The field is drawn at FIELD_K, every row is ROW_V deep, an aisle (RING_GAP) separates the 100s from the
 * 200s, and the upper decks start beyond the lower stands' back row plus a concourse (TIER_GAP) that holds
 * the VIP boxes on the west side, so no tier is drawn on top of another.
 */
const FIELD_K = 0.8;
const ROW_V = RD * 1.9;
const RING_GAP = 1.6;
const VIP_INSET = 1.8;
const TIER_GAP = VIP_INSET * 2 + 3 * ROW_V;
const SIDE_ROWS = 14; // rows of East / West Lower, under the upper decks
const baseR = (thetaDeg: number) => innerRadius(thetaDeg, "lower") * FIELD_K;
/** Visual radius of a row position in a stand. `back` = in the 200s ring (behind the aisle). */
function vr(def: SectionDef, thetaDeg: number, rowPos: number, back = false): number {
  const b = baseR(thetaDeg);
  const sideBack = b + SIDE_ROWS * ROW_V + RING_GAP;
  if (def.tier === "upper") return sideBack + TIER_GAP + rowPos * ROW_V;
  if (def.tier === "vip") return sideBack + VIP_INSET + rowPos * ROW_V;
  return b + rowPos * ROW_V + (back ? RING_GAP : 0);
}
const forSale = (k: SeatKind | undefined) => k === "available" || k === "resale" || k === "outside";
const usd = (n: number) => (Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`);
const DEF_BY_ID = new Map<SectionId, SectionDef>([...SECTIONS, VIP].map((d) => [d.id, d]));

type Area = "premium" | "club" | "sideline" | "endzone" | "upper";
const AREA: Record<Area, { label: string; fill: string; swatch: string }> = {
  premium: { label: "Premium suites", fill: "#f1e3b9", swatch: "#d4a017" },
  club: { label: "Club level", fill: "#e6dcf6", swatch: "#9d74e0" },
  sideline: { label: "Sideline", fill: "#cbeedc", swatch: "#2fae76" },
  endzone: { label: "End zone", fill: "#dfeecb", swatch: "#82b443" },
  upper: { label: "Upper deck", fill: "#d8e2fa", swatch: "#7393e6" },
};
const AREA_ORDER: Area[] = ["premium", "club", "sideline", "endzone", "upper"];

/** How many numbered sections each stand is split into. */
const SPLIT: Record<SectionId, number> = { N: 6, NE: 4, EL: 6, SE: 4, S: 6, SW: 4, WL: 6, NW: 4, EU: 10, WU: 10, VIP: 1 };
const LOWER_ORDER: SectionId[] = ["N", "NE", "EL", "SE", "S", "SW", "WL", "NW"];
const frontRows = (def: SectionDef) => (def.tier === "lower" ? Math.ceil(def.rows / 2) : def.rows);

interface Sec {
  key: string;
  num: string;
  stand: SectionId;
  ring: 0 | 1 | 2 | 3;
  area: Area;
  d: string;
  rowsD: string;
  center: [number, number];
  rot: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  /** Drawn angular extent (inside the white gaps). */
  A0: number;
  A1: number;
}

function upright(deg: number): number {
  let r = ((deg % 360) + 360) % 360;
  if (r > 90 && r <= 270) r -= 180;
  if (r > 270) r -= 360;
  return r;
}

function makeSec(def: SectionDef, ring: Sec["ring"], i: number, rowFrom: number, rowTo: number, num: string): Sec {
  const k = SPLIT[def.id];
  const span = def.to - def.from;
  const a0 = def.from + (span * i) / k;
  const a1 = def.from + (span * (i + 1)) / k;
  const gap = def.id === "VIP" ? 0.2 : 0.45;
  const A0 = a0 + gap;
  const A1 = a1 - gap;
  const steps = Math.max(3, Math.ceil((A1 - A0) / 1.2));
  const back = ring === 2;
  const rIn = (a: number) => vr(def, a, rowFrom - 1, back);
  const rOut = (a: number) => vr(def, a, rowTo, back);
  const outer: [number, number][] = [];
  const inner: [number, number][] = [];
  for (let s = 0; s <= steps; s++) {
    const a = A0 + ((A1 - A0) * s) / steps;
    outer.push(polar(a, rOut(a)));
    inner.unshift(polar(a, rIn(a)));
  }
  const pts = [...outer, ...inner];
  const d = `M${pts.map(([x, y]) => `${r2(x)} ${r2(y)}`).join("L")}Z`;
  let rowsD = "";
  for (let r = rowFrom; r < rowTo; r++) {
    const line: string[] = [];
    for (let s = 0; s <= steps; s++) {
      const a = A0 + ((A1 - A0) * s) / steps;
      const [x, y] = polar(a, vr(def, a, r, back));
      line.push(`${r2(x)} ${r2(y)}`);
    }
    rowsD += `M${line.join("L")}`;
  }
  const mid = (a0 + a1) / 2;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const lowerArea: Area = def.id === "EL" || def.id === "WL" ? "sideline" : "endzone";
  return {
    key: `${def.id}|${ring}|${i}`,
    num,
    stand: def.id,
    ring,
    area: ring === 0 ? "premium" : ring === 3 ? "upper" : ring === 2 ? "club" : lowerArea,
    d,
    rowsD,
    center: polar(mid, (rIn(mid) + rOut(mid)) / 2),
    A0,
    A1,
    rot: upright(90 - mid),
    bbox: { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) },
  };
}

function buildSecs(): Sec[] {
  const out: Sec[] = [];
  for (const ring of [1, 2] as const) {
    let n = ring * 100 + 1;
    for (const id of LOWER_ORDER) {
      const def = DEF_BY_ID.get(id)!;
      const split = frontRows(def);
      for (let i = 0; i < SPLIT[id]; i++) out.push(makeSec(def, ring, i, ring === 1 ? 1 : split + 1, ring === 1 ? split : def.rows, String(n++)));
    }
  }
  let n = 301;
  for (const id of ["EU", "WU"] as const) {
    const def = DEF_BY_ID.get(id)!;
    for (let i = 0; i < SPLIT[id]; i++) out.push(makeSec(def, 3, i, 1, def.rows, String(n++)));
  }
  out.push(makeSec(VIP, 0, 0, 1, VIP.rows, "VIP"));
  return out;
}

const SECS = buildSecs();
const SEC_BY_KEY = new Map(SECS.map((s) => [s.key, s]));
// Draw order: lower rings, VIP, upper decks (they no longer overlap; kept for stable hover outlines).
const SEC_ORDER = [...SECS].sort((a, b) => [1, 2, 0, 3].indexOf(a.ring) - [1, 2, 0, 3].indexOf(b.ring));
const VENUE = SECS.reduce(
  (b, s) => ({ x0: Math.min(b.x0, s.bbox.x0), y0: Math.min(b.y0, s.bbox.y0), x1: Math.max(b.x1, s.bbox.x1), y1: Math.max(b.y1, s.bbox.y1) }),
  { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity },
);

/** The numbered section a seat belongs to. */
function secOf(stand: SectionId, slot: SeatSlot): Sec {
  const def = DEF_BY_ID.get(stand)!;
  const k = SPLIT[stand];
  const i = Math.min(k - 1, Math.max(0, Math.floor(((slot.theta - def.from) / (def.to - def.from)) * k)));
  const ring = def.tier === "upper" ? 3 : def.tier === "vip" ? 0 : slot.row <= frontRows(def) ? 1 : 2;
  return SEC_BY_KEY.get(`${stand}|${ring}|${i}`)!;
}

/** Every seat's drawn position: on the centre line of its row, evenly spaced across its section's arc. */
const SEAT_POS = (() => {
  const m = new Map<string, [number, number]>();
  for (const l of buildLayout()) {
    const groups = new Map<string, SeatSlot[]>();
    for (const slot of l.slots) {
      const k = `${secOf(l.def.id, slot).key}|${slot.row}`;
      const g = groups.get(k);
      if (g) g.push(slot);
      else groups.set(k, [slot]);
    }
    for (const g of groups.values()) {
      g.sort((a, b) => a.theta - b.theta);
      const sec = secOf(l.def.id, g[0]);
      const back = sec.ring === 2;
      g.forEach((slot, j) => {
        const t = sec.A0 + ((j + 0.5) / g.length) * (sec.A1 - sec.A0);
        m.set(`${l.def.id}|${slot.index}`, polar(t, vr(l.def, t, slot.row - 0.5, back)));
      });
    }
  }
  return m;
})();
function seatWorld(stand: SectionId, s: SeatSlot): [number, number] {
  return SEAT_POS.get(`${stand}|${s.index}`) ?? [0, 0];
}

/** The white concourse / bowl behind the lower ring. */
const BOWL_D = (() => {
  const outer: string[] = [];
  const inner: string[] = [];
  const EU = DEF_BY_ID.get("EU")!;
  const N = DEF_BY_ID.get("N")!;
  const upper = (a: number) => (a > 63 && a < 117) || (a > 243 && a < 297);
  for (let a = 0; a <= 360; a += 1) {
    const r = upper(a) ? vr(EU, a, EU.rows) + 1.4 : vr(N, a, N.rows, true) + 1.6;
    const [x, y] = polar(a, r);
    outer.push(`${r2(x)} ${r2(y)}`);
    const [ix, iy] = polar(-a, baseR(-a) - 0.5);
    inner.push(`${r2(ix)} ${r2(iy)}`);
  }
  return `M${outer.join("L")}ZM${inner.join("L")}Z`;
})();
/** The field / floor surround: everything inside the lower ring. */
const SURROUND_D = (() => {
  const pts: string[] = [];
  for (let a = 0; a < 360; a += 3) {
    const [x, y] = polar(a, baseR(a) - 0.5);
    pts.push(`${r2(x)} ${r2(y)}`);
  }
  return `M${pts.join("L")}Z`;
})();

// ---------------------------------------------------------------------------
// Listings
// ---------------------------------------------------------------------------

interface Listing {
  id: string;
  sec: Sec;
  stand: SectionId;
  row: number;
  /** Slot indices (same stand), cheapest first. */
  seats: number[];
  kind: SeatKind;
  price: number;
}

type Badge = "cheapest" | "deal" | "fast";

function buildListings(byId: Map<SectionId, { slots: SeatSlot[] }>, states: Map<SectionId, SeatState[]>): Listing[] {
  const out: Listing[] = [];
  for (const [stand, l] of byId) {
    const st = states.get(stand);
    if (!st) continue;
    const rows = new Map<number, SeatSlot[]>();
    for (const s of l.slots) rows.set(s.row, [...(rows.get(s.row) ?? []), s]);
    for (const [row, slots] of rows) {
      slots.sort((a, b) => a.seat - b.seat);
      let run: SeatSlot[] = [];
      const flush = () => {
        if (!run.length) return;
        const sec = secOf(stand, run[0]);
        const seats = run.map((s) => s.index).sort((a, b) => (st[a].priceUsd ?? 0) - (st[b].priceUsd ?? 0));
        out.push({ id: `${stand}-${row}-${run[0].seat}`, sec, stand, row, seats, kind: st[run[0].index].kind, price: st[seats[0]].priceUsd ?? 0 });
        run = [];
      };
      for (const s of slots) {
        const cur = st[s.index];
        const prev = run[run.length - 1];
        const ok = forSale(cur?.kind) && cur?.priceUsd != null;
        const joins = ok && prev && st[prev.index].kind === cur.kind && s.seat === prev.seat + 1 && secOf(stand, prev) === secOf(stand, s);
        if (!joins) flush();
        if (ok) run.push(s);
      }
      flush();
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface View {
  s: number;
  x: number;
  y: number;
}
interface SeatPoint {
  stand: SectionId;
  index: number;
  x: number;
  y: number;
  slot: SeatSlot;
  sec: Sec;
}
type SortBy = "price" | "best";

export function SeatMap({ event, listings, onDone }: { event: PickerEvent; listings: ChainListing[]; onDone: () => Promise<void> }) {
  const { byId, states, loadRecords } = useStadiumStates(event, listings);
  const { busy, buy } = useSeatBuy(event);
  const sports = event.category === "sports";

  // ---- Data ----
  const allListings = useMemo(() => buildListings(byId, states), [byId, states]);

  /** Section stats for badges: share of seats taken (selling fast). */
  const secTaken = useMemo(() => {
    const m = new Map<string, { taken: number; total: number }>();
    for (const [stand, l] of byId) {
      const st = states.get(stand);
      if (!st) continue;
      for (const s of l.slots) {
        const sec = secOf(stand, s);
        const v = m.get(sec.key) ?? { taken: 0, total: 0 };
        v.total++;
        if (st[s.index]?.kind === "taken") v.taken++;
        m.set(sec.key, v);
      }
    }
    return m;
  }, [byId, states]);

  const [qty, setQty] = useState<number | null>(null);
  const [qtyOpen, setQtyOpen] = useState(true);
  const [area, setArea] = useState<Area | "all">("all");
  const [instantOnly, setInstantOnly] = useState(false);
  const [maxPrice, setMaxPrice] = useState<number | null>(null);
  const [priceOpen, setPriceOpen] = useState(false);
  const [sortBy, setSortBy] = useState<SortBy>("price");

  const filtered = useMemo(() => {
    const list = allListings.filter(
      (l) =>
        (qty == null || l.seats.length >= Math.min(qty, 6)) &&
        (area === "all" || l.sec.area === area) &&
        (!instantOnly || l.kind !== "outside") &&
        (maxPrice == null || l.price <= maxPrice),
    );
    return list.sort((a, b) => (sortBy === "price" ? a.price - b.price || a.row - b.row : a.sec.ring - b.sec.ring || a.row - b.row || a.price - b.price));
  }, [allListings, qty, area, instantOnly, maxPrice, sortBy]);

  const badges = useMemo(() => {
    const m = new Map<string, Badge>();
    if (!filtered.length) return m;
    const cheapest = filtered.reduce((a, b) => (b.price < a.price ? b : a));
    m.set(cheapest.id, "cheapest");
    const official = event.priceUsd ?? event.priceFromUsd;
    // Best deal: the 4 cheapest resale / outside listings that sit below the official price.
    [...filtered]
      .filter((l) => l.kind !== "available" && l.price < official)
      .sort((a, b) => a.price - b.price)
      .slice(0, 4)
      .forEach((l) => !m.has(l.id) && m.set(l.id, "deal"));
    for (const l of filtered) {
      const t = secTaken.get(l.sec.key);
      if (!m.has(l.id) && t && t.total > 0 && t.taken / t.total >= 0.82) m.set(l.id, "fast");
    }
    return m;
  }, [filtered, secTaken, event.priceUsd, event.priceFromUsd]);

  /** One pin per section: its cheapest filtered listing. Cheapest first = collision priority. */
  const pins = useMemo(() => {
    const best = new Map<string, Listing>();
    for (const l of filtered) {
      const cur = best.get(l.sec.key);
      if (!cur || l.price < cur.price) best.set(l.sec.key, l);
    }
    return [...best.values()].sort((a, b) => a.price - b.price);
  }, [filtered]);
  const secBadge = useMemo(() => {
    const m = new Map<string, Badge>();
    for (const l of filtered) {
      const b = badges.get(l.id);
      if (b && !m.has(l.sec.key)) m.set(l.sec.key, b);
    }
    return m;
  }, [filtered, badges]);

  const fromForQty = useMemo(
    () =>
      [1, 2, 3, 4, 5, 6].map((n) => {
        const ok = allListings.filter((l) => l.seats.length >= n);
        return ok.length ? Math.min(...ok.map((l) => l.price)) : null;
      }),
    [allListings],
  );
  const priceSteps = useMemo(() => {
    const ps = [...new Set(allListings.map((l) => l.price))].sort((a, b) => a - b);
    if (ps.length < 4) return [];
    return [...new Set([0.25, 0.5, 0.75].map((q) => ps[Math.floor(q * (ps.length - 1))]))];
  }, [allListings]);

  // ---- Selection & hover ----
  const [selected, setSelected] = useState<SeatPick | null>(null);
  const [hoverSec, setHoverSec] = useState<string | null>(null);
  const selSt = selected ? states.get(selected.section)?.[selected.index] : undefined;
  const selSlot = selected ? (byId.get(selected.section)?.slots[selected.index] ?? null) : null;
  const selSec = selected && selSlot ? secOf(selected.section, selSlot) : null;
  const selListing = selected ? allListings.find((l) => l.stand === selected.section && l.seats.includes(selected.index)) : undefined;
  const vip = selected?.section === "VIP";

  const onBuy = async () => {
    if (!selSt || !selSlot) return;
    const okBuy = await buy(selSlot, selSt);
    if (okBuy) {
      await onDone();
      await loadRecords();
      setSelected(null);
    }
  };

  // ---- Seat positions (canvas + hit-testing) ----
  const seats = useMemo(() => {
    const out: SeatPoint[] = [];
    for (const [stand, l] of byId) {
      for (const s of l.slots) {
        const [x, y] = seatWorld(stand, s);
        out.push({ stand, index: s.index, x, y, slot: s, sec: secOf(stand, s) });
      }
    }
    return out;
  }, [byId]);

  // ---- View (pan / zoom), applied imperatively each frame ----
  const boxRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const worldRef = useRef<SVGGElement>(null);
  const labelSvgRef = useRef<SVGSVGElement>(null);
  const labelsRef = useRef<SVGGElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pinEls = useRef(new Map<string, HTMLElement>());
  const tipRef = useRef<HTMLDivElement>(null);
  const tipText = useRef<HTMLSpanElement>(null);
  const view = useRef<View>({ s: 3, x: 0, y: 0 });
  const size = useRef({ w: 0, h: 0 });
  const touched = useRef(false);
  const hover = useRef<SeatPoint | null>(null);
  const [atMin, setAtMin] = useState(true);
  const atMinRef = useRef(true);
  const raf = useRef(0);
  const anim = useRef(0);

  const live = useRef({ seats, states, byId, selected, filtered, hoverSec, selSecKey: selSec?.key ?? null });
  useLayoutEffect(() => {
    live.current = { seats, states, byId, selected, filtered, hoverSec, selSecKey: selSec?.key ?? null };
  });

  const fitView = useCallback((): View => {
    const { w, h } = size.current;
    const bw = VENUE.x1 - VENUE.x0;
    const bh = VENUE.y1 - VENUE.y0;
    const s = Math.max(0.5, Math.min((w - PAD * 2) / bw, (h - PAD * 2 - 24) / bh));
    return { s, x: w / 2 - ((VENUE.x0 + VENUE.x1) / 2) * s, y: h / 2 + 12 - ((VENUE.y0 + VENUE.y1) / 2) * s };
  }, []);

  const draw = useCallback(() => {
    const c = canvasRef.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    const { w, h } = size.current;
    const v = view.current;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (v.s < STRIP_PX_PER_M) return;
    const { seats: all, states: st, byId: layout, selected: picked, filtered: fl, hoverSec: hs } = live.current;
    const P = (x: number, y: number) => [v.x + x * v.s, v.y + y * v.s] as const;

    if (v.s < DOTS_PX_PER_M) {
      // Mid zoom: each listing as a strip along its row.
      ctx.lineCap = "round";
      ctx.lineWidth = Math.max(2.5, v.s * 0.5);
      for (const l of fl) {
        const slots = layout.get(l.stand)?.slots;
        if (!slots) continue;
        const pts = l.seats.map((i) => seatWorld(l.stand, slots[i])).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
        ctx.strokeStyle = l.kind === "outside" ? "#d9a400" : KIND_COLOR[l.kind];
        ctx.globalAlpha = hs && l.sec.key !== hs ? 0.45 : 1;
        ctx.beginPath();
        const [x0, y0] = P(pts[0][0], pts[0][1]);
        ctx.moveTo(x0, y0);
        if (pts.length === 1) ctx.lineTo(x0 + 0.5, y0);
        for (const [x, y] of pts.slice(1)) {
          const [X, Y] = P(x, y);
          ctx.lineTo(X, Y);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      return;
    }

    // Deep zoom: every seat as a dot.
    const r = Math.min(3.6, Math.max(1.5, v.s * 0.16));
    const groups = new Map<string, number[]>();
    for (const p of all) {
      const [X, Y] = P(p.x, p.y);
      if (X < -6 || Y < -6 || X > w + 6 || Y > h + 6) continue;
      const k = st.get(p.stand)?.[p.index]?.kind ?? "off";
      const key = forSale(k) ? k : "dim";
      const g = groups.get(key);
      if (g) g.push(X, Y);
      else groups.set(key, [X, Y]);
    }
    const paint = (key: string, color: string, alpha: number, radius: number) => {
      const pts = groups.get(key);
      if (!pts) return;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      ctx.beginPath();
      for (let i = 0; i < pts.length; i += 2) {
        ctx.moveTo(pts[i] + radius, pts[i + 1]);
        ctx.arc(pts[i], pts[i + 1], radius, 0, Math.PI * 2);
      }
      ctx.fill();
    };
    paint("dim", "#8b93a6", 0.35, r * 0.8);
    paint("available", KIND_COLOR.available, 1, r);
    paint("resale", KIND_COLOR.resale, 1, r);
    paint("outside", "#d9a400", 1, r); // a touch darker yellow so it reads on the light map
    ctx.globalAlpha = 1;
    const hv = hover.current;
    if (hv) {
      const [X, Y] = P(hv.x, hv.y);
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#fe1c80";
      ctx.beginPath();
      ctx.arc(X, Y, r * 2 + 1.5, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (picked) {
      const p = all.find((q) => q.stand === picked.section && q.index === picked.index);
      if (p) {
        const [X, Y] = P(p.x, p.y);
        ctx.shadowColor = "#e85002";
        ctx.shadowBlur = 12;
        ctx.lineWidth = 3;
        ctx.strokeStyle = "#e85002";
        ctx.beginPath();
        ctx.arc(X, Y, r * 2.2 + 2.5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.shadowBlur = 0;
      }
    }
  }, []);

  const apply = useCallback(() => {
    raf.current = 0;
    const v = view.current;
    const t = `translate(${v.x} ${v.y}) scale(${v.s})`;
    worldRef.current?.setAttribute("transform", t);
    labelsRef.current?.setAttribute("transform", t);
    for (const svg of [svgRef.current, labelSvgRef.current]) {
      svg?.style.setProperty("--inv", String(1 / v.s));
      svg?.style.setProperty("--s", String(v.s));
    }
    const { w, h } = size.current;
    // Pins: greedy collision detection (selected / hovered first, then cheapest); hide the rest.
    const placed: { l: number; t: number; r: number; b: number }[] = [];
    const { hoverSec: hs, selSecKey } = live.current;
    const prio = (el: HTMLElement) => (el.dataset.sec === selSecKey ? -2 : el.dataset.sec === hs ? -1 : Number(el.dataset.rank));
    const ordered = [...pinEls.current.values()].sort((p, q) => prio(p) - prio(q));
    for (const el of ordered) {
      const X = v.x + Number(el.dataset.wx) * v.s;
      const Y = v.y + Number(el.dataset.wy) * v.s;
      const pw = Number(el.dataset.pw) || 64;
      const ph = Number(el.dataset.ph) || 30;
      const box = { l: X - pw / 2 - 2, t: Y - ph - 2, r: X + pw / 2 + 2, b: Y + 1 };
      const inside = box.l >= 0 && box.t >= 0 && box.r <= w && box.b <= h;
      const clash = placed.some((q) => box.l < q.r && box.r > q.l && box.t < q.b && box.b > q.t);
      const show = inside && !clash;
      if (show) placed.push(box);
      el.style.display = show ? "" : "none";
      el.style.transform = `translate(${X}px, ${Y}px)`;
    }
    const tip = tipRef.current;
    const hv = hover.current;
    if (tip) {
      if (hv && v.s >= DOTS_PX_PER_M) {
        tip.style.display = "";
        tip.style.transform = `translate(${v.x + hv.x * v.s}px, ${v.y + hv.y * v.s}px)`;
      } else tip.style.display = "none";
    }
    draw();
    const m = v.s <= fitView().s * 0.82;
    if (m !== atMinRef.current) {
      atMinRef.current = m;
      setAtMin(m);
    }
  }, [draw, fitView]);

  const schedule = useCallback(() => {
    if (!raf.current) raf.current = requestAnimationFrame(apply);
  }, [apply]);

  const clampScale = useCallback((s: number) => Math.min(MAX_PX_PER_M, Math.max(fitView().s * 0.8, s)), [fitView]);

  const animateTo = useCallback(
    (to: View, ms = 480) => {
      cancelAnimationFrame(anim.current);
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || ms <= 0) {
        view.current = to;
        schedule();
        return;
      }
      const from = { ...view.current };
      const t0 = performance.now();
      const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
      const step = (now: number) => {
        const t = Math.min(1, (now - t0) / ms);
        const k = ease(t);
        const s = Math.exp(Math.log(from.s) + (Math.log(to.s) - Math.log(from.s)) * k);
        const { w, h } = size.current;
        const cx0 = (w / 2 - from.x) / from.s;
        const cy0 = (h / 2 - from.y) / from.s;
        const cx = cx0 + ((w / 2 - to.x) / to.s - cx0) * k;
        const cy = cy0 + ((h / 2 - to.y) / to.s - cy0) * k;
        view.current = { s, x: w / 2 - cx * s, y: h / 2 - cy * s };
        apply();
        if (t < 1) anim.current = requestAnimationFrame(step);
      };
      anim.current = requestAnimationFrame(step);
    },
    [apply, schedule],
  );

  const zoomToSec = useCallback(
    (sec: Sec, deep = true) => {
      touched.current = true;
      const { w, h } = size.current;
      const bw = sec.bbox.x1 - sec.bbox.x0;
      const bh = sec.bbox.y1 - sec.bbox.y0;
      const want = Math.min((w - 120) / bw, (h - 120) / bh);
      // Deep enough for seat dots, but keep the neighbours in view so the curve of the rows reads.
      const s = Math.min(MAX_PX_PER_M, Math.max(deep ? DOTS_PX_PER_M * 1.3 : STRIP_PX_PER_M * 1.3, Math.min(want * 0.45, DOTS_PX_PER_M * 1.8)));
      const cx = (sec.bbox.x0 + sec.bbox.x1) / 2;
      const cy = (sec.bbox.y0 + sec.bbox.y1) / 2;
      animateTo({ s, x: w / 2 - cx * s, y: h / 2 - cy * s });
    },
    [animateTo],
  );

  const zoomedBy = useCallback(
    (factor: number, at?: { x: number; y: number }): View => {
      touched.current = true;
      const { w, h } = size.current;
      const p = at ?? { x: w / 2, y: h / 2 };
      const v = view.current;
      const s = clampScale(v.s * factor);
      return { s, x: p.x - ((p.x - v.x) / v.s) * s, y: p.y - ((p.y - v.y) / v.s) * s };
    },
    [clampScale],
  );

  const reset = useCallback(() => {
    touched.current = false;
    animateTo(fitView());
  }, [animateTo, fitView]);

  useLayoutEffect(() => {
    const box = boxRef.current;
    const c = canvasRef.current;
    if (!box || !c) return;
    const ro = new ResizeObserver(() => {
      size.current = { w: box.clientWidth, h: box.clientHeight };
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      c.width = Math.round(size.current.w * dpr);
      c.height = Math.round(size.current.h * dpr);
      if (!touched.current) view.current = fitView();
      apply();
    });
    ro.observe(box);
    return () => ro.disconnect();
  }, [apply, fitView]);

  useEffect(() => {
    schedule();
  }, [seats, states, selected, filtered, hoverSec, pins, schedule]);

  // ---- Selecting ----
  const selectListing = useCallback(
    (l: Listing) => {
      setSelected({ section: l.stand, index: l.seats[0] });
      zoomToSec(l.sec);
    },
    [zoomToSec],
  );
  const toVip = () => {
    const l = byId.get("VIP");
    if (!l) return;
    const best = l.slots.find((s) => s.row === 2 && s.seat === 5) ?? l.slots[0];
    setSelected({ section: "VIP", index: best.index });
    zoomToSec(SEC_BY_KEY.get("VIP|0|0")!);
  };

  // ---- Input ----
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ moved: boolean; x0: number; y0: number; pinch?: { d: number; view: View; mid: { x: number; y: number } } }>({ moved: false, x0: 0, y0: 0 });
  const local = (e: { clientX: number; clientY: number }) => {
    const r = boxRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const hitSeat = useCallback((p: { x: number; y: number }): SeatPoint | null => {
    const v = view.current;
    if (v.s < DOTS_PX_PER_M) return null;
    const wx = (p.x - v.x) / v.s;
    const wy = (p.y - v.y) / v.s;
    const maxD = Math.max(0.4, 7 / v.s);
    let best: SeatPoint | null = null;
    let bestD = maxD * maxD;
    for (const q of live.current.seats) {
      const d = (q.x - wx) ** 2 + (q.y - wy) ** 2;
      if (d < bestD) {
        bestD = d;
        best = q;
      }
    }
    return best;
  }, []);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      cancelAnimationFrame(anim.current);
      view.current = zoomedBy(Math.exp(-e.deltaY * 0.0015), local(e));
      schedule();
    };
    box.addEventListener("wheel", onWheel, { passive: false });
    return () => box.removeEventListener("wheel", onWheel);
  }, [zoomedBy, schedule]);

  const setHoverSeat = (h: SeatPoint | null) => {
    if (h === hover.current) return;
    hover.current = h;
    const st = h ? live.current.states.get(h.stand)?.[h.index] : undefined;
    if (tipText.current && h)
      tipText.current.textContent = `Sec ${h.sec.num} · Row ${h.slot.row} · Seat ${h.slot.seat} · ${forSale(st?.kind) && st?.priceUsd != null ? usd(st.priceUsd) : st?.kind === "taken" ? "Taken" : "Not for sale"}`;
    if (boxRef.current) boxRef.current.style.cursor = h && forSale(st?.kind) ? "pointer" : "";
    schedule();
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("[data-ui]")) return;
    cancelAnimationFrame(anim.current);
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    if (pointers.current.size === 1) gesture.current = { moved: false, x0: p.x, y0: p.y };
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), view: { ...view.current }, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
      gesture.current.moved = true;
    }
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = local(e);
    const prev = pointers.current.get(e.pointerId);
    if (!prev) {
      if (e.pointerType === "mouse") {
        setHoverSeat(hitSeat(p));
        const zone = (e.target as Element).closest?.("[data-sec]")?.getAttribute("data-sec") ?? null;
        if (zone !== live.current.hoverSec) setHoverSec(zone);
      }
      return;
    }
    pointers.current.set(e.pointerId, p);
    const g = gesture.current;
    if (g.pinch && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const v0 = g.pinch.view;
      const s = clampScale(v0.s * (Math.hypot(a.x - b.x, a.y - b.y) / g.pinch.d));
      view.current = { s, x: mid.x - ((g.pinch.mid.x - v0.x) / v0.s) * s, y: mid.y - ((g.pinch.mid.y - v0.y) / v0.s) * s };
      touched.current = true;
      schedule();
      return;
    }
    if (!g.moved && Math.hypot(p.x - g.x0, p.y - g.y0) > 4) g.moved = true;
    if (g.moved) {
      view.current = { ...view.current, x: view.current.x + (p.x - prev.x), y: view.current.y + (p.y - prev.y) };
      touched.current = true;
      schedule();
    }
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const had = pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) gesture.current.pinch = undefined;
    if (!had || gesture.current.moved || pointers.current.size > 0) return;
    const seat = hitSeat(local(e));
    const st = seat ? live.current.states.get(seat.stand)?.[seat.index] : undefined;
    if (seat && forSale(st?.kind)) {
      setSelected({ section: seat.stand, index: seat.index });
      return;
    }
    const key = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-sec]")?.getAttribute("data-sec");
    const sec = key ? SEC_BY_KEY.get(key) : undefined;
    if (sec) zoomToSec(sec, false);
  };

  // ---- Render ----
  const hoverSecObj = hoverSec ? SEC_BY_KEY.get(hoverSec) : undefined;
  const tabsRef = useRef<HTMLDivElement>(null);
  const qtyLabel = qty == null ? "Quantity" : `${qty === 6 ? "6+" : qty} ticket${qty === 1 ? "" : "s"}`;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(340px,410px)_1fr]">
      {/* ---------------- Left: filters + listings (or the selected listing) ---------------- */}
      <div className="order-2 flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-card lg:order-1 lg:h-[700px]">
        {selected && selSlot ? (
          <div className="scrollbar-slim flex min-h-0 flex-1 flex-col overflow-y-auto">
            <div className="flex items-center gap-2 border-b border-border p-3">
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="flex size-9 items-center justify-center rounded-full border border-border hover:bg-secondary active:scale-95"
                aria-label="Back to all listings"
              >
                <ArrowLeft className="size-4" />
              </button>
              <span className="text-sm text-muted-foreground">All listings</span>
            </div>
            <div className="space-y-4 p-4">
              <div className="overflow-hidden rounded-xl border border-border bg-[#eceef3]">
                <SecThumb sec={selSec} wide sports={sports} className="h-40 w-full" />
              </div>
              <div>
                <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="size-2 rounded-full" style={{ background: selSec ? AREA[selSec.area].swatch : "#999999" }} />
                  {selSec ? AREA[selSec.area].label : ""}
                  {selListing && badges.get(selListing.id) && <BadgeChip badge={badges.get(selListing.id)!} />}
                </p>
                <h3 className="mt-1 text-2xl font-bold tracking-tight">{vip ? "VIP suites" : `Section ${selSec?.num}, Row ${selSlot.row}`}</h3>
                {selSt && forSale(selSt.kind) && (
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    <span className="font-mono text-base font-bold text-foreground">{usd(selSt.priceUsd ?? 0)}</span> each ·{" "}
                    {selListing ? `${selListing.seats.length} together in this row` : `Seat ${selSlot.seat}`}
                  </p>
                )}
              </div>
              <TicketCard
                event={event}
                slot={selSlot}
                st={selSt}
                vip={vip}
                busy={busy}
                onBuy={() => void onBuy()}
                onAnother={() => setSelected(null)}
                onVip={toVip}
                showThumbnail={false}
                thumbnail={null}
              />
              <ul className="space-y-3 rounded-xl border border-border p-4 text-sm">
                <li className="flex gap-3">
                  <ShieldCheck className="mt-0.5 size-4 shrink-0 text-accent-pink" />
                  <span>
                    <b>Payment-protected.</b> <span className="text-muted-foreground">Your money only moves when your ticket does.</span>
                  </span>
                </li>
                {selSt?.kind !== "outside" && (
                  <li className="flex gap-3">
                    <Zap className="mt-0.5 size-4 shrink-0 text-primary" />
                    <span>
                      <b>Instant delivery.</b> <span className="text-muted-foreground">The ticket lands in My tickets in the same transaction.</span>
                    </span>
                  </li>
                )}
              </ul>
            </div>
          </div>
        ) : (
          <>
            {/* Filter chips */}
            <div className="flex items-center gap-2 border-b border-border p-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground" aria-hidden>
                <SlidersHorizontal className="size-4" />
              </span>
              <div className="no-scrollbar flex min-w-0 flex-1 gap-2 overflow-x-auto">
                <Chip active={qty != null} onClick={() => setQtyOpen(true)}>
                  {qtyLabel}
                </Chip>
                <Chip active={maxPrice != null} onClick={() => setPriceOpen((o) => !o)}>
                  {maxPrice != null ? `Under ${usd(maxPrice)}` : "Price"} <ChevronDown className="size-3.5" />
                </Chip>
                <Chip active={instantOnly} onClick={() => setInstantOnly((v) => !v)}>
                  <Zap className="size-3.5" /> Instant delivery
                </Chip>
              </div>
            </div>
            {priceOpen && (
              <div className="flex flex-wrap gap-2 border-b border-border bg-background/40 p-3">
                {[null, ...priceSteps].map((p) => (
                  <button
                    key={String(p)}
                    type="button"
                    onClick={() => {
                      setMaxPrice(p);
                      setPriceOpen(false);
                    }}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs font-semibold",
                      maxPrice === p ? "border-accent-pink bg-accent-pink text-black" : "border-border hover:bg-secondary",
                    )}
                  >
                    {p == null ? "Any price" : `Under ${usd(p)}`}
                  </button>
                ))}
              </div>
            )}
            {/* Area tabs (scrollable, with arrows) */}
            <div className="flex items-center border-b border-border">
            <div ref={tabsRef} className="no-scrollbar flex min-w-0 flex-1 gap-5 overflow-x-auto scroll-smooth px-4" role="tablist" aria-label="Venue areas">
              {(["all", ...AREA_ORDER] as const).map((a) => (
                <button
                  key={a}
                  type="button"
                  role="tab"
                  aria-selected={area === a}
                  onClick={() => setArea(a)}
                  className={cn(
                    "shrink-0 border-b-2 py-3 text-sm font-semibold whitespace-nowrap transition-colors",
                    area === a ? "border-accent-pink text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  {a === "all" ? "All areas" : AREA[a].label}
                </button>
              ))}
            </div>
              <div className="flex shrink-0 items-center gap-0.5 pr-2">
                {([-1, 1] as const).map((dir) => (
                  <button
                    key={dir}
                    type="button"
                    aria-label={dir < 0 ? "Scroll areas left" : "Scroll areas right"}
                    onClick={() => tabsRef.current?.scrollBy({ left: dir * 160 })}
                    className="flex size-8 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground active:scale-90"
                  >
                    {dir < 0 ? <ChevronLeft className="size-4" /> : <ChevronRight className="size-4" />}
                  </button>
                ))}
              </div>
            </div>
            {/* Count + sort */}
            <div className="flex items-center justify-between px-4 py-3">
              <p className="text-sm font-semibold">
                <span className="font-mono">{filtered.length}</span> listings
                <span className="ml-1 font-normal text-muted-foreground">· payment-protected</span>
              </p>
              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                Sort
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as SortBy)}
                  className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
                >
                  <option value="price">Lowest price</option>
                  <option value="best">Best seats</option>
                </select>
              </label>
            </div>
            {/* Listings */}
            <div className="scrollbar-slim min-h-0 flex-1 overflow-y-auto px-2 pb-2 max-lg:max-h-[560px]">
              {filtered.length === 0 ? (
                <div className="m-2 rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                  No listings match these filters.
                  <button
                    type="button"
                    className="mt-2 block w-full font-semibold text-accent-pink"
                    onClick={() => {
                      setArea("all");
                      setInstantOnly(false);
                      setMaxPrice(null);
                      setQty(null);
                    }}
                  >
                    Clear filters
                  </button>
                </div>
              ) : (
                <ul>
                  {filtered.slice(0, 250).map((l) => (
                    <ListingRow
                      key={l.id}
                      l={l}
                      badge={badges.get(l.id)}
                      highlighted={hoverSec === l.sec.key}
                      sports={sports}
                      onHover={(on) => setHoverSec(on ? l.sec.key : null)}
                      onSelect={() => selectListing(l)}
                    />
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </div>

      {/* ---------------- Right: the map ---------------- */}
      <div
        ref={boxRef}
        className="relative order-1 h-[400px] w-full touch-none overflow-hidden rounded-2xl border border-border bg-[#eceef3] select-none sm:h-[520px] lg:order-2 lg:h-[700px]"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => {
          setHoverSeat(null);
          setHoverSec(null);
        }}
      >
        <svg ref={svgRef} className="absolute inset-0 size-full" style={{ ["--inv" as string]: 0.3, ["--s" as string]: 3 }}>
          <g ref={worldRef}>
            <path d={BOWL_D} fill="#ffffff" fillRule="evenodd" stroke="#d3d8e2" strokeWidth={1.2} vectorEffect="non-scaling-stroke" />
            {sports ? <SportsField /> : <StageFloor />}
            {SEC_ORDER.map((s) => (
              <g key={s.key} data-sec={s.key}>
                <path d={s.d} fill={AREA[s.area].fill} stroke="#ffffff" strokeWidth={1.4} vectorEffect="non-scaling-stroke" className="cursor-pointer" />
                <path
                  d={s.rowsD}
                  fill="none"
                  stroke="rgb(40 50 70 / 0.09)"
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                  className="pointer-events-none"
                  style={{ opacity: "clamp(0, calc((var(--s) - 3.2) / 3), 1)" }}
                />
              </g>
            ))}
            {/* Hovered / selected section outline */}
            {hoverSecObj && (
              <path d={hoverSecObj.d} fill="rgb(254 28 128 / 0.12)" stroke="#fe1c80" strokeWidth={2.2} vectorEffect="non-scaling-stroke" className="pointer-events-none" />
            )}
            {selSec && <path d={selSec.d} fill="rgb(232 80 2 / 0.12)" stroke="#e85002" strokeWidth={2.6} vectorEffect="non-scaling-stroke" className="pointer-events-none" />}
          </g>
        </svg>

        <canvas ref={canvasRef} aria-hidden className="pointer-events-none absolute inset-0 size-full" />

        {/* Section numbers, rotated along the ring, above the dots */}
        <svg ref={labelSvgRef} aria-hidden className="pointer-events-none absolute inset-0 size-full" style={{ ["--inv" as string]: 0.3, ["--s" as string]: 3 }}>
          <g ref={labelsRef}>
            {SECS.map((s) => (
              <text
                key={s.key}
                transform={`translate(${s.center[0]} ${s.center[1]}) rotate(${s.rot})`}
                textAnchor="middle"
                dominantBaseline="central"
                fill="rgb(70 78 98 / 0.85)"
                className="font-mono font-semibold"
                style={{ fontSize: "calc(clamp(6px, 2.3px * var(--s), 13px) * var(--inv))" }}
              >
                {s.num}
              </text>
            ))}
          </g>
        </svg>

        {/* Price pins: one per section (cheapest listing), collision-checked */}
        {pins.map((l, rank) => {
          const b = secBadge.get(l.sec.key);
          const active = hoverSec === l.sec.key || selSec?.key === l.sec.key;
          return (
            <button
              key={l.sec.key}
              type="button"
              data-ui
              data-sec={l.sec.key}
              data-wx={l.sec.center[0]}
              data-wy={l.sec.center[1]}
              data-rank={rank}
              ref={(el) => {
                if (el) {
                  pinEls.current.set(l.sec.key, el);
                  if (!el.dataset.pw) {
                    el.dataset.pw = String(el.offsetWidth);
                    el.dataset.ph = String(el.offsetHeight);
                  }
                } else pinEls.current.delete(l.sec.key);
              }}
              onMouseEnter={() => setHoverSec(l.sec.key)}
              onMouseLeave={() => setHoverSec(null)}
              onClick={() => selectListing(l)}
              className="absolute top-0 left-0 z-10 -translate-x-1/2 -translate-y-full pb-3 active:scale-95"
              aria-label={`Section ${l.sec.num}: from ${usd(l.price)}`}
            >
              <span
                className={cn(
                  "relative flex items-center gap-1 rounded-full py-[3px] pr-2 pl-1.5 font-mono text-[12px] font-bold whitespace-nowrap shadow-[0_3px_10px_-2px_rgb(20_30_50/0.35)] ring-1 transition-colors",
                  active ? "bg-[#111111] text-white ring-black" : "bg-white text-[#111111] ring-black/10",
                )}
              >
                {b === "cheapest" ? (
                  <Banknote className="size-3.5 text-[#1f9d63]" />
                ) : b === "deal" ? (
                  <Tag className="size-3.5 text-[#1f9d63]" />
                ) : b === "fast" ? (
                  <Flame className="size-3.5 text-[#f05a12]" />
                ) : (
                  <span className="mx-0.5 size-2 rounded-full ring-2 ring-black/10" style={{ background: l.kind === "outside" ? "#d9a400" : KIND_COLOR[l.kind] }} />
                )}
                {usd(l.price)}
                <span aria-hidden className={cn("absolute -bottom-1 left-1/2 size-2 -translate-x-1/2 rotate-45", active ? "bg-[#111111]" : "bg-white")} />
              </span>
            </button>
          );
        })}

        {/* Seat tooltip */}
        <div ref={tipRef} className="pointer-events-none absolute top-0 left-0 z-20" style={{ display: "none" }}>
          <div className="-translate-x-1/2 -translate-y-[calc(100%+12px)] rounded-lg bg-[#111111] px-2.5 py-1 font-mono text-xs whitespace-nowrap text-white shadow-lg">
            <span ref={tipText} />
          </div>
        </div>

        {/* Controls */}
        <div data-ui className="absolute top-3 right-3 z-30 flex flex-col gap-2">
          <div className="flex flex-col overflow-hidden rounded-full bg-white text-[#111111] shadow-[0_4px_14px_-4px_rgb(20_30_50/0.35)] ring-1 ring-black/5">
            <MapButton label="Zoom in" onClick={() => animateTo(zoomedBy(1.6), 220)}>
              <Plus className="size-4" />
            </MapButton>
            <span className="mx-2 h-px bg-black/10" />
            <MapButton label="Zoom out" onClick={() => animateTo(zoomedBy(1 / 1.6), 220)} disabled={atMin}>
              <Minus className="size-4" />
            </MapButton>
          </div>
          {!atMin && (
            <div className="overflow-hidden rounded-full bg-white text-[#111111] shadow-[0_4px_14px_-4px_rgb(20_30_50/0.35)] ring-1 ring-black/5">
              <MapButton label="Reset view" onClick={reset}>
                <RotateCcw className="size-4" />
              </MapButton>
            </div>
          )}
        </div>
        <AreasLegend />
      </div>

      {/* ---------------- "How many tickets?" ---------------- */}
      {qtyOpen && (
        <QuantityDialog
          from={fromForQty}
          current={qty}
          onPick={(n) => {
            setQty(n);
            setQtyOpen(false);
          }}
          onClose={() => setQtyOpen(false)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function Chip({ active, onClick, children }: { active?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold whitespace-nowrap transition active:scale-95",
        active ? "border-foreground bg-foreground text-background" : "border-border hover:bg-secondary",
      )}
    >
      {children}
    </button>
  );
}

function BadgeChip({ badge }: { badge: Badge }) {
  if (badge === "cheapest")
    return (
      <span className="inline-flex items-center gap-1 font-semibold text-[#3ccf8e]">
        <Banknote className="size-3.5" /> Cheapest
      </span>
    );
  if (badge === "deal")
    return (
      <span className="inline-flex items-center gap-1 font-semibold text-accent-pink">
        <Tag className="size-3.5" /> Best deal
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 font-semibold text-primary">
      <Flame className="size-3.5" /> Selling fast
    </span>
  );
}

function ListingRow({
  l,
  badge,
  highlighted,
  sports,
  onHover,
  onSelect,
}: {
  l: Listing;
  badge?: Badge;
  highlighted: boolean;
  sports: boolean;
  onHover: (on: boolean) => void;
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onMouseEnter={() => onHover(true)}
        onMouseLeave={() => onHover(false)}
        onFocus={() => onHover(true)}
        onBlur={() => onHover(false)}
        onClick={onSelect}
        className={cn(
          "flex w-full items-center gap-3 rounded-xl p-2 text-left transition-colors active:scale-[0.99]",
          highlighted ? "bg-accent-pink/12 ring-1 ring-accent-pink/50" : "hover:bg-secondary",
        )}
      >
        <div className="size-16 shrink-0 overflow-hidden rounded-lg bg-[#eceef3]">
          <SecThumb sec={l.sec} sports={sports} className="size-full" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">Section {l.sec.num}</p>
          <p className="flex items-center gap-1 text-sm text-muted-foreground">
            Row {l.row}, {l.seats.length} ticket{l.seats.length === 1 ? "" : "s"}
            {l.kind !== "outside" && <Zap className="size-3.5 text-muted-foreground" aria-label="Instant delivery" />}
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <span className="inline-flex items-center gap-1 rounded-md bg-secondary px-1.5 py-0.5 font-medium">
              <span className="size-1.5 rounded-full" style={{ background: KIND_COLOR[l.kind] }} />
              {l.kind === "available" ? "Official" : l.kind === "resale" ? "Resale" : "Outside · escrow"}
            </span>
            {badge && <BadgeChip badge={badge} />}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-mono text-lg font-bold">{usd(l.price)}</p>
          <p className="text-[11px] text-muted-foreground">each</p>
        </div>
      </button>
    </li>
  );
}

/** Tiny venue plan with one section highlighted (listing thumbnails, the selected listing). */
function SecThumb({ sec, className, wide = false, sports = true }: { sec: Sec | null; className?: string; wide?: boolean; sports?: boolean }) {
  // Cropped around the section (the field edge and its ring for orientation); `wide` = the whole venue.
  const vb =
    sec && !wide
      ? `${sec.center[0] - 34} ${sec.center[1] - 34} 68 68`
      : `${VENUE.x0 - 3} ${VENUE.y0 - 3} ${VENUE.x1 - VENUE.x0 + 6} ${VENUE.y1 - VENUE.y0 + 6}`;
  return (
    <svg viewBox={vb} preserveAspectRatio="xMidYMid slice" className={className} aria-hidden>
      <path d={BOWL_D} fill="#ffffff" fillRule="evenodd" />
      <path d={SURROUND_D} fill={sports ? "#9dbb6a" : "#d5dae3"} />
      {wide && SECS.map((x) => <path key={x.key} d={x.d} fill={AREA[x.area].fill} stroke="#ffffff" strokeWidth={0.5} />)}
      {sec && <path d={sec.d} fill="#e85002" stroke="#ffffff" strokeWidth={0.6} />}
    </svg>
  );
}

function MapButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-10 items-center justify-center transition hover:bg-black/5 active:scale-90 disabled:opacity-30"
    >
      {children}
    </button>
  );
}

/** Detailed sports field: stripes, markings, HOME / AWAY. World metres; the pitch is 105 × 68. */
function SportsField() {
  const line = { stroke: "rgb(255 255 255 / 0.85)", strokeWidth: 1.1, vectorEffect: "non-scaling-stroke" as const, fill: "none" };
  return (
    <g className="pointer-events-none">
      <path d={SURROUND_D} fill="#5d7f34" />
      <g transform={`scale(${FIELD_K * 0.95})`}>
      {Array.from({ length: 12 }, (_, i) => (
        <rect key={i} x={-52.5 + i * 8.75} y={-34} width={8.75} height={68} fill={i % 2 ? "#6f9440" : "#78a047"} />
      ))}
      <rect x={-52.5} y={-34} width={105} height={68} {...line} />
      <line x1={0} y1={-34} x2={0} y2={34} {...line} />
      <circle cx={0} cy={0} r={9.15} {...line} />
      <circle cx={0} cy={0} r={0.5} fill="#ffffff" />
      {[-1, 1].map((side) => (
        <g key={side} transform={`scale(${side} 1)`}>
          <rect x={-52.5} y={-20.16} width={16.5} height={40.32} {...line} />
          <rect x={-52.5} y={-9.16} width={5.5} height={18.32} {...line} />
          <circle cx={-41.5} cy={0} r={0.45} fill="#ffffff" />
          <path d="M -36 -7.3 A 9.15 9.15 0 0 1 -36 7.3" {...line} />
          <rect x={-54.5} y={-3.66} width={2} height={7.32} fill="#ffffff" fillOpacity={0.9} />
          <path d="M -52.5 -33 A 1 1 0 0 0 -51.5 -34 M -52.5 33 A 1 1 0 0 1 -51.5 34" {...line} />
        </g>
      ))}
      {(
        [
          ["AWAY", -38],
          ["HOME", 38],
        ] as const
      ).map(([label, y]) => (
        <g key={label}>
          <rect x={-11} y={y - 2.6} width={22} height={5.2} rx={1.2} fill="rgb(0 0 0 / 0.18)" stroke="rgb(255 255 255 / 0.6)" strokeWidth={0.8} vectorEffect="non-scaling-stroke" />
          <text x={0} y={y} textAnchor="middle" dominantBaseline="central" fill="#ffffff" fontSize={3} fontWeight={700} letterSpacing={0.6} className="font-mono">
            {label}
          </text>
        </g>
      ))}
      </g>
    </g>
  );
}

/** Concerts / campus: a stage at one end and a standing floor (never a pitch). */
function StageFloor() {
  return (
    <g className="pointer-events-none">
      <path d={SURROUND_D} fill="#dfe3ea" />
      <g transform={`scale(${FIELD_K * 0.95})`}>
      <g stroke="rgb(60 70 90 / 0.1)" strokeWidth={1} vectorEffect="non-scaling-stroke">
        {Array.from({ length: 15 }, (_, i) => (
          <line key={`v${i}`} x1={-45 + i * 6} y1={-30} x2={-45 + i * 6} y2={30} />
        ))}
        {Array.from({ length: 11 }, (_, i) => (
          <line key={`h${i}`} x1={-45} y1={-30 + i * 6} x2={39} y2={-30 + i * 6} />
        ))}
      </g>
      <text x={-6} y={0} textAnchor="middle" dominantBaseline="central" fill="rgb(60 70 90 / 0.55)" fontSize={4} fontWeight={700} letterSpacing={1} className="font-mono">
        FLOOR
      </text>
      <rect x={26} y={-3} width={14} height={6} rx={1} fill="#2b2f3a" />
      <rect x={38} y={-17} width={16} height={34} rx={2} fill="#1c1f27" stroke="#e85002" strokeWidth={1.4} vectorEffect="non-scaling-stroke" />
      <text x={46} y={0} textAnchor="middle" dominantBaseline="central" fill="#ffffff" fontSize={3.4} fontWeight={700} letterSpacing={0.8} transform="rotate(-90 46 0)" className="font-mono">
        STAGE
      </text>
      <rect x={-30} y={-3} width={6} height={6} rx={0.8} fill="#9aa2b3" />
      </g>
    </g>
  );
}

/** Collapsible "Venue areas" legend (open from sm up, collapsed on phones until toggled). */
function AreasLegend() {
  const [open, setOpen] = useState<boolean | null>(null);
  const toggle = () => setOpen((o) => !(o ?? window.matchMedia("(min-width: 640px)").matches));
  return (
    <div data-ui className="absolute right-3 bottom-3 z-30 w-40 rounded-2xl bg-white p-3 text-[#111111] shadow-[0_6px_18px_-6px_rgb(20_30_50/0.35)] ring-1 ring-black/5 sm:w-44">
      <button type="button" onClick={toggle} aria-expanded={open ?? undefined} className="flex w-full items-center justify-between text-xs font-semibold">
        Venue areas
        <ChevronDown className={cn("size-4 transition-transform", open === null ? "-rotate-90 sm:rotate-0" : open ? "" : "-rotate-90")} />
      </button>
      {open !== false && (
        <ul className={cn("mt-2 space-y-1.5", open === null && "hidden sm:block")}>
          {AREA_ORDER.map((a) => (
            <li key={a} className="flex items-center gap-2 text-[11px] text-[#3c4252]">
              {a === "premium" ? <Star className="size-3 fill-current" style={{ color: AREA[a].swatch }} /> : <span className="size-2.5 rounded-full" style={{ background: AREA[a].swatch }} />}
              {AREA[a].label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** "How many tickets?" on load: 1–5 and 6+, each with the lowest price for that many seats together. */
function QuantityDialog({ from, current, onPick, onClose }: { from: (number | null)[]; current: number | null; onPick: (n: number) => void; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby="qty-title" onClick={onClose}>
      <div className="relative w-full max-w-md rounded-3xl bg-white p-6 text-[#111111] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <button type="button" onClick={onClose} className="absolute top-3 right-3 flex size-8 items-center justify-center rounded-full hover:bg-black/5" aria-label="Close">
          <X className="size-4" />
        </button>
        <h2 id="qty-title" className="text-center text-xl font-bold tracking-tight">
          How many tickets?
        </h2>
        <p className="mt-1 text-center text-sm text-[#52525b]">We&apos;ll show seats you can sit in together.</p>
        <div className="mt-5 grid grid-cols-3 gap-3">
          {from.map((price, i) => {
            const n = i + 1;
            return (
              <button
                key={n}
                type="button"
                disabled={price == null}
                onClick={() => onPick(n)}
                className={cn(
                  "rounded-2xl border px-2 py-3.5 text-center transition hover:border-[#e85002] hover:bg-[#fff4ec] active:scale-95 disabled:opacity-40",
                  current === n ? "border-[#e85002] bg-[#fff4ec]" : "border-[#e4e4e7]",
                )}
              >
                <span className="block text-lg font-bold">{n === 6 ? "6+" : n}</span>
                <span className="block text-xs text-[#52525b]">{price == null ? "None left" : `From ${usd(price)}`}</span>
              </button>
            );
          })}
        </div>
        <div className="mt-5 flex gap-3 rounded-2xl border border-[#ffe3f1] bg-[#fff6fa] p-4">
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-[#fe1c80]" />
          <div>
            <p className="text-sm font-semibold">Every ticket is payment-protected</p>
            <p className="text-xs text-[#52525b]">Resale is capped at the artist&apos;s price, and outside tickets wait in escrow until they work.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
