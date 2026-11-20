"use client";

// Owner: D. Full-screen gate pass: ticket card + a QR that rotates every 10 s with a visible countdown.
// The event comes from useEvents(). The ticket itself is DEMO data seeded below, because lib/hooks.ts
// has no ticket hook yet. TODO(B): add useTicket(id) (real mode: getMyTickets() in lib/chain.ts).
// The QR payload is a DEMO token, not a security feature: a real pass needs a token signed by the
// server (or the owner's wallet) that the gate scanner verifies, plus an onchain ownership check.

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { ChevronLeft, ShieldCheck } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useEvents } from "@/lib/hooks";
import { formatDate } from "@/lib/format";
import type { Ticket } from "@/lib/types";
import { Skeleton } from "@/components/ui/skeleton";
import { GlassHero } from "@/components/GlassHero";
import { BrandMark } from "@/components/BrandMark";

const ROTATE_MS = 10_000;

// ---------------------------------------------------------------------------
// Demo data (replace with useTicket from lib/hooks.ts): the mock user's tickets.
// ---------------------------------------------------------------------------

const DEMO_TICKETS: Ticket[] = [
  { id: "tkt_01", eventId: "evt_neon_harbor", section: "GA", row: "-", seat: "-", tier: 1, ownerId: "user_me" },
  { id: "tkt_05", eventId: "evt_lila_vance", section: "Balcony", row: "F", seat: "22", tier: 2, ownerId: "user_me" },
  { id: "tkt_08", eventId: "evt_ut_am", section: "Student", row: "GA", seat: "-", tier: 1, ownerId: "user_me" },
];

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

// ---------------------------------------------------------------------------
// 1 s clock (same pattern as the order tracker). Null on the server, so no QR is prerendered.
// ---------------------------------------------------------------------------

function subscribeClock(onTick: () => void) {
  const t = setInterval(onTick, 1000);
  return () => clearInterval(t);
}
const getClock = () => Math.floor(Date.now() / 1000) * 1000;
const getServerClock = () => null;

function useNow(): number | null {
  return useSyncExternalStore(subscribeClock, getClock, getServerClock);
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

function SeatCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[13px] text-muted-foreground">{label}</p>
      <p className="truncate text-2xl font-bold tracking-tight">{value === "-" ? "—" : value}</p>
    </div>
  );
}

export function GatePass() {
  const { id } = useParams<{ id: string }>();
  const { events, loading } = useEvents();
  const now = useNow();

  const ticket = DEMO_TICKETS.find((t) => t.id === id) ?? null;
  const event = ticket ? (events.find((e) => e.id === ticket.eventId) ?? null) : null;

  if (loading) return <Skeleton className="mx-auto h-[36rem] w-full max-w-sm rounded-3xl" />;
  if (!ticket || !event) {
    return (
      <div className="mx-auto max-w-sm rounded-3xl glass p-6 text-center">
        <BrandMark className="mx-auto mb-3 h-8 opacity-70 grayscale-[35%]" />
        <p className="font-semibold">No pass for this ticket</p>
        <p className="mt-1 text-sm text-muted-foreground">It isn&apos;t one of your tickets, or it was resold.</p>
        <Link href="/tickets" className="mt-4 inline-block text-sm underline underline-offset-4">
          Back to my tickets
        </Link>
      </div>
    );
  }

  const slot = now !== null ? Math.floor(now / ROTATE_MS) : null;
  const secondsLeft = now !== null ? Math.ceil((ROTATE_MS - (now % ROTATE_MS)) / 1000) : null;

  return (
    <div className="mx-auto w-full max-w-sm">
      <Link
        href="/tickets"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" />
        My tickets
      </Link>

      <GlassHero as="article">
        {/* Event details on the brand gradient (black under the text, orange → pink to the right). */}
        <div className="bg-brand-side relative overflow-hidden p-5 pb-6">
          <div className="relative">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <BrandMark className="h-6" />
                <span className="rounded-full bg-pink-light px-2.5 py-0.5 text-xs font-semibold text-black">
                  {ticket.tier === 1 ? "SeatSafe ticket" : "Outside ticket"}
                </span>
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-black px-2.5 py-0.5 text-xs font-semibold text-white">
                <ShieldCheck className="size-3.5" />
                Protected
              </span>
            </div>
            <h1 className="mt-10 text-2xl leading-tight font-bold tracking-tight text-white">{event.title}</h1>
            <p className="mt-1 text-sm text-white/75">{formatDate(event.startsAt)}</p>
            <p className="text-sm text-white/75">
              {event.venue}, {event.city}
            </p>
          </div>
        </div>

        {/* Seat */}
        <div className="grid grid-cols-3 gap-3 p-5">
          <SeatCell label="Section" value={ticket.section} />
          <SeatCell label="Row" value={ticket.row} />
          <SeatCell label="Seat" value={ticket.seat} />
        </div>

        {/* Perforation */}
        <div aria-hidden className="relative flex items-center">
          <span className="absolute -left-3 size-6 rounded-full border border-border bg-background" />
          <span className="mx-5 w-full border-t border-dashed border-border" />
          <span className="absolute -right-3 size-6 rounded-full border border-border bg-background" />
        </div>

        {/* Rotating QR */}
        <div className="flex flex-col items-center p-5 pt-6">
          <div className="relative flex size-64 items-center justify-center rounded-2xl bg-white p-4">
            {slot === null ? (
              <Skeleton className="size-full rounded-lg bg-black/10" />
            ) : (
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.div
                  key={slot}
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.25 }}
                >
                  <QRCodeSVG
                    value={passToken(ticket.id, slot)}
                    size={224}
                    level="M"
                    bgColor="#ffffff"
                    fgColor="#000000"
                    title={`Gate pass for ${event.title}, section ${ticket.section}`}
                  />
                </motion.div>
              </AnimatePresence>
            )}
          </div>

          {/* Countdown: bar drains over 10 s, text counts down. */}
          <div className="mt-4 h-1.5 w-64 overflow-hidden rounded-full bg-muted">
            {secondsLeft !== null && (
              <motion.div
                className="h-full rounded-full bg-foreground"
                initial={false}
                animate={{ width: `${(secondsLeft / (ROTATE_MS / 1000)) * 100}%` }}
                transition={{ duration: secondsLeft === ROTATE_MS / 1000 ? 0 : 1, ease: "linear" }}
              />
            )}
          </div>
          <p className="mt-2 text-sm font-medium tabular-nums" aria-live="polite">
            {secondsLeft === null ? "Loading pass…" : `Refreshes in ${secondsLeft}s`}
          </p>
          <p className="mt-1 text-center text-xs text-muted-foreground">
            The code changes every 10 seconds, so screenshots won&apos;t get in. Show this screen at the gate.
          </p>
        </div>
      </GlassHero>
    </div>
  );
}
