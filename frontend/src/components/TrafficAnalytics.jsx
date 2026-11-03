import { useEffect, useRef } from 'react';

// ── Tuning Constants (Easy to Adjust) ────────────────────────────────────────
const WEIGHT_NORMAL = 1;
const WEIGHT_ATTACKER_NODE = 3; // external attacker node (node-99)
const WEIGHT_THREAT = 8;        // threat === true (+8 added to base)
const ATTACKER_NODE_ID = 'node-99';

const SAMPLE_INTERVAL_MS = 250; // sample rate: every 250 ms
const EVENT_WINDOW_MS = 1000;    // sum weights in last 1000 ms
const ATTACK_WINDOW_MS = 1500;   // attack state lingers 1500 ms after last threat event
const CHART_WINDOW_MS = 60000;   // 60 s rolling chart window

const ALPHA_ATTACK = 0.6;        // fast-attack smoothing (shoots up quickly)
const ALPHA_DECAY = 0.12;        // slow-decay smoothing (falls gently)

const CHART_WIDTH = 324;
const CHART_HEIGHT = 100;
const PADDING_TOP = 8;
const PADDING_BOTTOM = 12;       // 12% bottom padding (keeps baseline off bottom edge)
const USABLE_HEIGHT = CHART_HEIGHT - PADDING_TOP - PADDING_BOTTOM; // 80px
const BASELINE_Y = CHART_HEIGHT - PADDING_BOTTOM; // 88px
const MAX_MASK_RECTS = 10;

/**
 * Fritsch-Carlson Monotone Cubic Spline
 * Guarantees C1 continuity, monotonicity, and zero overshoot/undershoot.
 */
function getMonotoneCubicPath(points) {
  const n = points.length;
  if (n === 0) return '';
  if (n === 1) return `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  if (n === 2) {
    return `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)} L ${points[1].x.toFixed(1)} ${points[1].y.toFixed(1)}`;
  }

  const dx = new Float32Array(n - 1);
  const dy = new Float32Array(n - 1);
  const slope = new Float32Array(n - 1);

  for (let i = 0; i < n - 1; i++) {
    dx[i] = points[i + 1].x - points[i].x;
    dy[i] = points[i + 1].y - points[i].y;
    slope[i] = dx[i] !== 0 ? dy[i] / dx[i] : 0;
  }

  const m = new Float32Array(n);
  m[0] = slope[0];
  m[n - 1] = slope[n - 2];

  for (let i = 1; i < n - 1; i++) {
    const s0 = slope[i - 1];
    const s1 = slope[i];
    if (s0 * s1 <= 0) {
      m[i] = 0;
    } else {
      const avg = (s0 + s1) / 2;
      const alpha = avg / s0;
      const beta = avg / s1;
      const hyp = Math.hypot(alpha, beta);
      if (hyp > 3) {
        m[i] = (3 / hyp) * avg;
      } else {
        m[i] = avg;
      }
    }
  }

  let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const p0 = points[i];
    const p1 = points[i + 1];
    const dxThird = dx[i] / 3;
    const cp1x = p0.x + dxThird;
    const cp1y = p0.y + m[i] * dxThird;
    const cp2x = p1.x - dxThird;
    const cp2y = p1.y - m[i + 1] * dxThird;
    d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p1.x.toFixed(1)} ${p1.y.toFixed(1)}`;
  }

  return d;
}

/**
 * TrafficAnalytics — Live Traffic Load Chart Card
 *
 * Real-time floating glass card top-left over the 3D scene.
 * Consumes events incrementally into refs and draws via requestAnimationFrame
 * with zero React re-renders per event or per frame.
 */
export default function TrafficAnalytics({ events }) {
  // DOM Refs for direct mutations
  const cardRef = useRef(null);
  const statusChipRef = useRef(null);
  const statusTextRef = useRef(null);
  const bigNumRef = useRef(null);
  const peakRef = useRef(null);
  const avgRef = useRef(null);

  const greenLineRef = useRef(null);
  const greenAreaRef = useRef(null);
  const redLineRef = useRef(null);
  const redAreaRef = useRef(null);
  const headGroupRef = useRef(null);
  const headDotRef = useRef(null);
  const headRingRef = useRef(null);
  const maskRectsRef = useRef([]);

  // Data Series & State Refs (survive across frames without re-rendering)
  const lastSeqRef = useRef(0);
  const recentEventsRef = useRef([]);      // { receivedAt, weight, isAttack }
  const samplesRef = useRef([]);           // { time, val, attack }
  const lastAttackEventTimeRef = useRef(0);
  const currentSmoothedRef = useRef(0);
  const displayValueRef = useRef(0);
  const currentYMaxRef = useRef(12);
  const lastSampleTickRef = useRef(Date.now());
  const rafIdRef = useRef(null);
  const intervalIdRef = useRef(null);

  // ── Reset Handler ──────────────────────────────────────────────────────────
  const handleReset = () => {
    lastSeqRef.current = 0;
    recentEventsRef.current = [];
    samplesRef.current = [];
    lastAttackEventTimeRef.current = 0;
    currentSmoothedRef.current = 0;
    displayValueRef.current = 0;
    currentYMaxRef.current = 12;
    lastSampleTickRef.current = Date.now();

    if (greenLineRef.current) greenLineRef.current.setAttribute('d', '');
    if (greenAreaRef.current) greenAreaRef.current.setAttribute('d', '');
    if (redLineRef.current) redLineRef.current.setAttribute('d', '');
    if (redAreaRef.current) redAreaRef.current.setAttribute('d', '');
    if (bigNumRef.current) {
      bigNumRef.current.textContent = '0.0';
      bigNumRef.current.classList.remove('traffic-analytics__current-value--attack');
    }
    if (peakRef.current) peakRef.current.textContent = '0.0';
    if (avgRef.current) avgRef.current.textContent = '0.0';
    if (statusChipRef.current) {
      statusChipRef.current.className = 'traffic-analytics__chip traffic-analytics__chip--normal';
    }
    if (statusTextRef.current) statusTextRef.current.textContent = 'NORMAL';
    if (cardRef.current) cardRef.current.classList.remove('traffic-analytics--attack');
    maskRectsRef.current.forEach((r) => r?.setAttribute('width', '0'));
  };

  // ── Event Ingestion (incremental by _seq, no setState) ─────────────────────
  useEffect(() => {
    if (!events || events.length === 0) {
      if (lastSeqRef.current > 0) handleReset();
      return;
    }

    const lastEventSeq = events[events.length - 1]._seq ?? 0;

    // Reset detection: if sequence went backwards
    if (lastEventSeq < lastSeqRef.current) {
      handleReset();
    }

    if (lastEventSeq <= lastSeqRef.current) return;

    // Walk backwards from end to quickly pick up new events
    let startIndex = events.length - 1;
    while (startIndex >= 0 && (events[startIndex]._seq ?? 0) > lastSeqRef.current) {
      startIndex--;
    }

    const newEvents = events.slice(startIndex + 1);
    lastSeqRef.current = lastEventSeq;

    const now = Date.now();
    for (const event of newEvents) {
      const isAttacker =
        event.source_node === ATTACKER_NODE_ID ||
        event.target_node === ATTACKER_NODE_ID;
      const isThreat = Boolean(event.threat);

      let weight = isAttacker ? WEIGHT_ATTACKER_NODE : WEIGHT_NORMAL;
      if (isThreat) {
        weight += WEIGHT_THREAT;
      }

      const receivedAt = event._receivedAt || now;
      recentEventsRef.current.push({
        receivedAt,
        weight,
        isAttack: isAttacker || isThreat,
      });

      if (isAttacker || isThreat) {
        lastAttackEventTimeRef.current = Math.max(lastAttackEventTimeRef.current, receivedAt);
      }
    }
  }, [events]);

  // ── 250ms Sample Tick & rAF Animation Loop ────────────────────────────────
  useEffect(() => {
    const doSampleTick = (tickTime) => {
      // 1. Prune events older than 5 seconds
      const eventCutoff = tickTime - 5000;
      recentEventsRef.current = recentEventsRef.current.filter((e) => e.receivedAt >= eventCutoff);

      // 2. Compute instant: sum weights of events received in the last 1000 ms
      const windowStart = tickTime - EVENT_WINDOW_MS;
      let instant = 0;
      for (const e of recentEventsRef.current) {
        if (e.receivedAt >= windowStart && e.receivedAt <= tickTime) {
          instant += e.weight;
        }
      }

      // 3. Attack flag: attacker-involved event or threat event in the last 1500 ms
      const isAttackSample = Boolean(
        lastAttackEventTimeRef.current &&
        tickTime - lastAttackEventTimeRef.current <= ATTACK_WINDOW_MS
      );

      // 4. FAST-ATTACK / SLOW-DECAY smoothing
      let currentSmoothed = currentSmoothedRef.current;
      if (instant > currentSmoothed) {
        currentSmoothed += ALPHA_ATTACK * (instant - currentSmoothed);
      } else {
        currentSmoothed += ALPHA_DECAY * (instant - currentSmoothed);
      }
      currentSmoothedRef.current = currentSmoothed;

      // Subtle alive undulation during calm baseline when instant is low
      const idleWave =
        !isAttackSample && instant === 0 && currentSmoothed < 0.8
          ? 0.25 + 0.12 * Math.sin(tickTime / 750)
          : 0;
      const effectiveVal = Math.max(currentSmoothed, idleWave);

      // 5. Store sample
      samplesRef.current.push({
        time: tickTime,
        val: effectiveVal,
        attack: isAttackSample,
      });

      // 6. Prune samples older than 65s
      const sampleCutoff = tickTime - CHART_WINDOW_MS - 5000;
      samplesRef.current = samplesRef.current.filter((s) => s.time >= sampleCutoff);
    };

    // Dedicated timer for sample ticks
    intervalIdRef.current = setInterval(() => {
      const now = Date.now();
      doSampleTick(now);
      lastSampleTickRef.current = now;
    }, SAMPLE_INTERVAL_MS);

    // ── rAF Draw Loop ───────────────────────────────────────────────────────
    const renderFrame = () => {
      const now = Date.now();
      const samples = samplesRef.current;

      // Determine active attack state right now
      const isCurrentlyAttacking = Boolean(
        lastAttackEventTimeRef.current &&
        now - lastAttackEventTimeRef.current <= ATTACK_WINDOW_MS
      );

      // Compute Peak & Avg over the 60s window
      const windowStart60 = now - CHART_WINDOW_MS;
      let peak60 = 0;
      let sum60 = 0;
      let count60 = 0;

      for (let i = samples.length - 1; i >= 0; i--) {
        const s = samples[i];
        if (s.time < windowStart60) break;
        if (s.val > peak60) peak60 = s.val;
        sum60 += s.val;
        count60 += 1;
      }

      if (currentSmoothedRef.current > peak60) {
        peak60 = currentSmoothedRef.current;
      }

      const avg60 = count60 > 0 ? sum60 / count60 : 0;

      // Smooth Y Max: max(12, peak * 1.15)
      const targetYMax = Math.max(12, peak60 * 1.15);
      currentYMaxRef.current += (targetYMax - currentYMaxRef.current) * 0.06;
      const yMax = currentYMaxRef.current;

      // Smooth Big Number (count-up / count-down easing)
      displayValueRef.current += (currentSmoothedRef.current - displayValueRef.current) * 0.15;
      if (Math.abs(displayValueRef.current - currentSmoothedRef.current) < 0.02) {
        displayValueRef.current = currentSmoothedRef.current;
      }

      // Update DOM Text Elements
      if (bigNumRef.current) {
        bigNumRef.current.textContent = displayValueRef.current.toFixed(1);
      }
      if (peakRef.current) {
        peakRef.current.textContent = peak60.toFixed(1);
      }
      if (avgRef.current) {
        avgRef.current.textContent = avg60.toFixed(1);
      }

      // Update Header Status Chip & Card Classes (during attack ONLY chip, big number, card border go red)
      if (statusChipRef.current && statusTextRef.current && cardRef.current && bigNumRef.current) {
        if (isCurrentlyAttacking) {
          if (!statusChipRef.current.classList.contains('traffic-analytics__chip--attack')) {
            statusChipRef.current.className = 'traffic-analytics__chip traffic-analytics__chip--attack';
            statusTextRef.current.textContent = 'UNDER ATTACK';
            cardRef.current.classList.add('traffic-analytics--attack');
            bigNumRef.current.classList.add('traffic-analytics__current-value--attack');
          }
        } else {
          if (!statusChipRef.current.classList.contains('traffic-analytics__chip--normal')) {
            statusChipRef.current.className = 'traffic-analytics__chip traffic-analytics__chip--normal';
            statusTextRef.current.textContent = 'NORMAL';
            cardRef.current.classList.remove('traffic-analytics--attack');
            bigNumRef.current.classList.remove('traffic-analytics__current-value--attack');
          }
        }
      }

      // ── Build Curve Points ────────────────────────────────────────────────
      // X = CHART_WIDTH - ((now - s.time) / 60000) * CHART_WIDTH
      // Y = CHART_HEIGHT - PADDING_BOTTOM - (val / yMax) * USABLE_HEIGHT
      const points = [];

      // Include points within and just before the 60s window
      for (const s of samples) {
        if (s.time < now - CHART_WINDOW_MS - 2000) continue;
        const x = CHART_WIDTH - ((now - s.time) / CHART_WINDOW_MS) * CHART_WIDTH;
        const y = CHART_HEIGHT - PADDING_BOTTOM - (Math.min(s.val, yMax) / yMax) * USABLE_HEIGHT;
        points.push({ x, y, attack: s.attack });
      }

      // Add head point at right edge (x = CHART_WIDTH)
      const headY =
        CHART_HEIGHT -
        PADDING_BOTTOM -
        (Math.min(currentSmoothedRef.current, yMax) / yMax) * USABLE_HEIGHT;
      points.push({ x: CHART_WIDTH, y: headY, attack: isCurrentlyAttacking });

      // If curve doesn't reach the left edge yet (on mount), prepend baseline point at x = 0
      if (points.length > 0 && points[0].x > 0) {
        points.unshift({ x: 0, y: BASELINE_Y, attack: false });
      }

      // Generate Monotone-Cubic Spline Path
      const lineD = getMonotoneCubicPath(points);
      const firstX = points.length > 0 ? points[0].x.toFixed(1) : '0';
      const lastX = points.length > 0 ? points[points.length - 1].x.toFixed(1) : `${CHART_WIDTH}`;
      const areaD = lineD ? `${lineD} L ${lastX} ${CHART_HEIGHT} L ${firstX} ${CHART_HEIGHT} Z` : '';

      // Update Line & Area Paths via Refs (both green and red layers use identical path data)
      if (greenLineRef.current) greenLineRef.current.setAttribute('d', lineD);
      if (greenAreaRef.current) greenAreaRef.current.setAttribute('d', areaD);
      if (redLineRef.current) redLineRef.current.setAttribute('d', lineD);
      if (redAreaRef.current) redAreaRef.current.setAttribute('d', areaD);

      // Update Glowing Head Dot & Pulsing Ring
      if (headGroupRef.current) {
        headGroupRef.current.setAttribute(
          'transform',
          `translate(${CHART_WIDTH.toFixed(1)}, ${headY.toFixed(1)})`
        );
      }
      if (headDotRef.current) {
        headDotRef.current.setAttribute('fill', isCurrentlyAttacking ? '#FF3B30' : '#39FF88');
        headDotRef.current.setAttribute(
          'filter',
          isCurrentlyAttacking ? 'url(#traffic-red-glow)' : 'url(#traffic-green-glow)'
        );
      }
      if (headRingRef.current) {
        headRingRef.current.setAttribute('stroke', isCurrentlyAttacking ? '#FF3B30' : '#39FF88');
      }

      // ── Attack Segment Intervals for Red Layer Mask ───────────────────────
      // Find contiguous intervals of samples with attack === true
      const attackIntervals = [];
      let activeInterval = null;

      for (let i = 0; i < points.length; i++) {
        const pt = points[i];
        if (pt.attack) {
          if (!activeInterval) {
            activeInterval = { startX: pt.x, endX: pt.x };
          } else {
            activeInterval.endX = pt.x;
          }
        } else {
          if (activeInterval) {
            attackIntervals.push(activeInterval);
            activeInterval = null;
          }
        }
      }
      if (activeInterval) {
        // If attack is currently active, extend past the right edge so leading edge is 100% red
        if (isCurrentlyAttacking) {
          activeInterval.endX = CHART_WIDTH + 15;
        }
        attackIntervals.push(activeInterval);
      }

      // Update Mask Rects (softened horizontally by the gaussian blur filter)
      const padX = 2.0; // padding to ensure coverage
      for (let k = 0; k < MAX_MASK_RECTS; k++) {
        const rectEl = maskRectsRef.current[k];
        if (!rectEl) continue;

        if (k < attackIntervals.length) {
          const inv = attackIntervals[k];
          const x1 = Math.max(-10, inv.startX - padX);
          const x2 = inv.endX >= CHART_WIDTH ? CHART_WIDTH + 15 : Math.min(CHART_WIDTH + 15, inv.endX + padX);
          const width = Math.max(0, x2 - x1);
          rectEl.setAttribute('x', x1.toFixed(1));
          rectEl.setAttribute('width', width.toFixed(1));
        } else {
          rectEl.setAttribute('width', '0');
        }
      }

      rafIdRef.current = requestAnimationFrame(renderFrame);
    };

    rafIdRef.current = requestAnimationFrame(renderFrame);

    return () => {
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
      if (intervalIdRef.current) clearInterval(intervalIdRef.current);
    };
  }, []);

  return (
    <div ref={cardRef} className="traffic-analytics">
      {/* Header Row */}
      <div className="traffic-analytics__header">
        <div className="traffic-analytics__title">
          <span className="traffic-analytics__dot" />
          <span>TRAFFIC ANALYTICS</span>
        </div>
        <div ref={statusChipRef} className="traffic-analytics__chip traffic-analytics__chip--normal">
          <span className="traffic-analytics__chip-dot" />
          <span ref={statusTextRef}>NORMAL</span>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="traffic-analytics__metrics">
        <div className="traffic-analytics__current">
          <span ref={bigNumRef} className="traffic-analytics__current-value">
            0.0
          </span>
          <span className="traffic-analytics__current-unit">ev/s</span>
        </div>
        <div className="traffic-analytics__secondary">
          <div className="traffic-analytics__sec-metric">
            <span className="traffic-analytics__sec-label">PEAK 60s</span>
            <span ref={peakRef} className="traffic-analytics__sec-value">
              0.0
            </span>
          </div>
          <div className="traffic-analytics__sec-metric">
            <span className="traffic-analytics__sec-label">AVG</span>
            <span ref={avgRef} className="traffic-analytics__sec-value">
              0.0
            </span>
          </div>
        </div>
      </div>

      {/* Live Monotone Chart */}
      <div className="traffic-analytics__chart-wrapper">
        <svg
          className="traffic-analytics__svg"
          viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
          preserveAspectRatio="none"
        >
          <defs>
            {/* Green Area Gradient */}
            <linearGradient id="traffic-green-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#39FF88" stopOpacity="0.25" />
              <stop offset="60%" stopColor="#39FF88" stopOpacity="0.06" />
              <stop offset="100%" stopColor="#39FF88" stopOpacity="0.0" />
            </linearGradient>

            {/* Red Area Gradient */}
            <linearGradient id="traffic-red-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#FF3B30" stopOpacity="0.45" />
              <stop offset="60%" stopColor="#FF3B30" stopOpacity="0.12" />
              <stop offset="100%" stopColor="#FF3B30" stopOpacity="0.0" />
            </linearGradient>

            {/* Green Glow Filter */}
            <filter id="traffic-green-glow" x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="2" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>

            {/* Red Glow Filter (Stronger) */}
            <filter id="traffic-red-glow" x="-40%" y="-40%" width="180%" height="180%">
              <feGaussianBlur stdDeviation="3.5" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>

            {/* Mask Soften Filter (Horizontally blurs ~2px ≈ 0.3s transition on edges) */}
            <filter id="traffic-mask-soften" x="-20%" y="0%" width="140%" height="100%">
              <feGaussianBlur stdDeviation="2 0" />
            </filter>

            {/* Left Edge Darkness Fade */}
            <linearGradient id="traffic-left-fade" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#12171A" stopOpacity="0.95" />
              <stop offset="60%" stopColor="#12171A" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#12171A" stopOpacity="0" />
            </linearGradient>

            {/* Attack Segment Mask */}
            <mask id="traffic-attack-mask">
              <rect x="0" y="0" width="100%" height="100%" fill="black" />
              <g filter="url(#traffic-mask-soften)">
                {Array.from({ length: MAX_MASK_RECTS }).map((_, i) => (
                  <rect
                    key={i}
                    ref={(el) => {
                      maskRectsRef.current[i] = el;
                    }}
                    x="-20"
                    y="0"
                    width="0"
                    height={CHART_HEIGHT}
                    fill="white"
                  />
                ))}
              </g>
            </mask>
          </defs>

          {/* Faint Dashed Horizontal Grid Lines */}
          <line
            x1="0"
            y1="24"
            x2={CHART_WIDTH}
            y2="24"
            stroke="rgba(255, 255, 255, 0.05)"
            strokeDasharray="3 4"
            strokeWidth="1"
          />
          <line
            x1="0"
            y1="56"
            x2={CHART_WIDTH}
            y2="56"
            stroke="rgba(255, 255, 255, 0.05)"
            strokeDasharray="3 4"
            strokeWidth="1"
          />
          <line
            x1="0"
            y1={BASELINE_Y}
            x2={CHART_WIDTH}
            y2={BASELINE_Y}
            stroke="rgba(255, 255, 255, 0.05)"
            strokeDasharray="3 4"
            strokeWidth="1"
          />

          {/* 1. Base Layer: Always GREEN */}
          <g className="traffic-layer-green">
            <path ref={greenAreaRef} fill="url(#traffic-green-area)" />
            <path
              ref={greenLineRef}
              fill="none"
              stroke="#39FF88"
              strokeWidth="2"
              filter="url(#traffic-green-glow)"
            />
          </g>

          {/* 2. Attack Layer: Masked RED Copy (Over the Green Layer) */}
          <g className="traffic-layer-red" mask="url(#traffic-attack-mask)">
            <path ref={redAreaRef} fill="url(#traffic-red-area)" />
            <path
              ref={redLineRef}
              fill="none"
              stroke="#FF3B30"
              strokeWidth="2"
              filter="url(#traffic-red-glow)"
            />
          </g>

          {/* Left Fade Overlay (Line emerges smoothly from darkness) */}
          <rect
            x="0"
            y="0"
            width="32"
            height={CHART_HEIGHT}
            fill="url(#traffic-left-fade)"
            pointerEvents="none"
          />

          {/* Glowing Head Dot with Pulsing Ring at Leading Edge */}
          <g ref={headGroupRef} transform={`translate(${CHART_WIDTH}, ${BASELINE_Y})`}>
            <circle
              ref={headRingRef}
              cx="0"
              cy="0"
              r="6"
              fill="none"
              stroke="#39FF88"
              strokeWidth="1.5"
              className="traffic-head-ring"
            />
            <circle
              ref={headDotRef}
              cx="0"
              cy="0"
              r="3"
              fill="#39FF88"
              filter="url(#traffic-green-glow)"
            />
          </g>
        </svg>
      </div>
    </div>
  );
}
