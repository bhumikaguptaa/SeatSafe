"use client";

// Owner: A. 3D seat picker for /events/[id] (loaded client-only with next/dynamic from EventView).
// Aerial view (slow orbit) → hover a stand (white pill "West Lower · from $10") → click: camera glides in →
// hover seats (pill per seat) → click: camera at the seat's eye height = the real view → white ticket card
// (live thumbnail of that view) → Buy runs the same builders + relayer as the rest of the app:
//   red available → buy_primary (seat code stored onchain) · green resale → swap_resale ·
//   amber outside → fund_escrow → /orders/<escrow>. Blue = taken. Grey = not on sale.
// ?intro=1 plays a ~12 s hands-free sequence for recording.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Canvas } from "@react-three/fiber";
import { useProgress, type CameraControls } from "@react-three/drei";
import * as THREE from "three";
import { ArrowLeft, Crown, Loader2, ShieldCheck, Ticket as TicketIcon } from "lucide-react";
import { PublicKey } from "@solana/web3.js";
import { buildLayout, fromPrice, mapSeats, seatCode, seatLabel, VIP, type SectionId, type SeatState } from "@/lib/stadium-map";
import { chainProgram, USE_MOCK, type ChainListing } from "@/lib/chain";
import { buyPrimary, fundEscrow, swapResale } from "@/lib/program";
import { saveMeta } from "@/lib/event-meta";
import { mockTx, useRunTx } from "@/lib/tx";
import { formatUsd } from "@/lib/format";
import type { Event } from "@/lib/types";
import { CalendarLinks } from "@/components/AddToCalendar";
import StadiumScene, { SEAT_COLORS, type HoverSeat } from "./StadiumScene";
import { seatEye, seatTransform } from "./geometry";
import { cn } from "@/lib/utils";

type Mode = "aerial" | "section" | "seat";
type PickerEvent = Event & { supply?: number; sold?: number; priceUsd?: number };

const AERIAL: [number, number, number, number, number, number] = [-40, 105, 170, 0, 0, 0];
const KIND_TEXT: Record<SeatState["kind"], string> = {
  available: "Available · official",
  resale: "Protected resale",
  outside: "Outside ticket · Escrow protected",
  taken: "Taken",
  off: "Not on sale",
};

function webglOk(): boolean {
  try {
    const c = document.createElement("canvas");
    return Boolean(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

function LoadingScreen() {
  const { progress, active } = useProgress();
  if (!active && progress >= 100) return null;
  return (
    <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 bg-[#0b0b0f]">
      <svg viewBox="0 0 200 70" className="w-56 text-[#26262e]" aria-hidden>
        <path d="M10 60 Q100 -10 190 60" fill="none" stroke="currentColor" strokeWidth="6" />
        <path d="M30 60 Q100 10 170 60" fill="none" stroke="currentColor" strokeWidth="4" />
        <rect x="8" y="60" width="184" height="4" fill="currentColor" />
      </svg>
      <div className="h-1.5 w-56 overflow-hidden rounded-full bg-[#26262e]">
        <div className="h-full bg-[#e5383b] transition-all" style={{ width: `${Math.max(5, progress)}%` }} />
      </div>
      <p className="text-xs text-[#a1a1aa]">Building the stadium… {Math.round(progress)}%</p>
    </div>
  );
}

export function StadiumPicker({
  event,
  listings,
  onDone,
  intro = false,
}: {
  event: PickerEvent;
  listings: ChainListing[];
  onDone: () => Promise<void>;
  intro?: boolean;
}) {
  const router = useRouter();
  const { run } = useRunTx();
  const controls = useRef<CameraControls | null>(null);
  const glRef = useRef<THREE.WebGLRenderer | null>(null);
  const [ok, setOk] = useState<boolean | null>(null);
  const [mode, setMode] = useState<Mode>("aerial");
  const [focus, setFocus] = useState<SectionId | null>(null);
  const [hoverSection, setHoverSection] = useState<SectionId | null>(null);
  const [hoverSeat, setHoverSeat] = useState<HoverSeat | null>(null);
  const [selected, setSelected] = useState<HoverSeat | null>(null);
  const [thumb, setThumb] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [seatByMint, setSeatByMint] = useState<Map<string, string>>(new Map());
  const [idle, setIdle] = useState(true);
  const postFx = typeof window === "undefined" || new URLSearchParams(window.location.search).get("fx") !== "0";

  useEffect(() => {
    const id = setTimeout(() => setOk(webglOk()), 0);
    return () => clearTimeout(id);
  }, []);

  // Onchain seat codes of minted tickets (TicketRecord: discriminator(8) + event(32) + mint(32) + seat ...).
  const loadRecords = useCallback(async () => {
    if (USE_MOCK) return;
    try {
      const rows = await chainProgram().account.ticketRecord.all([{ memcmp: { offset: 8, bytes: event.id } }]);
      setSeatByMint(new Map(rows.map((r) => [r.account.mint.toBase58(), r.account.seat])));
    } catch {
      // keep the index rule only
    }
  }, [event.id]);
  useEffect(() => {
    const id = setTimeout(() => void loadRecords(), 0);
    return () => clearTimeout(id);
  }, [loadRecords, event.sold]);

  const layout = useMemo(() => buildLayout(), []);
  const byId = useMemo(() => new Map(layout.map((l) => [l.def.id, l])), [layout]);
  const states = useMemo(
    () =>
      mapSeats(layout, {
        eventId: event.id,
        programId: USE_MOCK ? null : chainProgram().programId,
        supply: event.supply ?? 120,
        sold: event.sold ?? (USE_MOCK ? 40 : 0),
        priceUsd: event.priceUsd ?? event.priceFromUsd,
        capUsd: event.resaleCapUsd,
        resale: listings.filter((l) => l.tier === 1 && l.ticketMint).map((l) => ({ ticketMint: l.ticketMint!, listingId: l.id, priceUsd: l.priceUsd, sellerName: l.sellerName })),
        outside: listings.filter((l) => l.tier === 2 && l.escrow).map((l) => ({ escrow: l.escrow!, priceUsd: l.priceUsd, bondUsd: l.bondUsd, sellerName: l.sellerName })),
        seatByMint,
      }),
    [layout, event, listings, seatByMint],
  );
  const fromPriceOf = useCallback((id: SectionId) => fromPrice(states.get(id)), [states]);

  // ---- Camera moves ----
  const toAerial = useCallback(() => {
    setMode("aerial");
    setFocus(null);
    setSelected(null);
    setThumb(null);
    void controls.current?.setLookAt(...AERIAL, true);
  }, []);

  const toSection = useCallback(
    (id: SectionId) => {
      const l = byId.get(id);
      if (!l) return;
      const mid = (l.def.from + l.def.to) / 2;
      const s = seatTransform(l.def, { row: Math.ceil(l.def.rows / 2), theta: mid }).pos;
      const cam = s.clone().multiplyScalar(0.4).setY(s.y + 15);
      setMode("section");
      setFocus(id);
      setSelected(null);
      setThumb(null);
      setIdle(false);
      void controls.current?.setLookAt(cam.x, cam.y, cam.z, s.x, s.y, s.z, true);
    },
    [byId],
  );

  const capture = useCallback(() => {
    // Wait for the camera to settle, then two frames, then grab the canvas (preserveDrawingBuffer).
    const c = controls.current;
    const grab = () =>
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          try {
            setThumb(glRef.current?.domElement.toDataURL("image/jpeg", 0.82) ?? null);
          } catch {
            setThumb(null);
          }
        }),
      );
    if (!c) return grab();
    const onRest = () => {
      c.removeEventListener("rest", onRest);
      grab();
    };
    c.addEventListener("rest", onRest);
    setTimeout(() => {
      c.removeEventListener("rest", onRest);
      grab();
    }, 2200);
  }, []);

  const toSeat = useCallback(
    (h: HoverSeat) => {
      const l = byId.get(h.section);
      if (!l) return;
      const slot = l.slots[h.index];
      const eye = seatEye(l.def, slot);
      setMode("seat");
      setFocus(h.section);
      setSelected(h);
      setHoverSeat(null);
      setThumb(null);
      setIdle(false);
      void controls.current?.setLookAt(eye.x, eye.y, eye.z, 0, 1.5, 0, true);
      capture();
    },
    [byId, capture],
  );

  const toVip = useCallback(() => {
    const l = byId.get("VIP");
    if (!l) return;
    const best = l.slots.find((s) => s.row === 2 && s.seat === 5) ?? l.slots[0];
    toSeat({ section: "VIP", index: best.index });
  }, [byId, toSeat]);

  // Start in the aerial view once the controls exist.
  useEffect(() => {
    if (!ok) return;
    const id = setTimeout(() => void controls.current?.setLookAt(...AERIAL, false), 50);
    return () => clearTimeout(id);
  }, [ok]);

  // ---- ?intro=1: hands-free ~12 s sequence ----
  useEffect(() => {
    if (!intro || !ok) return;
    const target: SectionId = "WL";
    const l = byId.get(target)!;
    const st = states.get(target) ?? [];
    const picks = l.slots.filter((s) => st[s.index]?.kind === "available" || st[s.index]?.kind === "resale").slice(0, 3);
    const ts: ReturnType<typeof setTimeout>[] = [];
    const at = (ms: number, fn: () => void) => ts.push(setTimeout(fn, ms));
    at(400, () => setIdle(true));
    at(3200, () => setHoverSection(target));
    at(4300, () => {
      setHoverSection(null);
      toSection(target);
    });
    picks.forEach((s, i) => at(6000 + i * 900, () => setHoverSeat({ section: target, index: s.index })));
    at(8900, () => {
      if (picks[2]) toSeat({ section: target, index: picks[2].index });
    });
    return () => ts.forEach(clearTimeout);
  }, [intro, ok]); // eslint-disable-line react-hooks/exhaustive-deps -- runs once when the scene is ready

  // ---- Buying ----
  const sel = selected ? { l: byId.get(selected.section)!, st: states.get(selected.section)?.[selected.index] } : null;
  const slot = sel && selected ? sel.l.slots[selected.index] : null;

  const buy = async () => {
    if (!sel?.st || !slot) return;
    const st = sel.st;
    setBusy(true);
    const calendar = <CalendarLinks event={event} />;
    let okBuy = false;
    if (st.kind === "available") {
      const opts = { pending: "Buying your seat…", success: `You're in! ${seatLabel(slot)}`, successExtra: calendar };
      okBuy = USE_MOCK ? await mockTx(opts) : (await run((ctx) => buyPrimary(ctx, { event: new PublicKey(event.id), seat: seatCode(slot) }), opts)) !== null;
    } else if (st.kind === "resale" && st.ticketMint) {
      const opts = { pending: "Swapping ticket and payment…", success: "Ticket bought! It's in My tickets.", successExtra: calendar };
      okBuy = USE_MOCK ? await mockTx(opts) : (await run((ctx) => swapResale(ctx, { ticketMint: new PublicKey(st.ticketMint!) }), opts)) !== null;
    } else if (st.kind === "outside" && st.escrow) {
      const opts = { pending: "Locking your payment in the vault…", success: "Payment protected. Track your order.", successExtra: calendar };
      if (USE_MOCK) {
        if (await mockTx(opts)) router.push("/orders/ord_held");
      } else if (await run((ctx) => fundEscrow(ctx, { escrow: new PublicKey(st.escrow!) }), opts)) {
        void saveMeta({ kind: "escrow", id: st.escrow, data: { eventId: event.id, seat: "Outside ticket", sellerName: st.sellerName ?? "Seller" } });
        router.push(`/orders/${st.escrow}`);
      }
      setBusy(false);
      return;
    }
    setBusy(false);
    if (okBuy) {
      await onDone();
      await loadRecords();
      if (selected) toSection(selected.section); // short pull-back: the seat is now blue
    }
  };

  if (ok === false) return null; // no WebGL: the 2D page below is the picker
  const legend: SeatState["kind"][] = ["available", "resale", "outside", "taken"];
  const vip = selected?.section === "VIP";

  return (
    <div className="relative mb-6 aspect-[16/10] w-full overflow-hidden rounded-2xl border border-border bg-[#0b0b0f] md:aspect-[16/9]">
      {ok && (
        <Canvas
          shadows
          dpr={[1, 1.5]}
          gl={{ preserveDrawingBuffer: true, antialias: false, powerPreference: "high-performance" }}
          camera={{ fov: 42, near: 0.1, far: 2000, position: [AERIAL[0], AERIAL[1], AERIAL[2]] }}
          onCreated={({ gl }) => {
            glRef.current = gl;
            gl.toneMapping = THREE.NoToneMapping; // ACES is applied in post
          }}
          onPointerDown={() => setIdle(false)}
        >
          <StadiumScene
            layout={layout}
            states={states}
            controlsRef={controls}
            autoOrbit={mode === "aerial" && idle && !hoverSection}
            focusSection={focus}
            hoveredSection={mode === "aerial" ? hoverSection : null}
            hoveredSeat={mode !== "aerial" ? hoverSeat : null}
            selectedSeat={mode === "seat" ? null : selected}
            showSeatPill={mode === "section"}
            fromPriceOf={fromPriceOf}
            onHoverSection={(id) => {
              if (mode === "aerial") setHoverSection(id);
            }}
            onSelectSection={(id) => {
              if (mode === "aerial") toSection(id);
            }}
            onHoverSeat={(h) => {
              if (mode === "section") setHoverSeat(h && h.section === focus ? h : null);
            }}
            onSelectSeat={(h) => {
              if (mode === "aerial") return toSection(h.section);
              if (mode === "section" && h.section === focus) toSeat(h);
            }}
            postFx={postFx}
          />
        </Canvas>
      )}
      <LoadingScreen />

      {/* Top bar: breadcrumb + legend */}
      <div className="pointer-events-none absolute inset-x-3 top-3 z-20 flex flex-wrap items-start justify-between gap-2">
        <div className="pointer-events-auto flex items-center gap-2">
          {mode !== "aerial" && (
            <button
              type="button"
              onClick={() => (mode === "seat" && focus && focus !== "VIP" ? toSection(focus) : toAerial())}
              className="overlay-white flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-semibold"
            >
              <ArrowLeft className="size-4" /> {mode === "seat" && focus !== "VIP" ? "Back to section" : "Whole stadium"}
            </button>
          )}
          <span className="overlay-white rounded-full px-3 py-1.5 text-sm font-semibold">
            {mode === "aerial" ? "Pick a stand" : focus === "VIP" ? VIP.name : byId.get(focus!)?.def.name}
            {slot && mode === "seat" && !vip ? ` · Row ${slot.row} · Seat ${slot.seat}` : ""}
          </span>
        </div>
        <div className="overlay-white flex flex-wrap gap-3 rounded-full px-3 py-1.5 text-xs font-medium">
          {legend.map((k) => (
            <span key={k} className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-full" style={{ background: SEAT_COLORS[k] }} />
              {k === "available" ? "Available" : k === "resale" ? "Protected resale" : k === "outside" ? "Outside · escrow" : "Taken"}
            </span>
          ))}
        </div>
      </div>

      {/* Ticket card */}
      {mode === "seat" && slot && (
        <div className="absolute inset-x-3 bottom-3 z-20 mx-auto max-w-xl">
          <div className="overlay-white flex gap-3 p-3 md:p-4">
            <div className="hidden aspect-[4/3] w-32 shrink-0 overflow-hidden rounded-xl bg-[#e4e4e7] sm:block md:w-40">
              {thumb ? (
                // eslint-disable-next-line @next/next/no-img-element -- a data: URL snapshot of the live canvas
                <img src={thumb} alt={`View from ${seatLabel(slot)}`} className="size-full object-cover" />
              ) : (
                <div className="flex size-full items-center justify-center">
                  <Loader2 className="size-5 animate-spin text-[#71717a]" />
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-[#52525b]">{event.title}</p>
              <p className="text-base font-bold md:text-lg">{vip ? "VIP Box · leather seats, glass front" : seatLabel(slot)}</p>
              {vip ? (
                <p className="mt-1 text-xs text-[#52525b]">VIP upgrades aren&apos;t on sale for this event yet. This is the view from the box.</p>
              ) : sel?.st && sel.st.kind !== "off" && sel.st.kind !== "taken" ? (
                <>
                  <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
                    <span className="num text-2xl font-extrabold">{formatUsd(sel.st.priceUsd ?? 0)}</span>
                    {sel.st.capUsd != null && sel.st.kind !== "outside" && <span className="text-xs text-[#52525b]">cap {formatUsd(sel.st.capUsd)}</span>}
                    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold text-white")} style={{ background: SEAT_COLORS[sel.st.kind] }}>
                      {KIND_TEXT[sel.st.kind]}
                    </span>
                  </div>
                  <p className="mt-1 flex items-start gap-1 text-xs text-[#3f3f46]">
                    <ShieldCheck className="mt-px size-3.5 shrink-0" aria-hidden />
                    {sel.st.kind === "outside"
                      ? "Your money is held in a vault until the ticket arrives. No ticket by the deadline, automatic refund."
                      : sel.st.kind === "resale"
                        ? "Ticket and money swap in one transaction, at or under the artist's cap."
                        : "Official ticket from the organizer. Gas paid by SeatSafe."}
                  </p>
                </>
              ) : (
                <p className="mt-1 text-xs text-[#52525b]">
                  {sel?.st?.kind === "taken" ? "Taken: someone already owns this seat." : "This seat isn't on sale. Pick a red, green or amber seat."}
                </p>
              )}
              <div className="mt-2 flex flex-wrap gap-2">
                {!vip && sel?.st && (sel.st.kind === "available" || sel.st.kind === "resale" || sel.st.kind === "outside") && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void buy()}
                    className="flex items-center gap-1.5 rounded-full bg-[#e5383b] px-4 py-2 text-sm font-bold text-white hover:brightness-110 disabled:opacity-60"
                  >
                    {busy ? <Loader2 className="size-4 animate-spin" /> : <TicketIcon className="size-4" />}
                    {sel.st.kind === "outside" ? "Buy with escrow" : "Buy"} · {formatUsd(sel.st.priceUsd ?? 0)}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => (focus && focus !== "VIP" ? toSection(focus) : toAerial())}
                  className="rounded-full border border-[#d4d4d8] px-4 py-2 text-sm font-semibold hover:bg-[#f4f4f5]"
                >
                  Another seat
                </button>
                {!vip && (
                  <button type="button" onClick={toVip} className="flex items-center gap-1 rounded-full border border-[#d4d4d8] px-4 py-2 text-sm font-semibold hover:bg-[#f4f4f5]">
                    <Crown className="size-4" /> Upgrade to VIP
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      {mode === "aerial" && !intro && (
        <p className="pointer-events-none absolute inset-x-0 bottom-3 z-20 text-center text-xs text-white/70">Hover a stand, click to fly in. Drag to look around.</p>
      )}
    </div>
  );
}
