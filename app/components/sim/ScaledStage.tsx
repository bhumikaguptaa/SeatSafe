"use client";

// Owner: D. The simulator stage is designed at 900 px; on narrower columns it scales down as a whole
// (flights use % so they still line up). Shared by the live and simulated labs.

import { useEffect, useRef, useState, type ReactNode } from "react";

export const STAGE_W = 900;

/**
 * When scaled, the inner box is absolutely positioned, so its fixed 900px width can't widen the
 * surrounding grid column. (In flow it did: the column grew to 900px, which turned scaling off, which
 * shrank the column again, a resize loop that made the page flicker several times a second.)
 */
export function ScaledStage({ children }: { children: ReactNode }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ scale: 1, height: 0 });

  useEffect(() => {
    const o = outer.current;
    const i = inner.current;
    if (!o || !i) return;
    const ro = new ResizeObserver(() => {
      const scale = Math.min(1, o.clientWidth / STAGE_W);
      const height = Math.round(i.offsetHeight * scale);
      // Skip no-op updates (sub-pixel noise) so a resize can't keep re-rendering the stage.
      setBox((b) => (Math.abs(b.scale - scale) < 0.001 && b.height === height ? b : { scale, height }));
    });
    ro.observe(o);
    ro.observe(i);
    return () => ro.disconnect();
  }, []);

  const scaled = box.scale < 1;
  return (
    <div ref={outer} className="relative w-full min-w-0 overflow-hidden" style={scaled ? { height: box.height } : undefined}>
      <div
        ref={inner}
        style={
          scaled
            ? { position: "absolute", top: 0, left: 0, width: STAGE_W, transform: `scale(${box.scale})`, transformOrigin: "top left" }
            : undefined
        }
      >
        {children}
      </div>
    </div>
  );
}
