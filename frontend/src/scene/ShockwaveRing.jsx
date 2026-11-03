import { useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

// Pre-allocated quaternion for billboard rotation — no per-frame allocations
const _camQuat = new THREE.Quaternion();

/**
 * A single expanding ring within the shockwave burst.
 * Starts invisible until `delay` seconds have elapsed, then
 * expands from nodeRadius to ~4.5× nodeRadius with ease-out
 * opacity fade, using additive blending for a glowing energy look.
 *
 * The ring is billboard (always faces the camera) so it looks like a halo
 * from any viewing angle, not edge-on when the globe is rotated.
 */
function ShockwaveRingLayer({ position, color, delay, duration, nodeRadius, onComplete }) {
  const meshRef = useRef();
  const matRef = useRef();
  const elapsed = useRef(0);
  const done = useRef(false);

  useFrame(({ camera }, delta) => {
    if (done.current) return;

    elapsed.current += delta;

    // Wait for the stagger delay before becoming active
    const active = elapsed.current - delay;
    if (active < 0) return;

    const t = Math.min(active / duration, 1);
    // Ease-out cubic — expands fast, slows near end (physical shockwave feel)
    const eased = 1 - Math.pow(1 - t, 3);

    if (meshRef.current) {
      // Scale from nodeRadius to 4.5× nodeRadius
      const scale = nodeRadius + eased * nodeRadius * 3.5;
      meshRef.current.scale.setScalar(scale);

      // Billboard: copy camera quaternion so the ring always faces the camera.
      camera.getWorldQuaternion(_camQuat);
      meshRef.current.quaternion.copy(_camQuat);
    }

    if (matRef.current) {
      // Opacity 1 → 0 as it expands
      matRef.current.opacity = (1 - eased) * 0.9;
    }

    if (t >= 1 && !done.current) {
      done.current = true;
      onComplete?.();
    }
  });

  return (
    <mesh ref={meshRef} position={position}>
      {/*
        innerRadius=1, outerRadius=1.045 → thin outline ring when scaled.
        thetaSegments=96 for a smooth circle.
        Note: no initial rotation={[-Math.PI/2, 0, 0]} — billboard handles orientation.
      */}
      <ringGeometry args={[1, 1.045, 96]} />
      <meshBasicMaterial
        ref={matRef}
        color={color}
        transparent
        opacity={0.9}
        side={THREE.DoubleSide}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  );
}

// -------------------------------------------------------------------
// Ring config: 3 rings staggered by 150ms, each lasting ~0.9s.
const RING_CONFIGS = [
  { delay: 0,    duration: 0.9 },
  { delay: 0.15, duration: 0.9 },
  { delay: 0.30, duration: 0.9 },
];

/**
 * Multi-ring expanding shockwave burst. Rings always face the camera (billboard).
 *
 * Props:
 *   position      – [x, y, z] world position of the node
 *   color         – hex string matching the node's current threat color
 *   nodeRadius    – base radius of the node mesh (controls ring start size)
 *   onComplete    – called once ALL rings have finished (for parent cleanup)
 *   reducedMotion – if true, skips animation and immediately signals completion
 */
export default function ShockwaveRing({
  position,
  color = '#FF3B30',
  nodeRadius = 0.25,
  onComplete,
  reducedMotion = false,
}) {
  const [completedCount, setCompletedCount] = useState(0);
  const total = RING_CONFIGS.length;

  // prefers-reduced-motion: skip entirely, just signal completion
  if (reducedMotion) {
    onComplete?.();
    return null;
  }

  // Once every ring has called back, remove the whole burst
  const handleLayerComplete = () => {
    setCompletedCount((prev) => {
      const next = prev + 1;
      if (next >= total) onComplete?.();
      return next;
    });
  };

  // After all rings done, render nothing (parent will also remove us via onComplete)
  if (completedCount >= total) return null;

  return (
    <>
      {RING_CONFIGS.map((cfg, i) => (
        <ShockwaveRingLayer
          key={i}
          position={position}
          color={color}
          delay={cfg.delay}
          duration={cfg.duration}
          nodeRadius={nodeRadius}
          onComplete={handleLayerComplete}
        />
      ))}
    </>
  );
}
