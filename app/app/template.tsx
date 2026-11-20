"use client";

// Owner: D. Page transitions. A template re-mounts on every navigation, so its <ViewTransition> runs an exit
// animation on the old page and an enter animation on the new one (CSS: .page-exit / .page-enter in
// globals.css). It also spins the nav logo and sweeps a thin brand-gradient bar under the header.
// Browsers without the View Transitions API just swap pages instantly.

import { useEffect, ViewTransition, type ReactNode } from "react";
import { swivelLogo } from "@/lib/brand-motion";

export default function Template({ children }: { children: ReactNode }) {
  useEffect(() => {
    swivelLogo();
  }, []);
  return (
    <>
      <div aria-hidden className="page-sweep pointer-events-none fixed inset-x-0 top-14 z-50 h-[2px]" />
      <ViewTransition enter="page-enter" exit="page-exit" default="none">
        <div className="flex flex-1 flex-col">{children}</div>
      </ViewTransition>
    </>
  );
}
