"use client";

// Owner: D. Animated wireframe wave behind every page (after inspo 7-wave-background): a perspective grid of
// thin lines with a small glowing dot at every intersection, slowly rolling like terrain / fabric.
// Lines: faint white. Dots: soft orange / pink glow. Fades into black at the top and the edges.
// Canvas 2D (no three.js on every page). Capped at 30 fps, paused while the tab is hidden, a single still
// frame under prefers-reduced-motion, and nothing at all (plain black page) if canvas is unavailable.

import { useEffect, useRef } from "react";

const ORANGE = "232, 80, 2";
const PINK = "254, 28, 128";
const FPS = 30;

/** A small radial glow sprite (drawn once, then stamped per dot: much cheaper than shadowBlur). */
function glowSprite(rgb: string, size = 32): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const r = size / 2;
  const grd = g.createRadialGradient(r, r, 0, r, r, r);
  grd.addColorStop(0, "rgba(255, 255, 255, 1)");
  grd.addColorStop(0.16, `rgba(${rgb}, 1)`);
  grd.addColorStop(0.45, `rgba(${rgb}, 0.32)`);
  grd.addColorStop(1, `rgba(${rgb}, 0)`);
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  return c;
}

/** Rolling terrain height at (x, z), time t (world units). */
function height(x: number, z: number, t: number): number {
  return (
    0.55 * Math.sin(x * 1.3 + t * 0.6) * Math.cos(z * 0.9 - t * 0.35) +
    0.35 * Math.sin((x + z) * 0.8 - t * 0.45) +
    0.2 * Math.cos(x * 2.1 - z * 1.4 + t * 0.3)
  );
}

export function WaveBackground() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return; // no canvas: the page stays plain black

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const glowOrange = glowSprite(ORANGE);
    const glowPink = glowSprite(PINK);

    let w = 0;
    let h = 0;
    let cols = 0;
    let rows = 0;
    let sx = new Float32Array(0);
    let sy = new Float32Array(0);

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const small = w < 640;
      cols = small ? 26 : 46;
      rows = small ? 20 : 28;
      sx = new Float32Array(cols * rows);
      sy = new Float32Array(cols * rows);
    };

    const X = 7; // half-width of the grid (world units)
    const Z_NEAR = 1.15;
    const Z_FAR = 13;
    const CAM_Y = 2.3;

    const draw = (t: number) => {
      ctx.clearRect(0, 0, w, h);
      const fov = Math.min(w, h * 1.6) * 0.85;
      const horizon = h * 0.3;

      // Project every grid point.
      for (let r = 0; r < rows; r++) {
        const z = Z_NEAR + ((Z_FAR - Z_NEAR) * r) / (rows - 1);
        for (let c = 0; c < cols; c++) {
          const x = -X + (2 * X * c) / (cols - 1);
          const y = height(x * 0.45, z * 0.45, t) * 2; // tall enough to read as rolling terrain
          const i = r * cols + c;
          sx[i] = w / 2 + (x / z) * fov;
          sy[i] = horizon + ((CAM_Y - y) / z) * fov;
        }
      }

      // Lines: one path for every row and column (a single stroke call).
      ctx.beginPath();
      for (let r = 0; r < rows; r++) {
        ctx.moveTo(sx[r * cols], sy[r * cols]);
        for (let c = 1; c < cols; c++) ctx.lineTo(sx[r * cols + c], sy[r * cols + c]);
      }
      for (let c = 0; c < cols; c++) {
        ctx.moveTo(sx[c], sy[c]);
        for (let r = 1; r < rows; r++) ctx.lineTo(sx[r * cols + c], sy[r * cols + c]);
      }
      ctx.strokeStyle = "rgba(255, 255, 255, 0.13)";
      ctx.lineWidth = 1;
      ctx.stroke();

      // Dots: glow sprites, bigger and brighter up close; orange / pink in slow-moving bands.
      for (let r = 0; r < rows; r++) {
        const depth = r / (rows - 1);
        const size = 14 - 9.5 * depth;
        const alpha = 0.85 * Math.pow(1 - depth, 1.1) + 0.08;
        const z = Z_NEAR + (Z_FAR - Z_NEAR) * depth;
        for (let c = 0; c < cols; c++) {
          const i = r * cols + c;
          const px = sx[i];
          const py = sy[i];
          if (px < -size || px > w + size || py < -size || py > h + size) continue;
          const x = -X + (2 * X * c) / (cols - 1);
          const band = Math.sin(x * 0.5 + z * 0.35 + t * 0.25);
          ctx.globalAlpha = alpha;
          ctx.drawImage(band > 0 ? glowPink : glowOrange, px - size / 2, py - size / 2, size, size);
        }
      }
      ctx.globalAlpha = 1;

      // Fade to black at the top and around the edges, so content stays easy to read.
      const top = ctx.createLinearGradient(0, 0, 0, h * 0.62);
      top.addColorStop(0, "rgba(0, 0, 0, 1)");
      top.addColorStop(0.45, "rgba(0, 0, 0, 0.75)");
      top.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = top;
      ctx.fillRect(0, 0, w, h);
      const vignette = ctx.createRadialGradient(w / 2, h * 0.7, Math.min(w, h) * 0.15, w / 2, h * 0.7, Math.max(w, h) * 0.85);
      vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
      vignette.addColorStop(1, "rgba(0, 0, 0, 0.9)");
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, w, h);
    };

    const STILL_T = 4.2; // a nice-looking frame for reduced motion / resize while paused
    let raf = 0;
    let last = 0;
    let running = false;
    const t0 = performance.now();

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (now - last < 1000 / FPS) return;
      last = now;
      draw(STILL_T + ((now - t0) / 1000) * 0.6);
    };
    const start = () => {
      if (running || reduce.matches || document.hidden) return;
      running = true;
      raf = requestAnimationFrame(frame);
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(raf);
    };

    const onVisibility = () => (document.hidden ? stop() : start());
    const onResize = () => {
      resize();
      if (!running) draw(STILL_T);
    };
    const onMotionPref = () => {
      if (reduce.matches) {
        stop();
        draw(STILL_T);
      } else start();
    };

    resize();
    draw(STILL_T);
    start();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("resize", onResize);
    reduce.addEventListener("change", onMotionPref);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("resize", onResize);
      reduce.removeEventListener("change", onMotionPref);
    };
  }, []);

  // Fixed behind all content (above the body's black ::before at z-index -2), low opacity.
  return <canvas ref={ref} aria-hidden className="pointer-events-none fixed inset-0 h-full w-full opacity-70" style={{ zIndex: -1 }} />;
}
