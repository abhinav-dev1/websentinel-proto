import { useRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

// Pre-allocated quaternion — reused every frame, zero per-frame allocations
const _camQuat = new THREE.Quaternion();

const RING_COLOR = '#A8F0FF';  // cyan-white highlight
const RING_DURATION = 3.0;     // seconds to stay visible
const PULSE_SPEED = 3.5;       // oscillations per second
const BASE_RADIUS = 0.55;      // inner radius of the ring geometry
const RING_THICKNESS = 1.055;  // outerRadius = BASE_RADIUS * RING_THICKNESS

/**
 * HighlightRing
 *
 * A thin glowing billboard ring that appears around the target node
 * for ~3 seconds when a record is clicked in the Attack Log.
 *
 * Props:
 *   position      – [x, y, z] world position of the node
 *   onDone        – called once when the ring should be removed
 *   reducedMotion – if true, skip animation and fire onDone immediately
 */
export default function HighlightRing({ position, onDone, reducedMotion }) {
  if (reducedMotion) {
    return <NoMotionRing onDone={onDone} />;
  }
  return <AnimatedRing position={position} onDone={onDone} />;
}

/**
 * Fires onDone exactly once on mount (reduced-motion path).
 * Needs to be a component so hooks rules are satisfied.
 */
function NoMotionRing({ onDone }) {
  const firedRef = useRef(false);
  useEffect(() => {
    if (!firedRef.current) {
      firedRef.current = true;
      onDone?.();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/**
 * The actual animated ring. Only rendered when reducedMotion is false.
 */
function AnimatedRing({ position, onDone }) {
  const meshRef = useRef();
  const matRef = useRef();
  const elapsed = useRef(0);
  const done = useRef(false);

  return (
    <mesh ref={meshRef} position={position}>
      {/* thin ring: inner=BASE_RADIUS, outer=BASE_RADIUS*thickness, 96 segments */}
      <ringGeometry args={[BASE_RADIUS, BASE_RADIUS * RING_THICKNESS, 96]} />
      <meshBasicMaterial
        ref={matRef}
        color={RING_COLOR}
        transparent
        opacity={0.9}
        side={THREE.DoubleSide}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        toneMapped={false}
      />
      <RingController
        meshRef={meshRef}
        matRef={matRef}
        elapsed={elapsed}
        done={done}
        onDone={onDone}
      />
    </mesh>
  );
}

/**
 * Inner controller that drives the useFrame animation loop.
 * Separated into its own component so useFrame is only active
 * while the ring is mounted.
 */
function RingController({ meshRef, matRef, elapsed, done, onDone }) {
  useFrame(({ camera }, delta) => {
    if (done.current) return;

    elapsed.current += delta;
    const t = elapsed.current / RING_DURATION;

    if (t >= 1) {
      done.current = true;
      if (matRef.current) matRef.current.opacity = 0;
      onDone?.();
      return;
    }

    // Billboard: face the camera at all times
    if (meshRef.current) {
      camera.getWorldQuaternion(_camQuat);
      meshRef.current.quaternion.copy(_camQuat);
    }

    // Pulse opacity: sine wave that fades out as t → 1
    if (matRef.current) {
      const fade = 1 - t * t;  // quadratic fade-out
      const pulse = 0.5 + 0.5 * Math.sin(elapsed.current * PULSE_SPEED * Math.PI * 2);
      matRef.current.opacity = fade * (0.55 + 0.4 * pulse);
    }
  });

  return null;
}
