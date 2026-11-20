"use client";

// Owner: D (full-screen gate pass; polish pass by A, approved override). A full-screen sheet with the seat label
// big, a "turn up your brightness" hint, and a QR that rotates every 15 s with a countdown ring.
// Real mode: the ticket comes from the logged-in wallet (getMyTickets, lib/chain.ts) and its event from the
// chain. Mock mode: lib/mock.ts tickets. The seat label is formatSeat() (one naming scheme app-wide).
// The QR payload is a DEMO token, not a security feature: a real pass needs a token signed by the server
// (or the owner's wallet) that the gate scanner verifies, plus an onchain ownership check.

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { ShieldCheck, SunMedium, X } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { getEvent, getMyTickets, seatLabel, USE_MOCK } from "@/lib/chain";
import { events as mockEvents, tickets as mockTickets } from "@/lib/mock";
import { useTxWallet } from "@/lib/tx";
import { useAsyncData } from "@/lib/use-chain";
import { formatDate } from "@/lib/format";
import { formatSeat } from "@/lib/seat-format";
import type { Event } from "@/lib/types";
import { Skeleton } from "@/components/ui/skeleton";
import { BrandMark } from "@/components/BrandMark";
import { AuthButton } from "@/components/AuthButton";

const ROTATE_MS = 15_000;

/** FNV-1a, hex. Only makes the demo token look different each window; not a signature. */
function demoHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function passToken(ticketId: string, slot: number): string {
  return `seatsafe://pass?t=${ticketId}&w=${slot}&demo=${demoHash(`${ticketId}:${slot}`)}`;
}

// 250 ms clock (smooth ring). Null on the server, so no QR is prerendered.
function subscribeClock(onTick: () => void) {
  const t = setInterval(onTick, 250);
  return () => clearInterval(t);
}
const getClock = () => Math.floor(Date.now() / 250) * 250;
const getServerClock = () => null;
function useClock(): number | null {
  return useSyncExternalStore(subscribeClock, getClock, getServerClock);
}

interface PassData {
  ticketId: string;
  seat: string;
  tier: 1 | 2;
  event: Event | null;
}

async function loadPass(id: string, owner: string | null): Promise<PassData | null> {
  if (USE_MOCK) {
    const t = mockTickets.find((x) => x.id === id);
    if (!t) return null;
    return { ticketId: t.id, seat: seatLabel(t), tier: t.tier, event: mockEvents.find((e) => e.id === t.eventId) ?? null };
  }
  if (!owner) return null;
  const mine = await getMyTickets(owner);
  const t = mine.find((x) => x.id === id);
  if (!t) return null;
  return { ticketId: t.id, seat: t.seatLabel, tier: t.tier, event: await getEvent(t.eventId).catch(() => null) };
}

/** Countdown ring around the QR: drains over 15 s. */
function Ring({ progress }: { progress: number }) {
  const r = 46;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 100 100" className="size-11 -rotate-90" aria-hidden>
      <circle cx="50" cy="50" r={r} fill="none" stroke="#26262E" strokeWidth="8" />
      <circle cx="50" cy="50" r={r} fill="none" stroke="#E5383B" strokeWidth="8" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - progress)} />
    </svg>
  );
}

export function GatePass() {
  const { id } = useParams<{ id: string }>();
  const wallet = useTxWallet();
  const owner = wallet?.address.toBase58() ?? null;
  const key = USE_MOCK ? `pass:mock:${id}` : owner ? `pass:${owner}:${id}` : null;
  const { data, loading } = useAsyncData(key, () => loadPass(id, owner));
  const now = useClock();

  const close = (
    <Link href="/tickets" aria-label="Close gate pass" className="absolute top-4 right-4 z-10 flex size-10 items-center justify-center rounded-full bg-[#15151B] text-white ring-1 ring-[#26262E] hover:bg-[#26262E]">
      <X className="size-5" />
    </Link>
  );

  if (!USE_MOCK && !owner) {
    return (
      <Sheet>
        {close}
        <div className="m-auto max-w-sm text-center">
          <BrandMark className="mx-auto mb-3 h-8" />
          <p className="font-semibold">Log in to show your gate pass</p>
          <div className="mt-4"><AuthButton /></div>
        </div>
      </Sheet>
    );
  }
  if (loading && !data) {
    return (
      <Sheet>
        <Skeleton className="m-auto h-[32rem] w-full max-w-sm rounded-3xl" />
      </Sheet>
    );
  }
  if (!data) {
    return (
      <Sheet>
        {close}
        <div className="m-auto max-w-sm text-center">
          <BrandMark className="mx-auto mb-3 h-8 opacity-70" />
          <p className="font-semibold">No pass for this ticket</p>
          <p className="mt-1 text-sm text-[#A1A1AA]">It isn&apos;t in this wallet, or it was resold.</p>
          <Link href="/tickets" className="mt-4 inline-block text-sm underline underline-offset-4">Back to my tickets</Link>
        </div>
      </Sheet>
    );
  }

  const seat = formatSeat(data.event, data.seat);
  const slot = now !== null ? Math.floor(now / ROTATE_MS) : null;
  const msLeft = now !== null ? ROTATE_MS - (now % ROTATE_MS) : null;

  return (
    <Sheet>
      {close}
      <div className="mx-auto flex w-full max-w-sm flex-1 flex-col items-center justify-center gap-5 py-6 text-center">
        <div className="flex items-center gap-2">
          <BrandMark className="h-6" />
          <span className="inline-flex items-center gap-1 rounded-full bg-released/15 px-2.5 py-0.5 text-xs font-semibold text-released">
            <ShieldCheck className="size-3.5" aria-hidden /> Protected
          </span>
        </div>
        <div>
          <h1 className="text-xl leading-tight font-bold text-white">{data.event?.title ?? "SeatSafe event"}</h1>
          {data.event && (
            <p className="mt-1 text-sm text-[#A1A1AA]">
              {formatDate(data.event.startsAt)} · {data.event.venue}
            </p>
          )}
        </div>

        <div className="w-full rounded-2xl bg-[#15151B] px-4 py-4 ring-1 ring-[#26262E]">
          <p className="text-xs font-semibold tracking-wider text-[#A1A1AA] uppercase">{seat.area}</p>
          <p className="mt-1 text-[28px] leading-tight font-extrabold tracking-tight text-white tabular-nums">
            {[seat.section && (seat.section === "VIP" ? "VIP" : `Sec ${seat.section}`), seat.row && `Row ${seat.row}`, seat.seat && `Seat ${seat.seat}`].filter(Boolean).join(" · ") || seat.label}
          </p>
        </div>

        <div className="relative flex size-72 items-center justify-center rounded-3xl bg-white p-4">
          {slot === null ? (
            <Skeleton className="size-full rounded-lg bg-black/10" />
          ) : (
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.div key={slot} initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
                <QRCodeSVG value={passToken(data.ticketId, slot)} size={240} level="M" bgColor="#ffffff" fgColor="#000000" title={`Gate pass: ${seat.label}`} />
              </motion.div>
            </AnimatePresence>
          )}
        </div>

        <div className="flex items-center gap-3">
          {msLeft !== null && <Ring progress={msLeft / ROTATE_MS} />}
          <p className="text-sm font-medium text-white tabular-nums" aria-live="polite">
            {msLeft === null ? "Loading pass…" : `New code in ${Math.ceil(msLeft / 1000)}s`}
          </p>
        </div>

        <p className="flex items-center gap-1.5 rounded-full bg-[#15151B] px-3 py-1.5 text-xs text-[#A1A1AA] ring-1 ring-[#26262E]">
          <SunMedium className="size-4 text-[#E5383B]" aria-hidden /> Turn up your brightness for the scanner
        </p>
        <p className="text-xs text-[#A1A1AA]">The code changes every 15 seconds, so screenshots won&apos;t get in.</p>
      </div>
    </Sheet>
  );
}

/** Full-screen sheet over the app chrome (header and tab bar stay underneath). */
function Sheet({ children }: { children: React.ReactNode }) {
  return <div className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-[#0B0B0F] px-5">{children}</div>;
}
