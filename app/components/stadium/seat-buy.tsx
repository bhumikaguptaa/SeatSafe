"use client";

// Seat data + buy code for the 2D SeatMap (D). This is A's seat/buy code from the 3D StadiumPicker on
// a/stadium-full (PR #30, not merged), copied here with the buy logic unchanged: same seat data
// (lib/stadium-map.ts) and the same buy code (buy_primary / swap_resale / fund_escrow through useRunTx),
// plus the white ticket card. No three.js here.

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Check, Crown, Loader2, ShieldCheck, Ticket as TicketIcon } from "lucide-react";
import { PublicKey } from "@solana/web3.js";
import { buildLayout, mapSeats, seatCode, type SeatKind, type SeatSlot, type SeatState, type SectionId, type SectionLayout } from "@/lib/stadium-map";
import { chainProgram, USE_MOCK, type ChainListing } from "@/lib/chain";
import { buyPrimary, fundEscrow, swapResale } from "@/lib/program";
import { saveMeta } from "@/lib/event-meta";
import { mockTx, useRunTx } from "@/lib/tx";
import { formatUsd } from "@/lib/format";
import { formatSeat } from "@/lib/seat-format";
import { SEAT } from "@/lib/design";
import type { Event } from "@/lib/types";
import { CalendarLinks } from "@/components/AddToCalendar";
import { burst } from "@/components/Confetti";
import { mockSeatMix } from "@/lib/mock-seats"; // D: mock mode only, realistic seat mix

export type PickerEvent = Event & { supply?: number; sold?: number; priceUsd?: number };

export interface SeatPick {
  section: SectionId;
  index: number;
}

export const KIND_TEXT: Record<SeatKind, string> = {
  available: "Available · official",
  resale: "Protected resale",
  outside: "Outside ticket · Escrow protected",
  taken: "Taken",
  off: "Not on sale",
};

/** Seat colour per state (same values as the 3D scene's SEAT_COLORS). */
export const KIND_COLOR: Record<SeatKind, string> = {
  available: SEAT.official,
  resale: SEAT.resale,
  outside: SEAT.outside,
  taken: SEAT.taken,
  off: SEAT.off,
};

/** Readable text on each seat colour: black on the light ones (green, yellow), white on red and blue. */
export const KIND_TEXT_COLOR: Record<SeatKind, string> = {
  available: "#ffffff",
  resale: "#000000",
  outside: "#000000",
  taken: "#ffffff",
  off: "#ffffff",
};

/** Seat layout + per-seat states for an event, including onchain seat codes of minted tickets. */
export function useStadiumStates(event: PickerEvent, listings: ChainListing[]) {
  const [seatByMint, setSeatByMint] = useState<Map<string, string>>(new Map());

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
  const states = useMemo(() => {
    const mapped = mapSeats(layout, {
        eventId: event.id,
        programId: USE_MOCK ? null : chainProgram().programId,
        supply: event.supply ?? 120,
        sold: event.sold ?? (USE_MOCK ? 40 : 0),
        priceUsd: event.priceUsd ?? event.priceFromUsd,
        capUsd: event.resaleCapUsd,
        resale: listings.filter((l) => l.tier === 1 && l.ticketMint).map((l) => ({ ticketMint: l.ticketMint!, listingId: l.id, priceUsd: l.priceUsd, sellerName: l.sellerName })),
        outside: listings.filter((l) => l.tier === 2 && l.escrow).map((l) => ({ escrow: l.escrow!, priceUsd: l.priceUsd, bondUsd: l.bondUsd, sellerName: l.sellerName })),
        seatByMint,
      });
    // Mock mode only: a realistic mix of official / resale / outside / taken seats (lib/mock-seats.ts).
    return USE_MOCK ? mockSeatMix(layout, mapped, { id: event.id, priceUsd: event.priceUsd ?? event.priceFromUsd, capUsd: event.resaleCapUsd }) : mapped;
  }, [layout, event, listings, seatByMint]);
  return { layout, byId, states, loadRecords } as {
    layout: SectionLayout[];
    byId: Map<SectionId, SectionLayout>;
    states: Map<SectionId, SeatState[]>;
    loadRecords: () => Promise<void>;
  };
}

/**
 * The buy step for a picked seat: red available → buy_primary (seat code stored onchain), green resale →
 * swap_resale, yellow outside → fund_escrow → /orders/<escrow>. Resolves true when a primary or resale buy
 * landed (the caller then refreshes); the outside path navigates to the order and resolves false.
 */
export function useSeatBuy(event: PickerEvent) {
  const router = useRouter();
  const { run } = useRunTx();
  const [busy, setBusy] = useState(false);
  /** Briefly true after a buy lands: the button shows a check. */
  const [done, setDone] = useState(false);
  const celebrate = () => {
    burst();
    setDone(true);
    setTimeout(() => setDone(false), 2500);
  };

  const buy = async (slot: SeatSlot, st: SeatState): Promise<boolean> => {
    setBusy(true);
    const calendar = <CalendarLinks event={event} />;
    let okBuy = false;
    if (st.kind === "available") {
      const opts = { pending: "Confirming on Solana…", success: `You're in! ${formatSeat(event, { stand: slot.section, row: slot.row, seat: slot.seat }).label}`, successExtra: calendar };
      okBuy = USE_MOCK ? await mockTx(opts) : (await run((ctx) => buyPrimary(ctx, { event: new PublicKey(event.id), seat: seatCode(slot) }), opts)) !== null;
    } else if (st.kind === "resale" && st.ticketMint) {
      const opts = { pending: "Confirming on Solana…", success: "Ticket bought! It's in My tickets.", successExtra: calendar };
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
      return false;
    }
    setBusy(false);
    if (okBuy) celebrate();
    return okBuy;
  };

  return { busy, done, buy };
}

/** The white ticket card shown when a seat is picked (3D and 2D). `thumbnail` fills the left box. */
export function TicketCard({
  event,
  slot,
  st,
  vip,
  thumbnail,
  busy,
  done = false,
  onBuy,
  onAnother,
  onVip,
  showThumbnail = true,
}: {
  event: PickerEvent;
  slot: SeatSlot;
  st: SeatState | undefined;
  vip: boolean;
  thumbnail: ReactNode;
  busy: boolean;
  /** The buy just landed: show a check. */
  done?: boolean;
  onBuy: () => void;
  onAnother: () => void;
  onVip: () => void;
  /** Hide the left thumbnail box (narrow containers, e.g. the listings column). */
  showThumbnail?: boolean;
}) {
  return (
    <div className="overlay-white flex gap-3 p-3 ring-1 ring-black/5 md:p-4">
      {showThumbnail && <div className="hidden aspect-[4/3] w-32 shrink-0 overflow-hidden rounded-xl bg-[#ececef] sm:block md:w-40">{thumbnail}</div>}
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-[#52525b]">{event.title}</p>
        <p className="text-base font-bold md:text-lg">{vip ? "VIP Box · leather seats, glass front" : formatSeat(event, { stand: slot.section, row: slot.row, seat: slot.seat }).label}</p>
        {vip ? (
          <p className="mt-1 text-xs text-[#52525b]">VIP upgrades aren&apos;t on sale for this event yet. This is the view from the box.</p>
        ) : st && st.kind !== "off" && st.kind !== "taken" ? (
          <>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
              <span className="num text-2xl font-extrabold">{formatUsd(st.priceUsd ?? 0)}</span>
              {st.capUsd != null && st.kind !== "outside" && <span className="text-xs text-[#52525b]">cap {formatUsd(st.capUsd)}</span>}
              <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: KIND_COLOR[st.kind], color: KIND_TEXT_COLOR[st.kind] }}>
                {KIND_TEXT[st.kind]}
              </span>
            </div>
            <p className="mt-1 flex items-start gap-1 text-xs text-[#3f3f46]">
              <ShieldCheck className="mt-px size-3.5 shrink-0" aria-hidden />
              {st.kind === "outside"
                ? "Your money is held in a vault until the ticket arrives. No ticket by the deadline, automatic refund."
                : st.kind === "resale"
                  ? "Ticket and money swap in one transaction, at or under the artist's cap."
                  : "Official ticket from the organizer. Gas paid by SeatSafe."}
            </p>
          </>
        ) : (
          <p className="mt-1 text-xs text-[#52525b]">
            {st?.kind === "taken" ? "Taken: someone already owns this seat." : "This seat isn't on sale. Pick a red, green or yellow seat."}
          </p>
        )}
        <div className="mt-2 flex flex-wrap gap-2">
          {!vip && st && (st.kind === "available" || st.kind === "resale" || st.kind === "outside") && (
            <button
              type="button"
              disabled={busy || done}
              onClick={onBuy}
              aria-live="polite"
              className="btn-gradient flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-bold text-black hover:brightness-110 disabled:opacity-60"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : done ? <Check className="size-4" /> : <TicketIcon className="size-4" />}
              {busy ? "Confirming on Solana…" : done ? "You're in!" : <>{st.kind === "outside" ? "Buy with escrow" : "Buy"} · {formatUsd(st.priceUsd ?? 0)}</>}
            </button>
          )}
          <button type="button" onClick={onAnother} className="rounded-full border border-[#d4d4d8] px-4 py-2 text-sm font-semibold hover:bg-[#f4f4f5]">
            Another seat
          </button>
          {!vip && (
            <button
              type="button"
              onClick={onVip}
              className="flex items-center gap-1 rounded-full border border-[#fe1c80] px-4 py-2 text-sm font-semibold text-[#b8005a] hover:bg-[#ffe3f1]"
            >
              <Crown className="size-4" /> Upgrade to VIP
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
