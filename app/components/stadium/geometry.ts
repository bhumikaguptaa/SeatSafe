// Owner: A. Procedural stadium geometry for the 3D picker (no external models; Blender wasn't available).
// Units: metres. Pitch 105 × 68 centred at the origin, long axis along x. θ: degrees, 0 = +x,
// counter-clockwise seen from above (world z = −sin θ).

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { innerRadius, type SectionDef, type SeatSlot } from "@/lib/stadium-map";

export const ROW_DEPTH = 0.85;
export const ROW_RISE = 0.42;

export function baseHeight(tier: SectionDef["tier"]): number {
  return tier === "upper" ? 10.5 : tier === "vip" ? 7.2 : 0.9;
}

export function polar(thetaDeg: number, radius: number, y: number): THREE.Vector3 {
  const t = (thetaDeg * Math.PI) / 180;
  return new THREE.Vector3(radius * Math.cos(t), y, -radius * Math.sin(t));
}

/** World position of a seat (its pan), plus the yaw that faces the pitch centre. */
export function seatTransform(def: SectionDef, s: Pick<SeatSlot, "row" | "theta">): { pos: THREE.Vector3; yaw: number } {
  const r = innerRadius(s.theta, def.tier) + (s.row - 1) * ROW_DEPTH + ROW_DEPTH * 0.45;
  const y = baseHeight(def.tier) + (s.row - 1) * ROW_RISE + 0.45;
  const pos = polar(s.theta, r, y);
  return { pos, yaw: Math.atan2(-pos.x, -pos.z) };
}

/** Eye position for "view from this seat": seated eye height, nudged forward. */
export function seatEye(def: SectionDef, s: Pick<SeatSlot, "row" | "theta">): THREE.Vector3 {
  const { pos } = seatTransform(def, s);
  const toCentre = new THREE.Vector3(-pos.x, 0, -pos.z).normalize();
  return pos.clone().add(new THREE.Vector3(0, 0.75, 0)).add(toCentre.multiplyScalar(0.15));
}

/** A low-poly stadium seat (pan + back), front facing +z. ~36 triangles; drawn instanced. */
export function seatGeometry(): THREE.BufferGeometry {
  const pan = new THREE.BoxGeometry(0.46, 0.07, 0.42);
  pan.translate(0, 0, 0.02);
  const back = new THREE.BoxGeometry(0.46, 0.44, 0.06);
  back.rotateX(-0.12);
  back.translate(0, 0.24, -0.2);
  const g = mergeGeometries([pan, back])!;
  g.computeVertexNormals();
  return g;
}

/** Stepped concrete terrace for a section: treads + risers per row, a back wall and a front wall. */
export function terraceGeometry(def: SectionDef, segments = 28): THREE.BufferGeometry {
  const pos: number[] = [];
  const quad = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3) => {
    pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, a.x, a.y, a.z, c.x, c.y, c.z, d.x, d.y, d.z);
  };
  const base = baseHeight(def.tier);
  for (let i = 0; i < segments; i++) {
    const t0 = def.from + ((def.to - def.from) * i) / segments;
    const t1 = def.from + ((def.to - def.from) * (i + 1)) / segments;
    const r00 = innerRadius(t0, def.tier);
    const r10 = innerRadius(t1, def.tier);
    for (let r = 0; r < def.rows; r++) {
      const y = base + r * ROW_RISE;
      const a0 = r00 + r * ROW_DEPTH, a1 = r10 + r * ROW_DEPTH;
      const b0 = a0 + ROW_DEPTH, b1 = a1 + ROW_DEPTH;
      // tread
      quad(polar(t0, a0, y), polar(t1, a1, y), polar(t1, b1, y), polar(t0, b0, y));
      // riser up to the next row
      quad(polar(t0, b0, y), polar(t1, b1, y), polar(t1, b1, y + ROW_RISE), polar(t0, b0, y + ROW_RISE));
    }
    const top = base + def.rows * ROW_RISE;
    const outer0 = r00 + def.rows * ROW_DEPTH, outer1 = r10 + def.rows * ROW_DEPTH;
    // back wall (outside of the bowl) down to the ground
    quad(polar(t0, outer0, top + 1.2), polar(t1, outer1, top + 1.2), polar(t1, outer1, 0), polar(t0, outer0, 0));
    // front wall (pitch side)
    quad(polar(t0, r00, base), polar(t1, r10, base), polar(t1, r10, def.tier === "lower" ? 0 : base - 2.4), polar(t0, r00, def.tier === "lower" ? 0 : base - 2.4));
    if (def.tier !== "lower") {
      // underside of the upper tier / VIP box
      quad(polar(t0, r00, base - 2.4), polar(t1, r10, base - 2.4), polar(t1, outer1, base - 2.4), polar(t0, outer0, base - 2.4));
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** Roof canopy: a ring of cantilevered panels above the bowl. */
export function roofGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const seg = 120;
  for (let i = 0; i < seg; i++) {
    const t0 = (360 * i) / seg, t1 = (360 * (i + 1)) / seg;
    const in0 = innerRadius(t0, "upper") + 1, in1 = innerRadius(t1, "upper") + 1;
    const out0 = innerRadius(t0, "upper") + 15, out1 = innerRadius(t1, "upper") + 15;
    const a = polar(t0, in0, 24.5), b = polar(t1, in1, 24.5), c = polar(t1, out1, 26), d = polar(t0, out0, 26);
    pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, a.x, a.y, a.z, c.x, c.y, c.z, d.x, d.y, d.z);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** Mowed-stripe grass with white line markings, drawn on a canvas (CanvasTexture). */
export function pitchTexture(): THREE.CanvasTexture {
  const W = 2048, H = 1326; // 105 × 68 at ~19.5 px/m
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  const stripes = 18;
  for (let i = 0; i < stripes; i++) {
    g.fillStyle = i % 2 ? "#2f6b2a" : "#367a30";
    g.fillRect((W * i) / stripes, 0, W / stripes + 1, H);
  }
  // subtle noise
  const img = g.getImageData(0, 0, W, H);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 14;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n * 0.5;
  }
  g.putImageData(img, 0, 0);
  const m = W / 105; // px per metre
  g.strokeStyle = "rgba(255,255,255,0.92)";
  g.lineWidth = 0.12 * m * 1.4;
  const X = (x: number) => W / 2 + x * m;
  const Z = (z: number) => H / 2 + z * m;
  const pad = 0.6;
  g.strokeRect(X(-52.5 + pad), Z(-34 + pad), (105 - 2 * pad) * m, (68 - 2 * pad) * m);
  g.beginPath();
  g.moveTo(X(0), Z(-34 + pad));
  g.lineTo(X(0), Z(34 - pad));
  g.stroke();
  g.beginPath();
  g.arc(X(0), Z(0), 9.15 * m, 0, Math.PI * 2);
  g.stroke();
  for (const side of [-1, 1]) {
    const gx = side * (52.5 - pad);
    g.strokeRect(side < 0 ? X(gx) : X(gx - 16.5), Z(-20.16), 16.5 * m, 40.32 * m);
    g.strokeRect(side < 0 ? X(gx) : X(gx - 5.5), Z(-9.16), 5.5 * m, 18.32 * m);
    g.beginPath();
    g.arc(X(side * (52.5 - 11 - pad)), Z(0), 0.3 * m, 0, Math.PI * 2);
    g.fillStyle = "white";
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Deterministic pseudo-random (so trees/buildings don't jump between renders). */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Tree positions in a ring around the stadium, avoiding the four approach roads. */
export function treePositions(count: number): THREE.Vector3[] {
  const r = rng(7);
  const out: THREE.Vector3[] = [];
  while (out.length < count) {
    const a = r() * Math.PI * 2;
    const d = 118 + r() * 170;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (Math.abs(x) < 9 || Math.abs(z) < 9) continue; // roads on the axes
    out.push(new THREE.Vector3(x, 0, z));
  }
  return out;
}

/** Distant city blocks: [x, z, width, depth, height]. */
export function cityBlocks(count: number): [number, number, number, number, number][] {
  const r = rng(42);
  const out: [number, number, number, number, number][] = [];
  for (let i = 0; i < count; i++) {
    const a = r() * Math.PI * 2;
    const d = 470 + r() * 220;
    out.push([Math.cos(a) * d, Math.sin(a) * d, 16 + r() * 24, 16 + r() * 24, 14 + Math.pow(r(), 2) * 48]);
  }
  return out;
}
