"use client";

// Owner: Nico. Angled "3D" seat map for the event page.
//
// The venue is a generic layout generated here (no venue geometry exists in lib/types.ts): an oval
// bowl around a field for sports, a horseshoe facing a stage for concerts and campus events. Each
// tier is its own SVG layer in a CSS 3D scene, lifted with translateZ, so the whole map tilts back
// like an angled stadium view. Listings are placed by parsing their seat label ("Sec 101 Row C Seat 12").
// Display only: buying stays in the event page's own listing rows ("Buy below" scrolls to them).

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "motion/react";
import { ArrowDown, Star } from "lucide-react";
import type { ChainListing } from "@/lib/chain";
import type { Event } from "@/lib/types";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

const W = 840;
const H = 620;
const CX = W / 2;

type TierIndex = 0 | 1 | 2 | 3;

interface Zone {
  id: string;
  label: string;
  tier: TierIndex;
  d: string;
  /** Label position. */
  lx: number;
  ly: number;
}

interface Layout {
  kind: "bowl" | "stage";
  zones: Zone[];
  /** The field (bowl) or stage (stage) rectangle: drawn in the base layer, anchors the Official pill. */
  anchor: { x: number; y: number; w: number; h: number };
  /** Lowercased named sections -> zone id. Numbered sections match their zone id directly. */
  aliases: Record<string, string>;
}

type Radii = [rx: number, ry: number];

const r1 = (n: number) => Math.round(n * 10) / 10;

function pt(cy: number, [rx, ry]: Radii, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [r1(CX + rx * Math.cos(a)), r1(cy + ry * Math.sin(a))];
}

/** Ring segment between two ellipses, from angle a0 to a1 (degrees, clockwise on screen). */
function sector(cy: number, inner: Radii, outer: Radii, a0: number, a1: number): string {
  const large = a1 - a0 > 180 ? 1 : 0;
  const [x0, y0] = pt(cy, outer, a0);
  const [x1, y1] = pt(cy, outer, a1);
  const [x2, y2] = pt(cy, inner, a1);
  const [x3, y3] = pt(cy, inner, a0);
  return `M${x0} ${y0}A${outer[0]} ${outer[1]} 0 ${large} 1 ${x1} ${y1}L${x2} ${y2}A${inner[0]} ${inner[1]} 0 ${large} 0 ${x3} ${y3}Z`;
}

function zone(id: string, label: string, tier: TierIndex, cy: number, inner: Radii, outer: Radii, a0: number, a1: number, gap = 1.4): Zone {
  const mid = (a0 + a1) / 2;
  const [lx, ly] = pt(cy, [(inner[0] + outer[0]) / 2, (inner[1] + outer[1]) / 2], mid);
  return { id, label, tier, d: sector(cy, inner, outer, a0 + gap / 2, a1 - gap / 2), lx, ly };
}

/** n numbered sections starting at `first`, evenly spread from a0 to a1. */
function ring(first: number, n: number, tier: TierIndex, cy: number, inner: Radii, outer: Radii, a0: number, a1: number): Zone[] {
  const step = (a1 - a0) / n;
  return Array.from({ length: n }, (_, i) => {
    const id = String(first + i);
    return zone(id, id, tier, cy, inner, outer, a0 + i * step, a0 + (i + 1) * step);
  });
}

const T1: [Radii, Radii] = [[180, 130], [250, 180]];
const T2: [Radii, Radii] = [[258, 186], [318, 228]];
const T3: [Radii, Radii] = [[326, 234], [372, 262]];
const LAWN: [Radii, Radii] = [[380, 268], [412, 290]];

function bowlLayout(): Layout {
  const cy = 306;
  return {
    kind: "bowl",
    zones: [
      // Lower tier: two sidelines, with Student and Supporters sections in the two ends.
      ...ring(101, 6, 1, cy, ...T1, 202, 338),
      ...ring(107, 6, 1, cy, ...T1, 22, 158),
      zone("STUDENT", "Student", 1, cy, ...T1, -20, 20),
      zone("SUPPORTERS", "Supporters", 1, cy, ...T1, 160, 200),
      ...ring(201, 14, 2, cy, ...T2, 180, 540),
      ...ring(301, 16, 3, cy, ...T3, 180, 540),
    ],
    anchor: { x: CX - 130, y: cy - 80, w: 260, h: 160 },
    aliases: { student: "STUDENT", students: "STUDENT", ga: "STUDENT", general: "STUDENT", supporters: "SUPPORTERS" },
  };
}

function stageLayout(): Layout {
  const cy = 318;
  return {
    kind: "stage",
    zones: [
      // Floor sits in front of the stage, at ground level (tier 0).
      {
        id: "FLOOR",
        label: "Floor",
        tier: 0,
        d: `M${CX - 100} ${cy - 125}h200v175h-200z`,
        lx: CX,
        ly: cy - 37,
      },
      // Horseshoe open toward the stage (top), 270° around.
      ...ring(101, 10, 1, cy, ...T1, -45, 225),
      ...ring(201, 12, 2, cy, ...T2, -45, 225),
      ...ring(301, 6, 3, cy, ...T3, -45, 65),
      zone("BALCONY", "Balcony", 3, cy, ...T3, 65, 115),
      ...ring(307, 6, 3, cy, ...T3, 115, 225),
      zone("LAWN", "Lawn", 0, cy, ...LAWN, 40, 140), // ground level, behind the stands
    ],
    anchor: { x: CX - 150, y: cy - 205, w: 300, h: 44 },
    aliases: {
      floor: "FLOOR", ga: "FLOOR", pit: "FLOOR", general: "FLOOR",
      balcony: "BALCONY", mezzanine: "BALCONY", mezz: "BALCONY",
      lawn: "LAWN",
    },
  };
}

const LAYOUTS = { bowl: bowlLayout(), stage: stageLayout() };

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

type MapEvent = Event & { supply?: number; sold?: number };

interface Placed {
  listing: ChainListing;
  section: string;
  row?: string;
  seat?: string;
}

interface SectionStats {
  id: string;
  label: string;
  onMap: boolean;
  listings: Placed[];
  min: number;
  tier1: boolean;
  tier2: boolean;
}

/** Lenient seat-label parse: "Sec 101 Row C Seat 12", "Sec Student Row GA", "GA", "Lawn". */
function parseLabel(label: string): { section: string; row?: string; seat?: string } {
  const section = /\bSec(?:tion)?\s+(\S+)/i.exec(label)?.[1];
  const row = /\bRow\s+(\S+)/i.exec(label)?.[1];
  const seat = /\bSeat\s+(\S+)/i.exec(label)?.[1];
  return { section: section ?? (label.trim() || "GA"), row, seat };
}

function groupListings(layout: Layout, listings: ChainListing[]): Map<string, SectionStats> {
  const ids = new Set(layout.zones.map((z) => z.id));
  const out = new Map<string, SectionStats>();
  for (const listing of listings) {
    const p = parseLabel(listing.seat);
    const key = p.section.toLowerCase();
    const zoneId = ids.has(p.section) ? p.section : layout.aliases[key];
    const id = zoneId ?? `other:${p.section}`;
    let s = out.get(id);
    if (!s) {
      s = { id, label: zoneId ? (layout.zones.find((z) => z.id === zoneId)?.label ?? p.section) : p.section, onMap: !!zoneId, listings: [], min: Infinity, tier1: false, tier2: false };
      out.set(id, s);
    }
    s.listings.push({ listing, ...p });
    s.min = Math.min(s.min, listing.priceUsd);
    if (listing.tier === 1) s.tier1 = true;
    else s.tier2 = true;
  }
  for (const s of out.values()) s.listings.sort((a, b) => a.listing.priceUsd - b.listing.priceUsd);
  return out;
}

// ---------------------------------------------------------------------------
// Measuring helpers
// ---------------------------------------------------------------------------

interface Rect {
  l: number;
  t: number;
  r: number;
  b: number;
}

function union(a: Rect | null, b: Rect | null): Rect | null {
  if (!a) return b;
  if (!b) return a;
  return { l: Math.min(a.l, b.l), t: Math.min(a.t, b.t), r: Math.max(a.r, b.r), b: Math.max(a.b, b.b) };
}

function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a.r, b.r) - Math.max(a.l, b.l);
  const h = Math.min(a.b, b.b) - Math.max(a.t, b.t);
  return w > 0 && h > 0 ? w * h : 0;
}

interface PinSpot {
  x: number;
  y: number;
  /** true: the pin hangs below the section's bottom edge, pointing up. */
  below: boolean;
}

/**
 * Spots for the price pin (SVG units), tried in order: just above the section's top edge (straight
 * above its label first, then across its width, nearest first), then the same along its bottom edge
 * for when everything above is covered in labels (e.g. a thin outer ring on a phone).
 */
function pinSpots(path: SVGPathElement, lx: number): PinSpot[] {
  const bb = path.getBBox();
  const xs = [lx, ...Array.from({ length: 11 }, (_, i) => bb.x + bb.width * (0.06 + (0.88 * i) / 10))];
  xs.sort((a, b) => Math.abs(a - lx) - Math.abs(b - lx));
  const inside = (x: number, y: number) => path.isPointInFill(new DOMPoint(x, y));
  const above: PinSpot[] = [];
  const below: PinSpot[] = [];
  for (const x of xs) {
    for (let y = bb.y; y <= bb.y + bb.height; y += 2) {
      if (inside(x, y)) {
        above.push({ x, y: y - 3, below: false });
        break;
      }
    }
    for (let y = bb.y + bb.height; y >= bb.y; y -= 2) {
      if (inside(x, y)) {
        below.push({ x, y: y + 3, below: true });
        break;
      }
    }
  }
  return [...above, ...below];
}

/**
 * Perspective map from the unit square to a projected quad (corners in order (0,0) (1,0) (1,1) (0,1)).
 * A plane under a CSS 3D transform projects exactly like this, so four measured corners locate any point.
 */
function squareToQuad(q: [number, number][]): (u: number, v: number) => [number, number] {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  let g = 0, h = 0;
  const den = dx1 * dy2 - dx2 * dy1;
  if (Math.abs(den) > 1e-9 && (Math.abs(dx3) > 1e-9 || Math.abs(dy3) > 1e-9)) {
    g = (dx3 * dy2 - dx2 * dy3) / den;
    h = (dx1 * dy3 - dx3 * dy1) / den;
  }
  const a = x1 - x0 + g * x1, b = x3 - x0 + h * x3, c = x0;
  const d = y1 - y0 + g * y1, e = y3 - y0 + h * y3, f = y0;
  return (u, v) => {
    const z = g * u + h * v + 1;
    return [(a * u + b * v + c) / z, (d * u + e * v + f) / z];
  };
}

const pinUsd = (n: number) => (Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`);

// ---------------------------------------------------------------------------
// Look
// ---------------------------------------------------------------------------

const COLORS = {
  tier1: "#2f6bea", // royal: SeatSafe resale
  tier2: "#9db9ff", // pale sky: outside tickets in escrow
  none: "#1a2234",
  noneStroke: "rgb(255 255 255 / 0.07)",
  edge: "rgb(2 6 15 / 0.55)",
};

const LIFT_DESKTOP = [0, 12, 26, 40];
const LIFT_MOBILE = [0, 6, 13, 20];

function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(query);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SeatMap({ event, listings }: { event: MapEvent; listings: ChainListing[] }) {
  const layout = event.category === "sports" ? LAYOUTS.bowl : LAYOUTS.stage;
  const stats = useMemo(() => groupListings(layout, listings), [layout, listings]);
  const cheapest = useMemo(() => {
    let best: SectionStats | null = null;
    for (const s of stats.values()) if (!best || s.min < best.min) best = s;
    return best?.id ?? null;
  }, [stats]);

  // undefined = untouched (follow the cheapest section), null = "show all".
  const [picked, setPicked] = useState<string | null | undefined>(undefined);
  const selected = picked === undefined ? cheapest : picked && stats.has(picked) ? picked : null;
  const selectedStats = selected ? stats.get(selected) : undefined;
  const selectedZone = selected ? layout.zones.find((z) => z.id === selected) : undefined;
  const offMap = [...stats.values()].filter((s) => !s.onMap);

  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const mobile = useMediaQuery("(max-width: 640px)");
  const finePointer = useMediaQuery("(hover: hover) and (pointer: fine)");
  const reduceMotion = useReducedMotion() ?? false;
  const lift = mobile ? LIFT_MOBILE : LIFT_DESKTOP;
  const tilt = mobile ? 22 : 40;

  // --- Tilt: animated base angle plus a small spring-smoothed mouse parallax.
  const base = useMotionValue(reduceMotion ? tilt : 0);
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const smx = useSpring(mx, { stiffness: 120, damping: 18 });
  const smy = useSpring(my, { stiffness: 120, damping: 18 });
  const rotateX = useTransform([base, smy], ([b, m]: number[]) => b - m * 4);
  const rotateY = useTransform(smx, (m) => m * 6);

  useEffect(() => {
    if (reduceMotion) {
      base.set(tilt);
      return;
    }
    const controls = animate(base, tilt, { duration: 1.1, ease: [0.22, 1, 0.36, 1], delay: 0.1 });
    return () => controls.stop();
  }, [base, tilt, reduceMotion]);

  const parallax = finePointer && !reduceMotion;
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!parallax || e.pointerType !== "mouse") return;
    const r = e.currentTarget.getBoundingClientRect();
    mx.set(((e.clientX - r.left) / r.width - 0.5) * 2);
    my.set(((e.clientY - r.top) / r.height - 0.5) * 2);
  };
  const onPointerLeave = () => {
    mx.set(0);
    my.set(0);
  };

  // --- Measuring. Everything below is read from the rendered (tilted) DOM, never guessed:
  //  * the price pin goes above the selected section's top edge, at the first spot that covers no label;
  //  * the container's margins and a fit-to-width scale come from the measured box of all drawn content.
  const sceneRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const liftedSvg = useRef<SVGSVGElement | null>(null);
  const anchorRef = useRef<SVGRectElement>(null);
  const officialRef = useRef<HTMLSpanElement>(null);
  const pinBoxRef = useRef<HTMLDivElement>(null);
  const pinX = useMotionValue(-999);
  const pinY = useMotionValue(-999);
  const offX = useMotionValue(-999);
  const offY = useMotionValue(-999);
  const marginTop = useMotionValue(0);
  const marginBottom = useMotionValue(0);
  const fit = useMotionValue(1);
  const candidates = useRef<{ key: string; pts: PinSpot[]; last: number } | null>(null);
  const [pinBelow, setPinBelow] = useState(false);
  const pinBelowRef = useRef(false);
  const selectedZoneRef = useRef(selectedZone);
  useLayoutEffect(() => {
    selectedZoneRef.current = selectedZone;
  });

  // Exiting lifted copies unmount after the new one mounts; keep the ref on the live one.
  const setLiftedSvg = useCallback((el: SVGSVGElement | null) => {
    if (el) liftedSvg.current = el;
    else if (liftedSvg.current && !liftedSvg.current.isConnected) liftedSvg.current = null;
  }, []);

  const measure = useCallback(() => {
    const scene = sceneRef.current;
    const map = mapRef.current;
    if (!scene || !map) return;
    const box = scene.getBoundingClientRect();
    const sx = smx.get();
    const sy = smy.get();
    const rel = (r: DOMRect): Rect => ({ l: r.left - box.left, t: r.top - box.top, r: r.right - box.left, b: r.bottom - box.top });

    // Official pill on the stage / field.
    const a = anchorRef.current;
    if (a) {
      const r = a.getBoundingClientRect();
      offX.set(r.left + r.width / 2 - box.left);
      offY.set(r.top + r.height / 2 - box.top);
    }
    const official = officialRef.current ? rel(officialRef.current.getBoundingClientRect()) : null;

    // Every label the pin must not cover (the selected base label is hidden under its lifted copy).
    const zone = selectedZoneRef.current;
    const labels: Rect[] = official ? [official] : [];
    scene.querySelectorAll<SVGTextElement>("text[data-zone]").forEach((t) => {
      if (zone && t.dataset.zone === zone.id) return;
      labels.push(rel(t.getBoundingClientRect()));
    });

    // Price pin.
    let pinRect: Rect | null = null;
    const svg = liftedSvg.current;
    const path = svg?.querySelector<SVGPathElement>("[data-lifted]");
    const corners = svg ? [...svg.querySelectorAll<SVGRectElement>("[data-corner]")] : [];
    if (zone && path && corners.length === 4) {
      if (candidates.current?.key !== zone.id) candidates.current = { key: zone.id, pts: pinSpots(path, zone.lx), last: 0 };
      const c = candidates.current;
      const project = squareToQuad(
        corners.map((el) => {
          const r = el.getBoundingClientRect();
          return [r.left + r.width / 2 - box.left, r.top + r.height / 2 - box.top] as [number, number];
        }),
      );
      const w = pinBoxRef.current?.offsetWidth || 60;
      const h = pinBoxRef.current?.offsetHeight || 40;
      const rectAt = (i: number): Rect => {
        const p = c.pts[i];
        const [x, y] = project(p.x / W, p.y / H);
        return p.below ? { l: x - w / 2, t: y, r: x + w / 2, b: y + h } : { l: x - w / 2, t: y - h, r: x + w / 2, b: y };
      };
      const cost = (r: Rect) => labels.reduce((s, l) => s + overlap(r, l), 0);
      // Keep the current spot while it stays clear, so the pin doesn't hop around mid-animation.
      let best = c.last < c.pts.length && cost(rectAt(c.last)) === 0 ? c.last : -1;
      if (best < 0) {
        let bestCost = Infinity;
        for (let i = 0; i < c.pts.length; i++) {
          const k = cost(rectAt(i));
          if (k < bestCost) {
            bestCost = k;
            best = i;
          }
          if (k === 0) break;
        }
      }
      if (best >= 0) {
        c.last = best;
        pinRect = rectAt(best);
        const below = c.pts[best].below;
        pinX.set((pinRect.l + pinRect.r) / 2);
        pinY.set(below ? pinRect.t : pinRect.b);
        if (below !== pinBelowRef.current) {
          pinBelowRef.current = below;
          setPinBelow(below);
        }
      }
    }

    // Container size. Skipped while the mouse parallax is active so the page below never jiggles;
    // PAD_BOTTOM leaves room for the few degrees of parallax tilt.
    if (Math.abs(sx) > 0.01 || Math.abs(sy) > 0.01) return;
    let drawn: Rect | null = null;
    for (const el of map.querySelectorAll("[data-content]")) drawn = union(drawn, rel(el.getBoundingClientRect()));
    if (!drawn) return;
    const all = union(union(drawn, pinRect), official)!;
    const PAD_TOP = 4;
    const PAD_BOTTOM = 16;
    // Content moves with the margins, so: new top margin = old + (wanted top - measured top), and
    // the bottom margin is however far the drawn content hangs past the map's layout box.
    const layoutBottom = map.offsetTop + map.offsetHeight;
    // Clamped to half the map's height either way, so a bad reading can never run away.
    const lim = map.offsetHeight / 2;
    const clamp = (n: number) => Math.round(Math.min(lim, Math.max(-lim, n)));
    const mt = clamp(marginTop.get() + PAD_TOP - all.t);
    const mb = clamp(all.b - layoutBottom + PAD_BOTTOM);
    if (Math.abs(mt - marginTop.get()) >= 1) marginTop.set(mt);
    if (Math.abs(mb - marginBottom.get()) >= 1) marginBottom.set(mb);
    const avail = scene.clientWidth - 8;
    const width = drawn.r - drawn.l;
    const nextFit = Math.min(1, Math.max(0.5, (fit.get() * avail) / width));
    if (Math.abs(nextFit - fit.get()) > 0.005) fit.set(nextFit);
  }, [pinX, pinY, offX, offY, marginTop, marginBottom, fit, smx, smy]);

  // Re-measure every frame while anything is moving, then stop.
  const until = useRef(0);
  const raf = useRef(0);
  const kick = useCallback(() => {
    until.current = performance.now() + 700;
    if (raf.current) return;
    const tick = () => {
      measure();
      raf.current = performance.now() < until.current ? requestAnimationFrame(tick) : 0;
    };
    raf.current = requestAnimationFrame(tick);
  }, [measure]);

  useLayoutEffect(() => {
    measure();
    kick();
  }, [selected, mobile, measure, kick]);

  useEffect(() => {
    const unsubs = [rotateX.on("change", kick), rotateY.on("change", kick)];
    const ro = new ResizeObserver(kick);
    if (sceneRef.current) ro.observe(sceneRef.current);
    return () => {
      unsubs.forEach((u) => u());
      ro.disconnect();
      cancelAnimationFrame(raf.current);
      raf.current = 0;
    };
  }, [rotateX, rotateY, kick]);

  const fillFor = (id: string) => {
    const s = stats.get(id);
    if (!s) return COLORS.none;
    if (s.tier1 && s.tier2) return `url(#${uid}-both)`;
    return s.tier1 ? COLORS.tier1 : COLORS.tier2;
  };

  const select = (id: string) => setPicked(id === selected ? null : id);

  const soldOut = event.supply !== undefined && event.sold !== undefined && event.sold >= event.supply;
  const labelSize = mobile ? 24 : 15;
  const longLabelSize = mobile ? 16 : 13; // "Supporters" etc. must fit inside their section
  const visibleListings = selectedStats ? selectedStats.listings : [...stats.values()].flatMap((s) => s.listings).sort((a, b) => a.listing.priceUsd - b.listing.priceUsd);

  return (
    <section className="mt-8 space-y-3" aria-label="Seat map">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Pick a section</h2>
          <p className="text-sm text-muted-foreground">Tap a blue section to see its seats. Grey sections have nothing listed.</p>
        </div>
        <Legend />
      </div>

      {/* Scene */}
      <div
        ref={sceneRef}
        className="relative -mx-4 flow-root overflow-x-clip px-2 select-none sm:mx-0" // flow-root: the map's measured margins must not collapse through
        style={{ perspective: mobile ? 900 : 1300, perspectiveOrigin: "50% 20%", touchAction: "manipulation" }}
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
      >
        <motion.div
          ref={mapRef}
          className="relative mx-auto w-full max-w-3xl"
          // Margins and scale are measured from the tilted content (see measure()).
          style={{
            aspectRatio: `${W} / ${H}`,
            marginTop,
            marginBottom,
            scale: fit,
            rotateX,
            rotateY,
            transformStyle: "preserve-3d",
            transformOrigin: "50% 55%",
          }}
          initial={reduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
        >
          {([0, 1, 2, 3] as const).map((tier) => (
            <svg
              key={tier}
              viewBox={`0 0 ${W} ${H}`}
              className="absolute inset-0 h-full w-full overflow-visible"
              style={{
                transform: `translateZ(${lift[tier]}px)`,
                pointerEvents: "none",
                filter: tier > 0 ? "drop-shadow(0 6px 6px rgb(0 0 0 / 0.45))" : undefined,
              }}
              aria-hidden={tier === 0 ? undefined : true}
            >
              {tier === 0 && (
                <>
                  <defs>
                    <pattern id={`${uid}-both`} width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                      <rect width="10" height="10" fill={COLORS.tier1} />
                      <rect width="5" height="10" fill={COLORS.tier2} />
                    </pattern>
                  </defs>
                </>
              )}
              <g data-content>
              {tier === 0 && <Ground layout={layout} anchorRef={anchorRef} />}
              {layout.zones
                .filter((z) => z.tier === tier)
                .map((z) => {
                  const s = stats.get(z.id);
                  const active = !!s;
                  return (
                    <g key={z.id}>
                      <path
                        d={z.d}
                        fill={fillFor(z.id)}
                        stroke={active ? COLORS.edge : COLORS.noneStroke}
                        strokeWidth={1.5}
                        className={cn("transition-[filter,opacity] duration-200", active && "cursor-pointer hover:brightness-125 focus:outline-none focus-visible:brightness-150")}
                        style={{ pointerEvents: active ? "auto" : "none", opacity: selected && active && selected !== z.id ? 0.78 : 1 }}
                        tabIndex={active ? 0 : undefined}
                        role={active ? "button" : undefined}
                        aria-pressed={active ? selected === z.id : undefined}
                        aria-label={active ? `Section ${z.label}, from ${pinUsd(s.min)}, ${s.listings.length} listed` : undefined}
                        onClick={active ? () => select(z.id) : undefined}
                        onKeyDown={
                          active
                            ? (e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  select(z.id);
                                }
                              }
                            : undefined
                        }
                      />
                      <text
                        data-zone={z.id}
                        x={z.lx}
                        y={z.ly}
                        textAnchor="middle"
                        dominantBaseline="central"
                        fontSize={z.label.length > 7 ? longLabelSize : labelSize}
                        fontWeight={600}
                        fill={active ? "#ffffff" : "rgb(255 255 255 / 0.32)"}
                        stroke={active ? "rgb(2 6 15 / 0.7)" : "none"}
                        strokeWidth={3}
                        paintOrder="stroke"
                        // The lifted copy carries the selected label; hide this one so it doesn't ghost below.
                        style={{ pointerEvents: "none", opacity: selected === z.id ? 0 : 1 }}
                      >
                        {z.label}
                      </text>
                    </g>
                  );
                })}
              </g>
            </svg>
          ))}

          {/* Selected section: a glowing copy lifted above its tier. */}
          <AnimatePresence>
            {selectedZone && (
              <motion.svg
                key={selectedZone.id}
                ref={setLiftedSvg}
                viewBox={`0 0 ${W} ${H}`}
                className="absolute inset-0 h-full w-full overflow-visible"
                style={{ pointerEvents: "none" }}
                initial={{ z: lift[selectedZone.tier], opacity: 0 }}
                animate={{ z: lift[selectedZone.tier] + (mobile ? 10 : 18), opacity: 1 }}
                exit={{ z: lift[selectedZone.tier], opacity: 0 }}
                transition={{ type: "spring", stiffness: 260, damping: 22 }}
                aria-hidden
              >
                {/* Corner markers: their projected positions map any SVG point to the screen. */}
                {([[0, 0], [W, 0], [W, H], [0, H]] as const).map(([x, y]) => (
                  <rect key={`${x},${y}`} data-corner x={x} y={y} width={0.01} height={0.01} fill="none" />
                ))}
                <path
                  data-lifted
                  data-content
                  d={selectedZone.d}
                  fill={fillFor(selectedZone.id)}
                  stroke="#ffffff"
                  strokeWidth={2.5}
                  style={{ filter: "drop-shadow(0 0 10px rgb(120 160 255 / 0.95)) drop-shadow(0 12px 10px rgb(0 0 0 / 0.5))" }}
                />
                <text
                  data-zone="__lifted"
                  x={selectedZone.lx}
                  y={selectedZone.ly}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={selectedZone.label.length > 7 ? longLabelSize : labelSize}
                  fontWeight={700}
                  fill="#ffffff"
                  stroke="rgb(2 6 15 / 0.7)"
                  strokeWidth={3}
                  paintOrder="stroke"
                >
                  {selectedZone.label}
                </text>
              </motion.svg>
            )}
          </AnimatePresence>
        </motion.div>

        {/* Upright pins (outside the tilted scene, so they never tilt). */}
        <motion.div className="pointer-events-none absolute top-0 left-0" style={{ x: offX, y: offY }}>
          <div className="-translate-x-1/2 -translate-y-1/2">
            <span
              ref={officialRef}
              className={cn(
                "block rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap shadow-lg",
                soldOut ? "border-white/15 bg-[#1a2234] text-white/60" : "border-white/30 bg-white text-[#0b1430]",
              )}
            >
              Official · {soldOut ? "Sold out" : pinUsd(event.priceFromUsd)}
            </span>
          </div>
        </motion.div>

        <AnimatePresence>
          {selectedZone && selectedStats && (
            <motion.div key={selectedZone.id} className="pointer-events-none absolute top-0 left-0 z-10" style={{ x: pinX, y: pinY }}>
              <motion.div
                ref={pinBoxRef}
                className={cn("-translate-x-1/2", pinBelow ? "pt-1" : "-translate-y-full pb-1")}
                initial={reduceMotion ? false : { opacity: 0, y: 8, scale: 0.8 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 4, scale: 0.9 }}
                transition={{ type: "spring", stiffness: 380, damping: 24 }}
              >
                <div className={cn("flex items-center", pinBelow ? "flex-col-reverse" : "flex-col")}>
                  <span className="rounded-full bg-[#2f6bea] px-3 py-1 text-sm font-bold text-white tabular-nums shadow-[0_6px_18px_-4px_rgb(47_107_234/0.9)] ring-2 ring-white">
                    {pinUsd(selectedStats.min)}
                  </span>
                  <span
                    className={cn(
                      "size-2.5 rotate-45 bg-[#2f6bea] ring-2 ring-white",
                      pinBelow ? "-mb-1 [clip-path:polygon(0_0,100%_0,0_100%)]" : "-mt-1 [clip-path:polygon(100%_0,100%_100%,0_100%)]",
                    )}
                  />
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {offMap.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Also listed:</span>
          {offMap.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => select(s.id)}
              aria-pressed={selected === s.id}
              className={cn("rounded-full border px-3 py-1", selected === s.id ? "border-white bg-white text-[#0b1430]" : "border-border hover:bg-accent")}
            >
              {s.label} · from {pinUsd(s.min)}
            </button>
          ))}
        </div>
      )}

      <SectionListings
        title={selectedStats ? (selectedStats.onMap && /^\d/.test(selectedStats.label) ? `Section ${selectedStats.label}` : selectedStats.label) : "All sections"}
        items={visibleListings}
        cap={event.resaleCapUsd}
        onShowAll={selected ? () => setPicked(null) : undefined}
      />
    </section>
  );
}

function Ground({ layout, anchorRef }: { layout: Layout; anchorRef: React.Ref<SVGRectElement> }) {
  const a = layout.anchor;
  const line = "rgb(255 255 255 / 0.22)";
  if (layout.kind === "bowl") {
    return (
      <g>
        <rect ref={anchorRef} x={a.x} y={a.y} width={a.w} height={a.h} rx={18} fill="#0f2a2a" stroke={line} strokeWidth={2} />
        <line x1={CX} y1={a.y} x2={CX} y2={a.y + a.h} stroke={line} strokeWidth={2} />
        <circle cx={CX} cy={a.y + a.h / 2} r={26} fill="none" stroke={line} strokeWidth={2} />
        <rect x={a.x} y={a.y + a.h / 2 - 34} width={34} height={68} fill="none" stroke={line} strokeWidth={2} />
        <rect x={a.x + a.w - 34} y={a.y + a.h / 2 - 34} width={34} height={68} fill="none" stroke={line} strokeWidth={2} />
      </g>
    );
  }
  return (
    <g>
      <rect ref={anchorRef} x={a.x} y={a.y} width={a.w} height={a.h} rx={8} fill="#0b1430" stroke="rgb(164 189 253 / 0.6)" strokeWidth={2} />
      <text x={CX} y={a.y + a.h / 2} textAnchor="middle" dominantBaseline="central" fontSize={13} fontWeight={700} letterSpacing={4} fill="rgb(164 189 253 / 0.8)">
        STAGE
      </text>
    </g>
  );
}

function Legend() {
  const item = (swatch: React.ReactNode, label: string) => (
    <span className="flex items-center gap-1.5">
      {swatch}
      {label}
    </span>
  );
  const box = (style: React.CSSProperties) => <span className="size-3 shrink-0 rounded-[3px] ring-1 ring-white/35" style={style} />;
  // Solid dark pill: the page's light-blue top would otherwise wash out the pale "Outside" swatch.
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 rounded-2xl border border-white/10 bg-[#0b1430] px-3 py-1.5 text-xs font-medium text-white/90 shadow-lg sm:rounded-full">
      {item(box({ background: COLORS.tier1 }), "SeatSafe resale")}
      {item(box({ background: COLORS.tier2 }), "Outside ticket")}
      {item(box({ background: `repeating-linear-gradient(45deg, ${COLORS.tier1} 0 3px, ${COLORS.tier2} 3px 6px)` }), "Both")}
      {item(box({ background: COLORS.none }), "Nothing listed")}
    </div>
  );
}

function SectionListings({
  title,
  items,
  cap,
  onShowAll,
}: {
  title: string;
  items: Placed[];
  cap: number | null;
  onShowAll?: () => void;
}) {
  const goTo = (id: string) => {
    const el = document.getElementById(`listing-${id}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.animate(
      [
        { boxShadow: "0 0 0 2px rgb(157 185 255 / 0.95)" },
        { boxShadow: "0 0 0 2px rgb(157 185 255 / 0)" },
      ],
      { duration: 1800, delay: 350, easing: "ease-out" },
    );
  };

  return (
    <div className="rounded-xl border border-border bg-card/60 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="font-medium">
          {title} <span className="text-sm font-normal text-muted-foreground">· {items.length} listed</span>
        </h3>
        {onShowAll && (
          <button type="button" onClick={onShowAll} className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground">
            Show all
          </button>
        )}
      </div>
      {items.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">Nothing listed on the map for this event yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          <AnimatePresence initial={false} mode="popLayout">
            {items.map(({ listing, row, seat, section }) => {
              const overCap = listing.tier === 1 && cap != null && listing.priceUsd > cap;
              return (
                <motion.li
                  key={listing.id}
                  layout
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.18 }}
                  className="flex items-center gap-3 py-2.5"
                >
                  <span className="w-16 shrink-0 text-lg font-bold tabular-nums">{pinUsd(listing.priceUsd)}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {row || seat ? (
                        <>
                          {onShowAll ? "" : `Sec ${section} · `}
                          {row && row !== "-" ? `Row ${row}` : ""}
                          {seat && seat !== "-" ? ` · Seat ${seat}` : ""}
                        </>
                      ) : (
                        "General admission"
                      )}
                    </p>
                    <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                      <span
                        className="rounded px-1.5 py-px font-medium text-[#0b1430]"
                        style={{ background: listing.tier === 1 ? "#7fa6f7" : COLORS.tier2 }}
                      >
                        {listing.tier === 1 ? "Resale" : "Outside · escrow"}
                      </span>
                      {listing.tier === 1 ? (
                        cap == null ? (
                          <span>No resale cap</span>
                        ) : overCap ? (
                          <span className="text-disputed">Above {pinUsd(cap)} cap</span>
                        ) : (
                          <span>Within {pinUsd(cap)} cap</span>
                        )
                      ) : (
                        <span>Not capped</span>
                      )}
                      {listing.sellerRating > 0 ? (
                        <span className="inline-flex items-center gap-0.5">
                          <Star className="size-3 fill-current" aria-hidden />
                          {listing.sellerRating.toFixed(1)}
                        </span>
                      ) : (
                        <span>New seller</span>
                      )}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => goTo(listing.id)}
                    className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent"
                  >
                    Buy below <ArrowDown className="size-3" aria-hidden />
                  </button>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      )}
    </div>
  );
}
