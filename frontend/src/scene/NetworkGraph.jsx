import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import * as THREE from 'three';
import NetworkNode from './NetworkNode';
import NodeLabel from './NodeLabel';
import ConnectionLine from './ConnectionLine';
import ShockwaveRing from './ShockwaveRing';
import AmbientParticles from './AmbientParticles';
import HighlightRing from './HighlightRing';

const PULSE_INTERVAL = 1.2; // seconds between ring bursts per threatened node

/**
 * Frame-accurate pulse controller.
 * Lives inside the Canvas to use R3F's useFrame.
 */
function PulseController({ nodes, reducedMotion, onSpawn }) {
  const timers = useRef(new Map()); // nodeId → seconds since last spawn

  useFrame((_, delta) => {
    if (reducedMotion) return;

    nodes.forEach((node, nodeId) => {
      const isThreat =
        node.threatState === 'critical' || node.threatState === 'medium';

      if (isThreat) {
        const elapsed = timers.current.has(nodeId)
          ? timers.current.get(nodeId) + delta
          : PULSE_INTERVAL;

        if (elapsed >= PULSE_INTERVAL) {
          onSpawn(node);
          timers.current.set(nodeId, 0);
        } else {
          timers.current.set(nodeId, elapsed);
        }
      } else if (timers.current.has(nodeId)) {
        timers.current.delete(nodeId);
      }
    });
  });

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Camera view-offset component
// Shifts the camera's rendered viewport so the graph is centred in the free
// area between the Traffic Analytics card and the Event Feed.
// ─────────────────────────────────────────────────────────────────────────────
function CameraViewOffset() {
  const { camera, size } = useThree();

  useEffect(() => {
    function recalculate() {
      const W = size.width;
      const H = size.height;

      let leftBound = 0;
      if (W >= 768) {
        const card = document.querySelector('.traffic-analytics');
        if (card) {
          const rect = card.getBoundingClientRect();
          leftBound = rect.right + 16;
        }
      }

      // Clamp leftBound so it never exceeds half the canvas width
      leftBound = Math.min(leftBound, W * 0.45);

      const freeAreaMidX = leftBound + (W - leftBound) / 2;
      const canvasMidX = W / 2;
      const shiftPx = freeAreaMidX - canvasMidX; // positive → shift right

      // Positive offsetX in setViewOffset shifts the window right, moving the
      // rendered scene to the LEFT. We negate to push the graph RIGHT.
      camera.setViewOffset(W, H, -shiftPx, 0, W, H);
      camera.updateProjectionMatrix();
    }

    recalculate();

    const card = document.querySelector('.traffic-analytics');
    let ro = null;
    if (card && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(recalculate);
      ro.observe(card);
    }
    window.addEventListener('resize', recalculate);
    return () => {
      window.removeEventListener('resize', recalculate);
      if (ro) ro.disconnect();
      camera.clearViewOffset();
      camera.updateProjectionMatrix();
    };
  }, [camera, size]);

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Auto-rotate controller
// Pauses while user is dragging, resumes 4s after last interaction.
// Respects reducedMotion.
// ─────────────────────────────────────────────────────────────────────────────
const AUTO_ROTATE_SPEED = 0.3;
const RESUME_AFTER_MS = 4000;

function AutoRotateController({ controlsRef, reducedMotion }) {
  const lastInteractionRef = useRef(0);
  const isUserDraggingRef = useRef(false);

  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;

    const onStart = () => {
      isUserDraggingRef.current = true;
      if (controls) controls.autoRotate = false;
    };
    const onEnd = () => {
      isUserDraggingRef.current = false;
      lastInteractionRef.current = performance.now();
    };

    controls.addEventListener('start', onStart);
    controls.addEventListener('end', onEnd);
    return () => {
      controls.removeEventListener('start', onStart);
      controls.removeEventListener('end', onEnd);
    };
  }, [controlsRef]);

  useFrame(() => {
    const controls = controlsRef.current;
    if (!controls) return;

    if (reducedMotion) {
      controls.autoRotate = false;
      return;
    }

    if (!isUserDraggingRef.current) {
      const msSinceLast = performance.now() - lastInteractionRef.current;
      controls.autoRotate = msSinceLast > RESUME_AFTER_MS;
    }
    controls.autoRotateSpeed = AUTO_ROTATE_SPEED;
  });

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
/**
 * Root 3D scene: the network graph visualization.
 * Contains all nodes, connections, effects, lighting, and atmosphere.
 */
export default function NetworkGraph({
  nodes,
  connections,
  reducedMotion = false,
  highlightHost = null,
}) {
  const [shockwaves, setShockwaves] = useState([]);
  const [highlightRing, setHighlightRing] = useState(null); // { id, position }
  const controlsRef = useRef(null);

  const nodesArray = useMemo(() => Array.from(nodes.values()), [nodes]);

  // When highlightHost changes, find the node and mount the ring
  useEffect(() => {
    if (!highlightHost) {
      setHighlightRing(null);
      return;
    }
    let found = null;
    for (const node of nodes.values()) {
      if (node.hostname === highlightHost) {
        found = node;
        break;
      }
    }
    if (found && found.position) {
      setHighlightRing({ id: `hr-${Date.now()}`, position: [...found.position] });
    }
  }, [highlightHost, nodes]);

  // Threat-state → ring color (mirrors NetworkNode's palette exactly)
  const threatColor = useCallback((state) => {
    if (state === 'critical') return '#FF3B30';
    if (state === 'medium')   return '#D9A441';
    return '#39FF88';
  }, []);

  // Push a single burst entry into the shockwaves list
  const spawnRing = useCallback((node) => {
    const nodeRadius =
      node.type === 'router' ? 0.35 : node.type === 'external' ? 0.4 : 0.25;
    const id = `${node.id}-${Date.now()}-${Math.random()}`;
    setShockwaves((prev) => [
      ...prev,
      {
        id,
        position: [...node.position],
        color: threatColor(node.threatState),
        nodeRadius,
      },
    ]);
  }, [threatColor]);

  const removeShockwave = useCallback((id) => {
    setShockwaves((prev) => prev.filter((sw) => sw.id !== id));
  }, []);

  return (
    <Canvas
      camera={{ position: [0, 11, 20], fov: 50, near: 0.1, far: 120 }}
      gl={{ antialias: true, alpha: false }}
      onCreated={({ gl }) => {
        gl.setClearColor('#0A0E0F');
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.2;
      }}
    >
      {/* ── Camera view offset (centre graph in free area) ─── */}
      <CameraViewOffset />

      {/* ── Auto-rotate controller ──────────────────────────── */}
      <AutoRotateController controlsRef={controlsRef} reducedMotion={reducedMotion} />

      {/* ── Lighting ───────────────────────────────────────────── */}
      <ambientLight intensity={0.15} color="#E0E6E3" />
      <pointLight position={[0, 14, 0]} intensity={0.4} color="#39FF88" distance={45} />
      <pointLight position={[-12, 8, -12]} intensity={0.2} color="#39FF88" distance={35} />
      <pointLight position={[12, 8, 12]} intensity={0.15} color="#1B6B3A" distance={35} />

      {/* ── Fog for depth ──────────────────────────────────────── */}
      <fog attach="fog" args={['#0A0E0F', 22, 55]} />

      {/* ── Grid floor (tactical radar) ────────────────────────── */}
      <gridHelper
        args={[60, 60, '#1B6B3A', '#0F1A14']}
        position={[0, -5.5, 0]}
        material-opacity={0.25}
        material-transparent={true}
      />

      {/* ── Ambient particles ──────────────────────────────────── */}
      <AmbientParticles count={150} reducedMotion={reducedMotion} />

      {/* ── Connection lines ───────────────────────────────────── */}
      {connections.map((conn) => {
        const sourceNode = nodes.get(conn.source);
        const targetNode = nodes.get(conn.target);
        if (!sourceNode || !targetNode) return null;

        return (
          <ConnectionLine
            key={`${conn.source}-${conn.target}`}
            sourcePos={sourceNode.position}
            targetPos={targetNode.position}
            threat={conn.threat || false}
            severity={conn.severity || 'none'}
            reducedMotion={reducedMotion}
          />
        );
      })}

      {/* ── Network nodes ──────────────────────────────────────── */}
      {nodesArray.map((node) => (
        <group key={node.id}>
          <NetworkNode node={node} reducedMotion={reducedMotion} />
          <NodeLabel node={node} />
        </group>
      ))}

      {/* ── Pulse controller (spawns shockwave rings on cadence) ── */}
      <PulseController nodes={nodes} reducedMotion={reducedMotion} onSpawn={spawnRing} />

      {/* ── Shockwave rings ────────────────────────────────────── */}
      {shockwaves.map((sw) => (
        <ShockwaveRing
          key={sw.id}
          position={sw.position}
          color={sw.color}
          nodeRadius={sw.nodeRadius}
          reducedMotion={reducedMotion}
          onComplete={() => removeShockwave(sw.id)}
        />
      ))}

      {/* ── Highlight ring (attack log click) ─────────────────── */}
      {highlightRing && (
        <HighlightRing
          key={highlightRing.id}
          position={highlightRing.position}
          reducedMotion={reducedMotion}
          onDone={() => setHighlightRing(null)}
        />
      )}

      {/* ── Bloom post-processing ───────────────────────────────── */}
      <EffectComposer>
        <Bloom
          luminanceThreshold={0.92}
          luminanceSmoothing={0.15}
          intensity={0.45}
          radius={0.5}
          mipmapBlur
        />
      </EffectComposer>

      {/* ── Camera controls ────────────────────────────────────────
           Allows 360° rotation:
           - Orbit around (0,0,0)
           - Smooth damping
           - Auto-rotate with drag pause
      */}
      <OrbitControls
        ref={controlsRef}
        enableDamping
        dampingFactor={0.05}
        minDistance={6}
        maxDistance={40}
        enablePan={false}
        autoRotate={false}
        autoRotateSpeed={AUTO_ROTATE_SPEED}
        target={[0, 0, 0]}
      />
    </Canvas>
  );
}
