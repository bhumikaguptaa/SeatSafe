"use client";

// Owner: A. One side of the trade (Sam the seller / Bea the buyer): avatar, role, wallet balance that
// counts up and down, and a slot for the ticket they hold.

import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { money, TONE, type Tone } from "@/lib/design";
import { useCountUp } from "./useCountUp";
import { cn } from "@/lib/utils";

export function Persona({
  name,
  role,
  initial,
  usdc,
  tone = "neutral",
  delta,
  children,
}: {
  name: string;
  role: string;
  initial: string;
  usdc: number;
  tone?: Tone;
  /** Last change, shown as a floating "+$20" / "-$14". */
  delta?: { amount: number; key: string } | null;
  children?: ReactNode;
}) {
  const reduced = useReducedMotion() ?? false;
  const shown = useCountUp(usdc, reduced);
  return (
    <div className={cn("relative flex w-full flex-col items-center rounded-3xl border bg-white/[0.06] p-4 backdrop-blur", TONE[tone].border, tone !== "neutral" && TONE[tone].glow)}>
      <div className="flex w-full items-center gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-white/30 to-white/5 text-lg font-bold">{initial}</span>
        <div className="min-w-0">
          <p className="truncate font-semibold">{name}</p>
          <p className="truncate text-xs text-white/60">{role}</p>
        </div>
      </div>
      <div className="relative mt-3 w-full rounded-2xl bg-black/30 px-3 py-2 text-center" title={`${name}'s wallet (devnet USDC, shown as dollars)`}>
        <p className="text-[11px] tracking-wide text-white/60 uppercase">Wallet</p>
        <p className="num text-2xl font-extrabold md:text-3xl" aria-label={`${name} has ${money(usdc)}`}>{money(shown)}</p>
        {delta && delta.amount !== 0 && (
          <motion.span
            key={delta.key}
            initial={reduced ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: [0, 1, 1, 0], y: [6, -10, -14, -22] }}
            transition={{ duration: 2.2 }}
            className={cn("num absolute -top-3 right-3 rounded-full px-2 py-0.5 text-sm font-bold", delta.amount > 0 ? "bg-released/25 text-released" : "bg-disputed/25 text-disputed")}
          >
            {delta.amount > 0 ? "+" : "−"}{money(Math.abs(delta.amount))}
          </motion.span>
        )}
      </div>
      <div className="mt-3 flex min-h-32 w-full items-center justify-center">{children}</div>
    </div>
  );
}
