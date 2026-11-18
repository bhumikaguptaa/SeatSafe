// Owner: A. Design tokens shared by the simulator and the polished screens. Colours are the theme tokens in
// app/globals.css (one meaning each); this file adds motion timing and the meaning → class map, so every
// component animates and colours the same way.
//
//   vault / escrow / "held by the program"  -> blue   (text-vault, bg-vault, glow-vault)
//   released / refunded / success           -> green  (released)
//   in transit / pending / waiting          -> amber  (transit)
//   blocked / scam / rejected               -> red    (disputed)

import type { Transition } from "motion/react";

/** "Stadium night" palette (Nov 19): solid surfaces, white floating overlays, one red accent. Mirrors
 *  the .dark tokens in globals.css; the 3D stadium uses these values directly. */
export const COLORS = {
  background: "#0B0B0F",
  surface: "#15151B",
  border: "#26262E",
  overlay: "#FFFFFF",
  overlayText: "#0B0B0F",
  accent: "#E5383B",
  vault: "#3B82F6",
  released: "#22C55E",
  pending: "#F59E0B",
  blocked: "#EF4444",
} as const;

export const DURATION = { fast: 0.15, standard: 0.3, dramatic: 0.8 } as const;

export const MOTION = {
  fast: { duration: DURATION.fast, ease: "easeOut" } satisfies Transition,
  standard: { duration: DURATION.standard, ease: [0.2, 0.8, 0.2, 1] } satisfies Transition,
  /** Coins and tickets flying, vault door: springy and big. */
  dramatic: { type: "spring", stiffness: 70, damping: 14, mass: 0.9 } satisfies Transition,
  /** A rejection shake. */
  shake: { duration: 0.5, ease: "easeInOut" } satisfies Transition,
} as const;

export const SHAKE_X = [0, -14, 12, -10, 8, -4, 0];

export type Tone = "vault" | "released" | "transit" | "disputed" | "neutral";

/** Tailwind classes per meaning (text, soft background, border, glow utility from globals.css). */
export const TONE: Record<Tone, { text: string; soft: string; border: string; glow: string; dot: string }> = {
  vault: { text: "text-vault", soft: "bg-vault/15", border: "border-vault/50", glow: "glow-vault", dot: "bg-vault" },
  released: { text: "text-released", soft: "bg-released/15", border: "border-released/50", glow: "glow-released", dot: "bg-released" },
  transit: { text: "text-transit", soft: "bg-transit/15", border: "border-transit/50", glow: "glow-transit", dot: "bg-transit" },
  disputed: { text: "text-disputed", soft: "bg-disputed/15", border: "border-disputed/50", glow: "glow-disputed", dot: "bg-disputed" },
  neutral: { text: "text-foreground", soft: "bg-white/5", border: "border-white/15", glow: "", dot: "bg-white/60" },
};

/** "$1,240.50" with tabular digits; whole dollars without cents. */
export function money(n: number): string {
  const whole = Math.abs(n - Math.round(n)) < 0.005;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 })}`;
}
