"use client";

// Owner: A. A small, subtle confetti burst for successful purchases: ≤ 30 particles, ~1.2 s, from the point the
// buyer clicked (or the centre). Nothing at all under prefers-reduced-motion. Mount <ConfettiHost /> once
// (app/layout.tsx) and call burst() after a buy lands.

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";

const EVENT = "seatsafe:confetti";
const COLORS = ["#E5383B", "#f16001", "#fe1c80", "#ffffff", "#22C55E"];
let lastPointer: { x: number; y: number } | null = null;

if (typeof window !== "undefined") {
  window.addEventListener("pointerdown", (e) => (lastPointer = { x: e.clientX, y: e.clientY }), { capture: true, passive: true });
}

/** Fire one burst at the last click position. */
export function burst() {
  if (typeof window === "undefined") return;
  const at = lastPointer ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  window.dispatchEvent(new CustomEvent(EVENT, { detail: at }));
}

interface Particle {
  id: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
  rot: number;
  color: string;
  w: number;
}

export function ConfettiHost() {
  const reduced = useReducedMotion();
  const [parts, setParts] = useState<Particle[]>([]);

  useEffect(() => {
    let seq = 0;
    const onBurst = (e: Event) => {
      if (reduced) return;
      const { x, y } = (e as CustomEvent<{ x: number; y: number }>).detail;
      const fresh = Array.from({ length: 28 }, (_, i): Particle => {
        const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.1;
        const speed = 90 + Math.random() * 150;
        return { id: ++seq, x, y, dx: Math.cos(angle) * speed, dy: Math.sin(angle) * speed, rot: (Math.random() - 0.5) * 540, color: COLORS[i % COLORS.length], w: 5 + Math.random() * 4 };
      });
      setParts((p) => [...p, ...fresh]);
      const ids = new Set(fresh.map((f) => f.id));
      setTimeout(() => setParts((p) => p.filter((q) => !ids.has(q.id))), 1400);
    };
    window.addEventListener(EVENT, onBurst);
    return () => window.removeEventListener(EVENT, onBurst);
  }, [reduced]);

  if (!parts.length) return null;
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[70] overflow-hidden">
      {parts.map((p) => (
        <motion.span
          key={p.id}
          className="absolute block rounded-[1px]"
          style={{ left: p.x, top: p.y, width: p.w, height: p.w * 0.45, background: p.color }}
          initial={{ x: 0, y: 0, opacity: 1, rotate: 0 }}
          animate={{ x: p.dx, y: [0, p.dy, p.dy + 160], opacity: [1, 1, 0], rotate: p.rot }}
          transition={{ duration: 1.2, ease: "easeOut", times: [0, 0.45, 1] }}
        />
      ))}
    </div>
  );
}
