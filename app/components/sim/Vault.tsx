"use client";

// Owner: A. The SeatSafe vault: a safe with a door that opens (paying out), stays shut (holding) or slams
// with a red flash (blocked attempt). The balance is what the program holds, not either person.

import { motion, useReducedMotion } from "motion/react";
import { Lock, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { MOTION, SHAKE_X, money } from "@/lib/design";
import { useCountUp } from "./useCountUp";
import { cn } from "@/lib/utils";

export type VaultState = "idle" | "holding" | "open" | "slammed";

export function Vault({ balance, state, label = "SeatSafe vault", children }: { balance: number; state: VaultState; label?: string; children?: ReactNode }) {
  const reduced = useReducedMotion() ?? false;
  const shown = useCountUp(balance, reduced);
  const slam = state === "slammed";
  return (
    <motion.div
      title="Held by the SeatSafe program on Solana, not by either person. Only the program's rules can release it."
      animate={slam && !reduced ? { x: SHAKE_X } : { x: 0 }}
      transition={MOTION.shake}
      className={cn(
        "relative flex w-44 flex-col items-center rounded-3xl border-2 bg-[#121218] p-4 md:w-56",
        slam ? "border-disputed glow-disputed" : state === "open" ? "border-released glow-released" : state === "holding" ? "border-vault glow-vault" : "border-white/20",
      )}
    >
      <p className="flex items-center gap-1 text-xs font-semibold tracking-wide text-white/80 uppercase">
        <ShieldCheck className="size-3.5 text-vault" aria-hidden /> {label}
      </p>
      {/* Door: rotates open like a safe; slams shut. */}
      <div className="relative mt-3 aspect-square w-full [perspective:600px]">
        <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-black/50">{children}</div>
        <motion.div
          className={cn(
            "absolute inset-0 flex origin-left items-center justify-center rounded-2xl border-2 bg-[#2a2a33]",
            slam ? "border-disputed" : "border-white/25",
          )}
          animate={{ rotateY: state === "open" ? -100 : 0 }}
          transition={reduced ? { duration: 0 } : slam ? { type: "spring", stiffness: 500, damping: 18 } : MOTION.dramatic}
          style={{ backfaceVisibility: "hidden" }}
          aria-hidden
        >
          <span className={cn("flex size-14 items-center justify-center rounded-full border-4", slam ? "border-disputed text-disputed" : "border-vault text-vault")}>
            <Lock className="size-6" />
          </span>
        </motion.div>
      </div>
      <p className="num mt-3 text-3xl font-extrabold md:text-4xl" aria-live="polite">{money(shown)}</p>
      <p className="text-[11px] text-white/60">{state === "open" ? "Paying out" : balance > 0 ? "Locked by the program" : "Empty"}</p>
    </motion.div>
  );
}
