"use client";

// Owner: A. A USDC coin with its dollar amount, and Flight: a coin (or any child) flying across the
// simulator stage between two points given in % of the stage box. Reduced motion: appears at the end.

import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { MOTION, money, TONE, type Tone } from "@/lib/design";
import { cn } from "@/lib/utils";

export function Coin({ amount, tone = "vault", label, className }: { amount: number; tone?: Tone; label?: string; className?: string }) {
  return (
    <span
      title={label ?? `${money(amount)} in USDC (a digital dollar)`}
      className={cn("inline-flex flex-col items-center gap-0.5", className)}
    >
      <span
        className={cn(
          "num flex size-12 items-center justify-center rounded-full border-2 text-xs font-extrabold shadow-lg md:size-14 md:text-sm",
          "bg-gradient-to-br from-[#5ba3ff] to-[#1f5fd6] text-white",
          TONE[tone].border,
          TONE[tone].glow,
        )}
      >
        {money(amount)}
      </span>
      {label && <span className="rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap text-white">{label}</span>}
    </span>
  );
}

export interface Point {
  x: number; // % of stage width
  y: number; // % of stage height
}

export function Flight({
  from,
  to,
  delay = 0,
  children,
  onDone,
  arc = -12,
}: {
  from: Point;
  to: Point;
  delay?: number;
  children: ReactNode;
  onDone?: () => void;
  /** Vertical lift at the midpoint (% of stage height); negative = up. */
  arc?: number;
}) {
  const reduced = useReducedMotion();
  const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 + arc };
  return (
    <motion.div
      className="pointer-events-none absolute z-30 -translate-x-1/2 -translate-y-1/2"
      initial={reduced ? { left: `${to.x}%`, top: `${to.y}%`, opacity: 1 } : { left: `${from.x}%`, top: `${from.y}%`, opacity: 0, scale: 0.6 }}
      animate={
        reduced
          ? { left: `${to.x}%`, top: `${to.y}%`, opacity: 1 }
          : { left: [`${from.x}%`, `${mid.x}%`, `${to.x}%`], top: [`${from.y}%`, `${mid.y}%`, `${to.y}%`], opacity: [0, 1, 1], scale: [0.6, 1.15, 1] }
      }
      transition={reduced ? { duration: 0 } : { duration: 1.1, delay, ease: [0.45, 0, 0.2, 1], times: [0, 0.5, 1] }}
      onAnimationComplete={onDone}
    >
      {children}
    </motion.div>
  );
}

export { MOTION };
