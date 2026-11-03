import { useRef, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import * as THREE from 'three';

/**
 * Connection line between two network nodes with animated packet pulse.
 *
 * Uses drei <Line> (Line2/LineMaterial) for real pixel-width lines.
 * toneMapped={false} + fog={false} on the line material, plus HDR colour
 * multipliers on the packet sphere, so they bloom lightly with the nodes.
 *
 * Colour multipliers:
 *   Normal line:  #39FF88 × 1.6  (softly visible, not dominant)
 *   Threat line:  threat colour × 2.2  (brightly neon, clearly distinct)
 *   Packet dot:   same multiplier approach
 *
 * Width and opacity logic unchanged:
 *   Normal: lineWidth 1.8, opacity 0.5
 *   Threat: lineWidth 3.5, opacity 0.9
 */

// HDR multipliers — lowered so threads are subtle background elements
const LINE_MULT_NORMAL = 0.6;  // was 0.9 — dim & subtle
const LINE_MULT_THREAT = 1.0;  // was 1.4 — visible threat without over-bright glare
const DOT_MULT_NORMAL  = 0.7;  // was 1.0
const DOT_MULT_THREAT  = 1.1;  // was 1.6

// Scratch colour — never allocated inside useFrame
const _scratch = new THREE.Color();

export default function ConnectionLine({
  sourcePos,
  targetPos,
  threat = false,
  severity = 'none',
  reducedMotion = false,
}) {
  const lineRef   = useRef();  // Line2 object (drei Line forwards ref here)
  const pulseRef  = useRef();  // pulse sphere mesh
  const pulseProgress = useRef(Math.random());
  const pulseSpeed    = useMemo(() => 0.3 + Math.random() * 0.3, []);

  // Pre-allocated Vector3s for pulse lerp
  const _vStart = useMemo(() => new THREE.Vector3(...sourcePos), [sourcePos]);
  const _vEnd   = useMemo(() => new THREE.Vector3(...targetPos),  [targetPos]);

  // LDR base colours — deeper, less aggressive saturation for threads
  const normalColor = useMemo(() => new THREE.Color('#228B52'), []);
  const threatColor = useMemo(() => new THREE.Color('#D32F2F'), []);
  const amberColor  = useMemo(() => new THREE.Color('#D97706'), []);
  const currentColor = useRef(new THREE.Color('#228B52'));

  // Points array (recreated only when positions change)
  const points = useMemo(
    () => [
      new THREE.Vector3(...sourcePos),
      new THREE.Vector3(...targetPos),
    ],
    [sourcePos, targetPos]
  );

  // Pulse sphere — smaller size so packets don't look like giant glowing orbs
  const pulseSize = threat ? 0.06 : 0.035;
  const pulseSphereGeo = useMemo(
    () => new THREE.SphereGeometry(pulseSize, 8, 8),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [threat]
  );
  const pulseMat = useMemo(
    () => new THREE.MeshBasicMaterial({
      color:      new THREE.Color('#228B52'),
      transparent: true,
      opacity:    0.6,
      depthWrite: false,
      toneMapped: true,
      fog:        true,
    }),
    []
  );

  useEffect(() => {
    return () => {
      pulseSphereGeo.dispose();
      pulseMat.dispose();
    };
  }, [pulseSphereGeo, pulseMat]);

  // ── useFrame ─────────────────────────────────────────────────────────
  useFrame((_, delta) => {
    // ── Colour transition (LDR) ──────────────────────────────────────
    const targetClr = threat
      ? severity === 'medium' ? amberColor : threatColor
      : normalColor;

    const lf = reducedMotion ? 1 : 1 - Math.pow(0.01, delta);
    currentColor.current.lerp(targetClr, lf);

    // ── Line material: HDR colour + width + opacity ──────────────────
    if (lineRef.current?.material) {
      const mat  = lineRef.current.material;
      const mult = threat ? LINE_MULT_THREAT : LINE_MULT_NORMAL;
      _scratch.copy(currentColor.current).multiplyScalar(mult);
      mat.color.copy(_scratch);
      mat.opacity   = threat ? 0.45 : 0.18;  // subtle, not over-highlighted
      mat.linewidth = threat ? 1.8 : 1.2;    // clean thin lines
    }

    // ── Packet pulse position ────────────────────────────────────────
    if (pulseRef.current && !reducedMotion) {
      pulseProgress.current += pulseSpeed * delta;
      if (pulseProgress.current > 1) pulseProgress.current = 0;

      _vStart.set(...sourcePos);
      _vEnd.set(...targetPos);
      pulseRef.current.position.lerpVectors(_vStart, _vEnd, pulseProgress.current);
    }

    // ── Packet pulse colour (HDR) ────────────────────────────────────
    if (pulseRef.current) {
      const dotMult = threat ? DOT_MULT_THREAT : DOT_MULT_NORMAL;
      _scratch.copy(currentColor.current).multiplyScalar(dotMult);
      pulseMat.color.copy(_scratch);
    }
  });

  return (
    <group>
      {/* Connection line — real pixel-width, HDR colour */}
      <Line
        ref={lineRef}
        points={points}
        color="#228B52"
        lineWidth={1.2}
        transparent
        opacity={0.18}
        depthWrite={false}
      />

      {/* Traveling packet pulse — HDR colour, toneMapped=false */}
      <mesh
        ref={pulseRef}
        position={sourcePos}
        geometry={pulseSphereGeo}
        material={pulseMat}
      />
    </group>
  );
}
