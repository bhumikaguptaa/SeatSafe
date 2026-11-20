import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// Owner: D. Siri-style colour burst around the "Scan to buy" frame (styles: .scan-aura in app/globals.css).
// "scanning" = flowing orange / pink / red glow that pulses on the edges; "burst" = a one-shot bright flare
// (a code was read / the offer just appeared). Purely visual: the scanner and buy logic are untouched.

export function ScanAura({
  state = "scanning",
  className,
  children,
}: {
  state?: "scanning" | "burst";
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("scan-aura rounded-2xl", className)} data-state={state}>
      {children}
    </div>
  );
}
