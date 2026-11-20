"use client";

// Owner: A. A ticket with a visible padlock: locked (frozen Token-2022: only SeatSafe can move it),
// unlocking (mid-swap), unlocked. Outside tickets (Tier 2) have no padlock: SeatSafe can't see them.

import { motion, useReducedMotion } from "motion/react";
import { FileText, Lock, LockOpen, Ticket } from "lucide-react";
import { MOTION, money } from "@/lib/design";
import { cn } from "@/lib/utils";

export type LockState = "locked" | "unlocking" | "unlocked";

export function TicketCard({
  event,
  seat,
  price,
  lock = "locked",
  outside = false,
  glow = false,
  size = "md",
  className,
}: {
  event: string;
  seat: string;
  price?: number;
  lock?: LockState;
  /** Tier 2: a ticket from another platform (no padlock). */
  outside?: boolean;
  glow?: boolean;
  size?: "sm" | "md";
  className?: string;
}) {
  const reduced = useReducedMotion();
  const locked = lock === "locked";
  const tip = outside
    ? "An outside ticket (e.g. a PDF from another site). SeatSafe can't see it, so the money waits in the vault instead."
    : locked
      ? "Locked: this ticket is frozen on Solana. Only the SeatSafe program can move it, so it can't be sold around the price cap."
      : "Unlocked for a moment while SeatSafe moves it, then frozen again.";
  return (
    <div
      title={tip}
      className={cn(
        "relative overflow-hidden rounded-2xl border bg-secondary text-left",
        outside ? "border-transit/50" : locked ? "border-vault/50" : "border-released/60",
        glow && (outside ? "glow-transit" : locked ? "glow-vault" : "glow-released"),
        size === "sm" ? "w-36 p-2.5" : "w-48 p-3.5",
        className,
      )}
    >
      {/* perforation */}
      <span className="absolute top-1/2 -left-2 size-4 -translate-y-1/2 rounded-full bg-background" aria-hidden />
      <span className="absolute top-1/2 -right-2 size-4 -translate-y-1/2 rounded-full bg-background" aria-hidden />
      <div className="flex items-start justify-between gap-2">
        {outside ? <FileText className="size-4 text-transit" aria-hidden /> : <Ticket className="size-4 text-vault" aria-hidden />}
        {!outside && (
          <motion.span
            key={lock}
            initial={reduced ? false : { scale: 0.6, rotate: lock === "unlocking" ? -20 : 0 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={MOTION.dramatic}
            className={cn("flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold", locked ? "bg-vault/20 text-vault" : "bg-released/20 text-released")}
          >
            {locked ? <Lock className="size-3" aria-hidden /> : <LockOpen className="size-3" aria-hidden />}
            {locked ? "Locked" : "Moving"}
          </motion.span>
        )}
        {outside && <span className="rounded-full bg-transit/20 px-1.5 py-0.5 text-[10px] font-semibold text-transit">Outside</span>}
      </div>
      <p className={cn("mt-2 truncate font-semibold", size === "sm" ? "text-xs" : "text-sm")}>{event}</p>
      <p className="truncate text-xs text-white/70">{seat}</p>
      {price != null && <p className={cn("num mt-1 font-bold", size === "sm" ? "text-sm" : "text-lg")}>{money(price)}</p>}
    </div>
  );
}
