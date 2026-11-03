import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

/**
 * Ambient floating particles in the 3D scene.
 * Sparse, slow-drifting green-tinted motes for atmosphere.
 */
export default function AmbientParticles({ count = 200, reducedMotion = false }) {
  const pointsRef = useRef();

  const { positions, speeds } = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const speeds = new Float32Array(count);
    const spread = 20;

    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * spread;
      positions[i * 3 + 1] = (Math.random() - 0.5) * spread;
      positions[i * 3 + 2] = (Math.random() - 0.5) * spread;
      speeds[i] = 0.02 + Math.random() * 0.04;
    }

    return { positions, speeds };
  }, [count]);

  useFrame((state) => {
    if (reducedMotion || !pointsRef.current) return;

    const posArray = pointsRef.current.geometry.attributes.position.array;
    const t = state.clock.elapsedTime;

    for (let i = 0; i < count; i++) {
      // Gentle drift
      posArray[i * 3 + 1] += speeds[i] * 0.02;

      // Wrap around when too high
      if (posArray[i * 3 + 1] > 10) {
        posArray[i * 3 + 1] = -10;
      }

      // Subtle horizontal sway
      posArray[i * 3] += Math.sin(t * 0.1 + i) * 0.001;
    }

    pointsRef.current.geometry.attributes.position.needsUpdate = true;
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          array={positions}
          count={count}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial
        color="#39FF88"
        size={0.03}
        transparent
        opacity={0.3}
        depthWrite={false}
        sizeAttenuation
      />
    </points>
  );
}
