"use client";

// Owner: A. The 3D stadium (rendered inside <Canvas> by StadiumPicker; client-only).
// Lighting: CC0 dusk HDRI (Poly Haven "Venice Sunset", public/hdri) + warm key light with soft shadows +
// four floodlight towers. Seats: one InstancedMesh per section, coloured by real availability.
// Post: N8AO contact shadows, bloom only on floodlight panels (toneMapped=false, >1 intensity), vignette, ACES.

import { useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import * as THREE from "three";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { CameraControls, Environment, Html } from "@react-three/drei";
import { Bloom, EffectComposer, N8AO, ToneMapping, Vignette } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { COLORS } from "@/lib/design";
import { seatLabel, type SectionId, type SectionLayout, type SeatState } from "@/lib/stadium-map";
import { cityBlocks, polar, pitchTexture, roofGeometry, seatGeometry, seatTransform, terraceGeometry, treePositions } from "./geometry";

export const SEAT_COLORS: Record<SeatState["kind"], string> = {
  available: COLORS.accent, // official inventory: the stand's red
  resale: COLORS.released, // protected resale
  outside: COLORS.pending, // outside ticket, escrow protected
  taken: COLORS.vault, // taken: blue
  off: "#3a3a42", // not on sale
};

export interface HoverSeat {
  section: SectionId;
  index: number;
}

function Pill({ children, position }: { children: React.ReactNode; position: THREE.Vector3 }) {
  return (
    <Html position={position} center distanceFactor={undefined} zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
      <div className="overlay-white rounded-full px-3 py-1.5 text-[13px] font-semibold whitespace-nowrap shadow-xl">{children}</div>
    </Html>
  );
}

function SectionSeats({
  layout,
  states,
  dim,
  onHover,
  onClick,
}: {
  layout: SectionLayout;
  states: SeatState[];
  dim: boolean;
  onHover: (h: HoverSeat | null) => void;
  onClick: (h: HoverSeat) => void;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const geo = useMemo(() => seatGeometry(), []);
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.05 }), []);
  const vip = layout.def.tier === "vip";

  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const o = new THREE.Object3D();
    layout.slots.forEach((s, i) => {
      const { pos, yaw } = seatTransform(layout.def, s);
      o.position.copy(pos);
      o.rotation.set(0, yaw, 0);
      o.scale.setScalar(vip ? 1.35 : 1);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
  }, [layout, vip]);

  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const c = new THREE.Color();
    layout.slots.forEach((_, i) => {
      const kind = states[i]?.kind ?? "off";
      c.set(vip ? "#5a2e1c" : SEAT_COLORS[kind]); // VIP: leather
      // roughness variation via slight colour jitter keeps big stands from looking flat
      const j = 0.92 + ((i * 2654435761) % 1000) / 1000 * 0.12;
      c.multiplyScalar(dim && kind === "off" ? 0.55 * j : j);
      m.setColorAt(i, c);
    });
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [layout, states, dim, vip]);

  return (
    <instancedMesh
      ref={ref}
      args={[geo, mat, layout.slots.length]}
      onPointerMove={(e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation();
        if (e.instanceId !== undefined) onHover({ section: layout.def.id, index: e.instanceId });
      }}
      onPointerOut={() => onHover(null)}
      onClick={(e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation();
        if (e.instanceId !== undefined) onClick({ section: layout.def.id, index: e.instanceId });
      }}
    />
  );
}

function Terrace({ layout, highlighted, onHover, onClick }: { layout: SectionLayout; highlighted: boolean; onHover: (id: SectionId | null) => void; onClick: (id: SectionId) => void }) {
  const geo = useMemo(() => terraceGeometry(layout.def), [layout.def]);
  return (
    <mesh
      geometry={geo}
      receiveShadow
      castShadow
      onPointerOver={(e) => {
        e.stopPropagation();
        onHover(layout.def.id);
      }}
      onPointerOut={() => onHover(null)}
      onClick={(e) => {
        e.stopPropagation();
        onClick(layout.def.id);
      }}
    >
      <meshStandardMaterial color={highlighted ? "#8a6a5e" : layout.def.tier === "vip" ? "#2b2b30" : "#77777e"} roughness={0.92} metalness={0} side={THREE.DoubleSide} emissive={highlighted ? "#5a1d12" : "#000000"} emissiveIntensity={highlighted ? 0.6 : 0} />
    </mesh>
  );
}

function Pitch() {
  const tex = useMemo(() => pitchTexture(), []);
  return (
    <group>
      {/* surround (run-off) */}
      <mesh rotation-x={-Math.PI / 2} position-y={-0.02} receiveShadow>
        <planeGeometry args={[124, 92]} />
        <meshStandardMaterial color="#2a5a25" roughness={1} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={0} receiveShadow>
        <planeGeometry args={[105, 68]} />
        <meshStandardMaterial map={tex} roughness={0.95} />
      </mesh>
      {/* goals */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 52.8, 1.2, 0]}>
          <boxGeometry args={[0.15, 2.44, 7.32]} />
          <meshStandardMaterial color="#f2f2f2" roughness={0.4} />
        </mesh>
      ))}
    </group>
  );
}

function Floodlights() {
  const towers = useMemo(() => [40, 140, 220, 320].map((t) => ({ t, base: polar(t, 108, 0) })), []);
  return (
    <group>
      {towers.map(({ t, base }) => {
        const head = base.clone().setY(46);
        const dir = new THREE.Vector3(-base.x, 0, -base.z).normalize();
        const yaw = Math.atan2(dir.x, dir.z);
        return (
          <group key={t}>
            <mesh position={[base.x, 23, base.z]} castShadow>
              <cylinderGeometry args={[0.6, 1.1, 46, 10]} />
              <meshStandardMaterial color="#3b3b42" metalness={0.6} roughness={0.5} />
            </mesh>
            <group position={head} rotation={[0, yaw, 0]}>
              <mesh>
                <boxGeometry args={[9, 5, 0.8]} />
                <meshStandardMaterial color="#2a2a30" metalness={0.5} roughness={0.5} />
              </mesh>
              <mesh position={[0, 0, 0.45]}>
                <planeGeometry args={[8.4, 4.4]} />
                {/* > 1 and not tone-mapped: the only thing bright enough to bloom */}
                <meshBasicMaterial color={[6, 5.4, 4.4]} toneMapped={false} />
              </mesh>
            </group>
            <spotLight position={head} angle={0.55} penumbra={0.7} intensity={2600} distance={260} decay={1.6} color="#fff1dc" target-position={[0, 0, 0]} />
          </group>
        );
      })}
    </group>
  );
}

function Surroundings() {
  const trees = useMemo(() => treePositions(260), []);
  const blocks = useMemo(() => cityBlocks(140), []);
  const trunk = useRef<THREE.InstancedMesh>(null);
  const crown = useRef<THREE.InstancedMesh>(null);
  const city = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const o = new THREE.Object3D();
    trees.forEach((p, i) => {
      const s = 0.8 + ((i * 37) % 10) / 20;
      o.position.set(p.x, 1.6 * s, p.z);
      o.scale.set(s, s, s);
      o.updateMatrix();
      trunk.current?.setMatrixAt(i, o.matrix);
      o.position.set(p.x, 5.2 * s, p.z);
      o.updateMatrix();
      crown.current?.setMatrixAt(i, o.matrix);
    });
    blocks.forEach(([x, z, w, d, h], i) => {
      o.position.set(x, h / 2, z);
      o.scale.set(w, h, d);
      o.rotation.set(0, (i % 7) * 0.2, 0);
      o.updateMatrix();
      city.current?.setMatrixAt(i, o.matrix);
    });
    for (const m of [trunk.current, crown.current, city.current]) if (m) m.instanceMatrix.needsUpdate = true;
  }, [trees, blocks]);
  return (
    <group>
      {/* no shadows on the huge ground plane: avoids shadow acne banding */}
      <mesh rotation-x={-Math.PI / 2} position-y={-0.05}>
        <planeGeometry args={[1400, 1400]} />
        <meshStandardMaterial color="#17161a" roughness={1} />
      </mesh>
      {/* plaza around the bowl */}
      <mesh rotation-x={-Math.PI / 2} position-y={-0.04}>
        <circleGeometry args={[112, 64]} />
        <meshStandardMaterial color="#26252b" roughness={0.95} />
      </mesh>
      {/* four approach roads */}
      {[0, 1].map((k) => (
        <mesh key={k} rotation={[-Math.PI / 2, 0, k ? Math.PI / 2 : 0]} position-y={-0.03}>
          <planeGeometry args={[14, 1000]} />
          <meshStandardMaterial color="#202024" roughness={0.9} />
        </mesh>
      ))}
      <instancedMesh ref={trunk} args={[undefined, undefined, trees.length]} castShadow>
        <cylinderGeometry args={[0.25, 0.35, 3.2, 6]} />
        <meshStandardMaterial color="#3b2a20" roughness={1} />
      </instancedMesh>
      <instancedMesh ref={crown} args={[undefined, undefined, trees.length]} castShadow>
        <icosahedronGeometry args={[2.6, 0]} />
        <meshStandardMaterial color="#1f3b22" roughness={1} flatShading />
      </instancedMesh>
      <instancedMesh ref={city} args={[undefined, undefined, blocks.length]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#1b1a20" roughness={0.9} emissive="#3a1c12" emissiveIntensity={0.25} />
      </instancedMesh>
    </group>
  );
}

function VipGlass({ layout }: { layout: SectionLayout }) {
  // Glass front of the VIP box (between West Lower and West Upper).
  const g = useMemo(() => {
    const pts: number[] = [];
    const seg = 12;
    const { def } = layout;
    for (let i = 0; i < seg; i++) {
      const t0 = def.from + ((def.to - def.from) * i) / seg, t1 = def.from + ((def.to - def.from) * (i + 1)) / seg;
      const a = polar(t0, 69.6, 6.6), b = polar(t1, 69.6, 6.6), c = polar(t1, 69.6, 9.2), d = polar(t0, 69.6, 9.2);
      pts.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, a.x, a.y, a.z, c.x, c.y, c.z, d.x, d.y, d.z);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    geo.computeVertexNormals();
    return geo;
  }, [layout]);
  return (
    <mesh geometry={g}>
      <meshPhysicalMaterial color="#cfe3ff" roughness={0.05} metalness={0} transparent opacity={0.22} side={THREE.DoubleSide} clearcoat={1} />
    </mesh>
  );
}

export interface SceneProps {
  layout: SectionLayout[];
  states: Map<SectionId, SeatState[]>;
  controlsRef: RefObject<CameraControls | null>;
  autoOrbit: boolean;
  focusSection: SectionId | null;
  hoveredSection: SectionId | null;
  hoveredSeat: HoverSeat | null;
  selectedSeat: HoverSeat | null;
  showSeatPill: boolean;
  fromPriceOf: (id: SectionId) => number | null;
  onHoverSection: (id: SectionId | null) => void;
  onSelectSection: (id: SectionId) => void;
  onHoverSeat: (h: HoverSeat | null) => void;
  onSelectSeat: (h: HoverSeat) => void;
  postFx: boolean;
}

export default function StadiumScene(p: SceneProps) {
  const { controlsRef } = p;
  const roof = useMemo(() => roofGeometry(), []);
  const byId = useMemo(() => new Map(p.layout.map((l) => [l.def.id, l])), [p.layout]);

  useFrame((_, dt) => {
    if (p.autoOrbit) void controlsRef.current?.rotate(dt * 0.045, 0, false);
  });

  useEffect(() => {
    document.body.style.cursor = p.hoveredSeat || p.hoveredSection ? "pointer" : "auto";
    return () => {
      document.body.style.cursor = "auto";
    };
  }, [p.hoveredSeat, p.hoveredSection]);

  const sectionPill = (() => {
    const id = p.hoveredSection;
    if (!id || p.focusSection) return null;
    const l = byId.get(id)!;
    const mid = (l.def.from + l.def.to) / 2;
    const from = p.fromPriceOf(id);
    return (
      <Pill position={seatTransform(l.def, { row: l.def.rows, theta: mid }).pos.add(new THREE.Vector3(0, 5, 0))}>
        {l.def.name} · {from != null ? `from $${from}` : "no seats on sale"}
      </Pill>
    );
  })();

  const seatPill = (() => {
    const h = p.hoveredSeat;
    if (!h || !p.showSeatPill) return null;
    const l = byId.get(h.section)!;
    const slot = l.slots[h.index];
    const st = p.states.get(h.section)?.[h.index];
    const label = `Row ${slot.row} · Seat ${slot.seat}`;
    const text =
      !st || st.kind === "off" ? `${label} · Not on sale`
      : st.kind === "taken" ? `${label} · Taken`
      : st.kind === "resale" ? `Protected resale · $${st.priceUsd}${st.capUsd != null ? ` (cap $${st.capUsd})` : ""}`
      : st.kind === "outside" ? `Outside ticket · Escrow protected · $${st.priceUsd}`
      : `${label} · $${st.priceUsd}`;
    return <Pill position={seatTransform(l.def, slot).pos.add(new THREE.Vector3(0, 1.1, 0))}>{text}</Pill>;
  })();

  return (
    <>
      <color attach="background" args={[COLORS.background]} />
      <fog attach="fog" args={["#1a0d0f", 260, 700]} />
      <Environment files="/hdri/venice_sunset_1k.hdr" background backgroundBlurriness={0.3} backgroundIntensity={0.85} environmentIntensity={1.05} />
      <hemisphereLight args={["#ffd7b0", "#2a1414", 0.45]} />
      <directionalLight
        position={[-120, 110, 90]}
        intensity={2.6}
        color="#ffb27a"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-130}
        shadow-camera-right={130}
        shadow-camera-top={130}
        shadow-camera-bottom={-130}
        shadow-camera-far={400}
        shadow-bias={-0.0004}
        shadow-radius={4}
      />

      <Pitch />
      {p.layout.map((l) => (
        <Terrace key={`t-${l.def.id}`} layout={l} highlighted={p.hoveredSection === l.def.id || p.focusSection === l.def.id} onHover={p.onHoverSection} onClick={p.onSelectSection} />
      ))}
      {p.layout.map((l) => (
        <SectionSeats key={`s-${l.def.id}`} layout={l} states={p.states.get(l.def.id) ?? []} dim={Boolean(p.focusSection && p.focusSection !== l.def.id)} onHover={p.onHoverSeat} onClick={p.onSelectSeat} />
      ))}
      {byId.get("VIP") && <VipGlass layout={byId.get("VIP")!} />}
      <mesh geometry={roof} receiveShadow>
        <meshStandardMaterial color="#1c1c21" metalness={0.25} roughness={0.7} side={THREE.DoubleSide} />
      </mesh>
      <Floodlights />
      <Surroundings />
      {sectionPill}
      {seatPill}
      {p.selectedSeat && (() => {
        const l = byId.get(p.selectedSeat.section)!;
        return <Pill position={seatTransform(l.def, l.slots[p.selectedSeat.index]).pos.add(new THREE.Vector3(0, 1.1, 0))}>{seatLabel(l.slots[p.selectedSeat.index])}</Pill>;
      })()}

      <CameraControls ref={controlsRef} makeDefault smoothTime={0.55} minDistance={0.1} maxDistance={520} maxPolarAngle={Math.PI / 2.05} />
      {p.postFx && (
        <EffectComposer multisampling={0}>
          <N8AO halfRes aoRadius={2.2} intensity={2.2} distanceFalloff={1} />
          <Bloom mipmapBlur luminanceThreshold={1.1} luminanceSmoothing={0.2} intensity={0.9} />
          <Vignette eskil={false} offset={0.22} darkness={0.75} />
          <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        </EffectComposer>
      )}
    </>
  );
}
