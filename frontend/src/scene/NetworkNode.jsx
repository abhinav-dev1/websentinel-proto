import { useRef, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { Billboard } from '@react-three/drei';
import * as THREE from 'three';
import { getIconTexture } from './nodeIcons';

/**
 * A single network node rendered as a neon hexagon badge, always facing the
 * camera (Billboard).
 *
 * HDR neon colour strategy
 * ──────────────────────────
 * Every surface material has  toneMapped={false} + fog={false}  so ACES tone
 * mapping and scene fog cannot dull the bright parts.  We lerp colours in
 * normal (0-1) LDR space for smooth transitions, then multiply the result by
 * a per-layer brightness scalar before writing to the material.  This pushes
 * the ring and edge pixels well above 1.0 so they exceed the bloom threshold.
 *
 * Multipliers used:
 *   outer ring  × RING_MULT   (2.5 normal / 2.8 critical)
 *   inner edge  × EDGE_MULT   (2.0 normal / 2.2 critical)
 *   icon tint   × ICON_MULT   (2.0 all states)
 *   halo        additive, opacity scaled up on threat
 *
 * Layers (back to front):
 *   glowGeo      – additive soft radial halo
 *   innerFillGeo – dark translucent hexagon fill (tinted to threat colour)
 *   innerEdgeGeo – thinner ring, bright emissive edge
 *   outerRingGeo – outer ring, brightest part
 *   iconGeo      – icon texture plane
 *
 * Props
 *   node          – { id, ip, hostname, type, role, position, threatState }
 *   reducedMotion – no bob/pulse, instant colour changes
 */

// ─── HDR multipliers ──────────────────────────────────────────────────────

const RING_MULT_NORMAL   = 1.4;  // was 2.5 — reduced so ring stays #39FF88, not blown white
const RING_MULT_CRITICAL = 1.6;  // was 2.8
const EDGE_MULT_NORMAL   = 1.2;  // was 2.0
const EDGE_MULT_CRITICAL = 1.4;  // was 2.2
const ICON_MULT          = 1.3;  // was 2.0

// ─── Colour palette (LDR base values — multiplied when applied) ───────────

// Normal-state edge colour: brighter mint for the inner ring
const COLOR_EDGE_GREEN  = new THREE.Color('#7CFFB2');
// Icon tints per state
const COLOR_ICON_GREEN  = new THREE.Color('#E8FFF2');
const COLOR_ICON_AMBER  = new THREE.Color('#FFF3D6');
const COLOR_ICON_RED    = new THREE.Color('#FFE3E3');

// ─── Hex geometry factory ─────────────────────────────────────────────────

function makeHexRingGeo(innerR, outerR) {
  const geo = new THREE.RingGeometry(innerR, outerR, 6);
  geo.rotateZ(-Math.PI / 6);
  return geo;
}

function makeHexFillGeo(r) {
  const geo = new THREE.CircleGeometry(r, 6);
  geo.rotateZ(-Math.PI / 6);
  return geo;
}

// ─── Sizes ────────────────────────────────────────────────────────────────

function nodeSizeFor(type) {
  if (type === 'router')   return 0.57;  // was 0.68
  if (type === 'external') return 0.65;  // was 0.78
  return 0.42;                           // was 0.50
}

// ─── Reusable scratch colour (never allocated inside useFrame) ────────────

const _scratch = new THREE.Color();

// ─── Component ────────────────────────────────────────────────────────────

export default function NetworkNode({ node, reducedMotion = false }) {
  // ── Geometry ──────────────────────────────────────────────────────────
  const hexSize = useMemo(() => nodeSizeFor(node.type), [node.type]);

  const outerRingGeo = useMemo(() => makeHexRingGeo(hexSize * 0.88, hexSize),       [hexSize]);
  const innerEdgeGeo = useMemo(() => makeHexRingGeo(hexSize * 0.62, hexSize * 0.72),[hexSize]);
  const innerFillGeo = useMemo(() => makeHexFillGeo(hexSize * 0.72),                [hexSize]);
  const glowGeo      = useMemo(() => makeHexFillGeo(hexSize * 1.8),                 [hexSize]);
  const iconGeo      = useMemo(() => new THREE.PlaneGeometry(hexSize * 0.9, hexSize * 0.9), [hexSize]);

  const iconTexture = useMemo(
    () => getIconTexture(node.hostname, node.type),
    [node.hostname, node.type]
  );

  // ── Materials (toneMapped=false, fog=false everywhere) ────────────────
  const outerRingMat = useMemo(() => new THREE.MeshBasicMaterial({
    color:      new THREE.Color('#39FF88'),
    side:       THREE.DoubleSide,
    depthWrite: true,
    toneMapped: false,
    fog:        false,
  }), []);

  const innerEdgeMat = useMemo(() => new THREE.MeshBasicMaterial({
    color:      new THREE.Color('#7CFFB2'),
    side:       THREE.DoubleSide,
    transparent: true,
    opacity:    1.0,
    depthWrite: false,
    toneMapped: false,
    fog:        false,
  }), []);

  // Dark fill — colour is updated in useFrame to match threat state tint
  const innerFillMat = useMemo(() => new THREE.MeshBasicMaterial({
    color:      new THREE.Color('#04120B'),
    side:       THREE.DoubleSide,
    transparent: true,
    opacity:    0.92,
    depthWrite: false,
    toneMapped: false,
    fog:        false,
  }), []);

  const glowMat = useMemo(() => new THREE.MeshBasicMaterial({
    color:      new THREE.Color('#39FF88'),
    side:       THREE.DoubleSide,
    transparent: true,
    opacity:    0.28,
    depthWrite: false,
    blending:   THREE.AdditiveBlending,
    toneMapped: false,
    fog:        false,
  }), []);

  const iconMat = useMemo(() => new THREE.MeshBasicMaterial({
    map:        iconTexture,
    color:      new THREE.Color('#E8FFF2'),
    transparent: true,
    opacity:    1.0,
    depthWrite: false,
    side:       THREE.DoubleSide,
    toneMapped: false,
    fog:        false,
  }), [iconTexture]);

  // ── Dispose on unmount ────────────────────────────────────────────────
  useEffect(() => () => {
    outerRingGeo.dispose(); innerEdgeGeo.dispose(); innerFillGeo.dispose();
    glowGeo.dispose();      iconGeo.dispose();
    outerRingMat.dispose(); innerEdgeMat.dispose(); innerFillMat.dispose();
    glowMat.dispose();      iconMat.dispose();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Refs ──────────────────────────────────────────────────────────────
  const groupRef     = useRef();
  const billboardRef = useRef();

  // ── Colour lerp state (LDR, 0-1) ─────────────────────────────────────
  const palette = useMemo(() => ({
    none:     new THREE.Color('#39FF88'),
    medium:   new THREE.Color('#FFB020'),   // bright amber
    critical: new THREE.Color('#FF2E3E'),   // neon red
  }), []);

  const currentColor        = useRef(new THREE.Color('#39FF88'));
  const targetColor         = useRef(new THREE.Color('#39FF88'));
  const currentGlowOpacity  = useRef(0.14);
  const targetGlowOpacity   = useRef(0.14);

  // ── Idle animation ────────────────────────────────────────────────────
  const phase    = useMemo(() => Math.random() * Math.PI * 2, []);
  const bobSpeed = useMemo(() => 0.3 + Math.random() * 0.2, []);
  const bobAmt   = useMemo(() => 0.12 + Math.random() * 0.08, []);

  // ── useFrame — all material updates happen here ───────────────────────
  useFrame((state, delta) => {
    if (!groupRef.current) return;

    const threat = node.threatState || 'none';
    const isCrit = threat === 'critical';
    const isMed  = threat === 'medium';

    // Target LDR colour
    targetColor.current.copy(palette[threat] || palette.none);

    // Target glow opacity
    targetGlowOpacity.current = isCrit ? 0.35 : isMed ? 0.24 : 0.14;

    // Lerp factor ~400 ms
    const lf = reducedMotion ? 1 : 1 - Math.pow(0.001, delta);

    currentColor.current.lerp(targetColor.current, lf);
    currentGlowOpacity.current = THREE.MathUtils.lerp(
      currentGlowOpacity.current, targetGlowOpacity.current, lf
    );

    // ── Outer ring: HDR multiply ────────────────────────────────────
    const ringMult = isCrit ? RING_MULT_CRITICAL : RING_MULT_NORMAL;
    _scratch.copy(currentColor.current).multiplyScalar(ringMult);
    outerRingMat.color.copy(_scratch);

    // ── Inner edge: brighter mint (or threat tint) x EDGE_MULT ─────
    const edgeMult = isCrit ? EDGE_MULT_CRITICAL : EDGE_MULT_NORMAL;
    if (threat === 'none') {
      // Use the brighter mint edge colour in normal state
      _scratch.copy(COLOR_EDGE_GREEN).multiplyScalar(edgeMult);
    } else {
      // Use the same threat colour, edge mult
      _scratch.copy(currentColor.current).multiplyScalar(edgeMult);
    }
    innerEdgeMat.color.copy(_scratch);

    // ── Halo ───────────────────────────────────────────────────────
    glowMat.color.copy(currentColor.current);
    glowMat.opacity = currentGlowOpacity.current;

    // ── Dark inner fill: very dark tint of threat colour ───────────
    // Blend from near-black green to near-black threat tint
    if (threat === 'none') {
      innerFillMat.color.set('#04120B');
    } else if (isMed) {
      // Very dark amber
      innerFillMat.color.set('#1A1000');
    } else {
      // Very dark red
      innerFillMat.color.set('#180408');
    }

    // ── Icon tint: pick per-state colour and apply ICON_MULT ───────
    const iconBase = isCrit ? COLOR_ICON_RED : isMed ? COLOR_ICON_AMBER : COLOR_ICON_GREEN;
    _scratch.copy(iconBase).multiplyScalar(ICON_MULT);
    iconMat.color.copy(_scratch);

    // ── Critical scale pulse ───────────────────────────────────────
    if (!reducedMotion && billboardRef.current) {
      const t = state.clock.elapsedTime;
      if (isCrit) {
        const pulse = 1.0 + Math.sin(t * 6) * 0.04;
        billboardRef.current.scale.setScalar(pulse);
      } else {
        billboardRef.current.scale.setScalar(
          THREE.MathUtils.lerp(billboardRef.current.scale.x, 1.0, lf)
        );
      }
    }

    // ── Idle bob ───────────────────────────────────────────────────
    if (!reducedMotion) {
      const t = state.clock.elapsedTime;
      groupRef.current.position.y =
        node.position[1] + Math.sin(t * bobSpeed + phase) * bobAmt;
    } else {
      groupRef.current.position.y = node.position[1];
    }
  });

  const basePosition = useMemo(
    () => [node.position[0], node.position[1], node.position[2]],
    [node.position]
  );

  return (
    <group ref={groupRef} position={basePosition}>
      <Billboard ref={billboardRef} follow={true} lockX={false} lockY={false} lockZ={false}>
        {/* Soft additive halo glow — behind everything */}
        <mesh geometry={glowGeo} material={glowMat} renderOrder={0} />

        {/* Dark inner fill */}
        <mesh geometry={innerFillGeo} material={innerFillMat} renderOrder={1} />

        {/* Inner emissive edge ring */}
        <mesh geometry={innerEdgeGeo} material={innerEdgeMat} renderOrder={2} />

        {/* Outer HDR ring — main bloom source */}
        <mesh geometry={outerRingGeo} material={outerRingMat} renderOrder={3} />

        {/* Icon */}
        <mesh geometry={iconGeo} material={iconMat} renderOrder={4} />
      </Billboard>
    </group>
  );
}
