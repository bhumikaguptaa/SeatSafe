"use client";

// Owner: A. Animates a number from its previous value to `value` (~0.8 s, ease-out). Reduced motion: instant.

import { useEffect, useRef, useState } from "react";

export function useCountUp(value: number, reduced: boolean, ms = 800): number {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const a = from.current;
    if (reduced || a === value) {
      from.current = value;
      const id = requestAnimationFrame(() => setShown(value));
      return () => cancelAnimationFrame(id);
    }
    const start = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / ms);
      setShown(a + (value - a) * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, reduced, ms]);
  return shown;
}
