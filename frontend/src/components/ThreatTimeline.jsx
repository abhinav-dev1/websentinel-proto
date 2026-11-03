import { useState, useRef, useCallback } from 'react';

const SEVERITY_COLORS = {
  none: 'var(--accent-green-dim)',
  medium: 'var(--accent-amber)',
  critical: 'var(--accent-red)',
};

const CHART_HEIGHT = 100;
const BAR_GAP = 2;

/**
 * Collapsible threat timeline panel — docked at the bottom of the dashboard.
 * Hand-rolled SVG bar chart showing threat event count per 10-second bucket.
 */
export default function ThreatTimeline({ buckets }) {
  const [expanded, setExpanded] = useState(false);
  const [tooltip, setTooltip] = useState(null);
  const chartRef = useRef(null);

  const formatTime = useCallback((ms) => {
    const d = new Date(ms);
    return d.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }, []);

  const maxCount = Math.max(1, ...buckets.map((b) => b.count));

  // Calculate bar width based on available space (60 buckets max)
  const totalBuckets = 60;
  const barWidth = `calc((100% - ${(totalBuckets - 1) * BAR_GAP}px) / ${totalBuckets})`;

  const handleBarHover = useCallback(
    (bucket, event) => {
      const rect = chartRef.current?.getBoundingClientRect();
      if (!rect) return;

      setTooltip({
        bucket,
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      });
    },
    []
  );

  const handleBarLeave = useCallback(() => {
    setTooltip(null);
  }, []);

  const totalThreats = buckets.reduce((sum, b) => sum + b.count, 0);

  return (
    <div className={`threat-timeline ${expanded ? 'threat-timeline--expanded' : ''}`}>
      {/* Collapsed bar / toggle */}
      <button
        className="threat-timeline__toggle"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-controls="threat-timeline-panel"
        id="threat-timeline-toggle"
      >
        <span className="threat-timeline__toggle-label">
          THREAT TIMELINE
          {totalThreats > 0 && (
            <span className="threat-timeline__toggle-count">{totalThreats}</span>
          )}
        </span>
        <span
          className={`threat-timeline__toggle-arrow ${
            expanded ? 'threat-timeline__toggle-arrow--up' : ''
          }`}
        >
          ▲
        </span>
      </button>

      {/* Expandable panel */}
      {expanded && (
        <div className="threat-timeline__panel" id="threat-timeline-panel" ref={chartRef}>
          {/* Y-axis labels */}
          <div className="threat-timeline__y-axis">
            <span>{maxCount}</span>
            <span>{Math.ceil(maxCount / 2)}</span>
            <span>0</span>
          </div>

          {/* Chart area */}
          <div className="threat-timeline__chart">
            <svg
              width="100%"
              height={CHART_HEIGHT}
              viewBox={`0 0 ${totalBuckets * (10 + BAR_GAP)} ${CHART_HEIGHT}`}
              preserveAspectRatio="none"
            >
              {/* Grid lines */}
              <line
                x1="0" y1={CHART_HEIGHT * 0.5}
                x2="100%" y2={CHART_HEIGHT * 0.5}
                stroke="var(--border-subtle)"
                strokeWidth="0.5"
                strokeDasharray="4 4"
              />
              <line
                x1="0" y1="1"
                x2="100%" y2="1"
                stroke="var(--border-subtle)"
                strokeWidth="0.5"
                strokeDasharray="4 4"
              />

              {/* Bars */}
              {buckets.map((bucket, i) => {
                const barHeight = (bucket.count / maxCount) * (CHART_HEIGHT - 4);
                const barX = i * (10 + BAR_GAP);
                const barY = CHART_HEIGHT - barHeight;

                return (
                  <rect
                    key={bucket.timestamp}
                    x={barX}
                    y={barY}
                    width={10}
                    height={barHeight}
                    fill={SEVERITY_COLORS[bucket.maxSeverity] || SEVERITY_COLORS.none}
                    opacity={0.85}
                    rx={1}
                    onMouseEnter={(e) => handleBarHover(bucket, e.nativeEvent)}
                    onMouseMove={(e) => handleBarHover(bucket, e.nativeEvent)}
                    onMouseLeave={handleBarLeave}
                    style={{ cursor: 'crosshair' }}
                  />
                );
              })}
            </svg>

            {/* X-axis time labels */}
            <div className="threat-timeline__x-axis">
              {buckets.length > 0 && (
                <>
                  <span>{formatTime(buckets[0].timestamp)}</span>
                  {buckets.length > 1 && (
                    <span>{formatTime(buckets[buckets.length - 1].timestamp)}</span>
                  )}
                </>
              )}
              {buckets.length === 0 && (
                <span className="threat-timeline__empty">No threat events recorded</span>
              )}
            </div>
          </div>

          {/* Tooltip */}
          {tooltip && (
            <div
              className="threat-timeline__tooltip"
              style={{
                left: Math.min(tooltip.x, (chartRef.current?.offsetWidth || 500) - 200),
                bottom: CHART_HEIGHT + 28,
              }}
            >
              <div className="threat-timeline__tooltip-row">
                <span className="threat-timeline__tooltip-label">TIME</span>
                <span>{formatTime(tooltip.bucket.timestamp)}</span>
              </div>
              <div className="threat-timeline__tooltip-row">
                <span className="threat-timeline__tooltip-label">THREATS</span>
                <span
                  style={{
                    color:
                      SEVERITY_COLORS[tooltip.bucket.maxSeverity] ||
                      'var(--text-primary)',
                  }}
                >
                  {tooltip.bucket.count}
                </span>
              </div>
              <div className="threat-timeline__tooltip-row">
                <span className="threat-timeline__tooltip-label">SEVERITY</span>
                <span
                  style={{
                    color:
                      SEVERITY_COLORS[tooltip.bucket.maxSeverity] ||
                      'var(--text-primary)',
                  }}
                >
                  {(tooltip.bucket.maxSeverity || 'none').toUpperCase()}
                </span>
              </div>
              {tooltip.bucket.nodes.length > 0 && (
                <div className="threat-timeline__tooltip-row">
                  <span className="threat-timeline__tooltip-label">NODES</span>
                  <span>{tooltip.bucket.nodes.join(', ')}</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
