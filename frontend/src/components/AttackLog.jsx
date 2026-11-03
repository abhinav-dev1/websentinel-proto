import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { downloadCsv } from '../lib/attackLogCsv';

/**
 * Build a "web-srv-01, api-gateway" summary (each server listed once, no counts).
 */
function buildServerSummary(records) {
  const seen = new Set();
  for (const r of records) {
    const key = r.targetHost || '-';
    seen.add(key);
  }
  return [...seen].join(', ');
}

/**
 * A single attack record card.
 */
function AttackRecord({ record, onClickRecord }) {
  const isOrange = record.color === '#FF8A1F';

  return (
    <div
      className={`attack-log__record ${
        isOrange ? 'attack-log__record--orange' : 'attack-log__record--darkred'
      }`}
      title={record.summary}
      onClick={() => onClickRecord(record)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onClickRecord(record)}
    >
      {/* Line 1: time, attack name in bold, badge */}
      <div className="attack-log__record-line1">
        <span className="attack-log__record-time">{record.time}</span>
        <span className="attack-log__record-name">{record.attackName}</span>
        <span
          className={`attack-log__badge ${
            record.badgeText === 'MEDIUM'
              ? 'attack-log__badge--medium'
              : 'attack-log__badge--high'
          }`}
        >
          {record.badgeText}
        </span>
      </div>

      {/* Line 2: [ATTACKER IP · source]  →  [TARGET host · IP] */}
      <div className="attack-log__record-chips">
        <div className="attack-log__chip attack-log__chip--attacker">
          <span className="attack-log__chip-label">ATTACKER</span>
          <span className="attack-log__chip-val">{record.attackerIp}</span>
          <span className="attack-log__chip-sep">·</span>
          <span className="attack-log__chip-sub">{record.source}</span>
        </div>
        <span className="attack-log__chips-arrow">→</span>
        <div className="attack-log__chip attack-log__chip--target">
          <span className="attack-log__chip-label">TARGET</span>
          <span className="attack-log__chip-val">{record.targetHost}</span>
          <span className="attack-log__chip-sep">·</span>
          <span className="attack-log__chip-val">{record.targetIp}</span>
        </div>
      </div>

      {/* Line 3: attempts in plain words */}
      <div className="attack-log__record-line3">{record.attempts}</div>
    </div>
  );
}

/**
 * AttackLog — button + popover box.
 */
export default function AttackLog({ records, onClear, onClickRecord, reducedMotion }) {
  const [open, setOpen] = useState(false);
  const [boxStyle, setBoxStyle] = useState({});
  const boxRef = useRef(null);
  const btnRef = useRef(null);
  const listRef = useRef(null);
  const count = records.length;

  // Preserve scroll position when new cards arrive at the top.
  // When the user is scrolled to the top (scrollTop === 0), keep them at top
  // (the browser does this naturally for prepended DOM children).
  // When scrolled down, we pin their view so new cards don't jump them.
  const prevCountRef = useRef(count);
  useLayoutEffect(() => {
    const listEl = listRef.current;
    if (!listEl) return;
    const prevCount = prevCountRef.current;
    const addedCards = count - prevCount;
    prevCountRef.current = count;

    // Only compensate when new cards were prepended and the user is NOT at the top
    if (addedCards > 0 && listEl.scrollTop > 0) {
      // Each card is roughly the same height; read actual rendered delta
      // by observing how much the scrollHeight grew
      // We can't read the "before" scrollHeight here, so we store it before the update.
      // Instead, rely on the stored height set in the previous layout pass:
      if (listEl._prevScrollHeight != null) {
        const delta = listEl.scrollHeight - listEl._prevScrollHeight;
        if (delta > 0) {
          listEl.scrollTop += delta;
        }
      }
    }
    // Store current scrollHeight for next time
    listEl._prevScrollHeight = listEl.scrollHeight;
  });

  // Clamped anchoring to button with at least 16px free space from every screen edge
  useLayoutEffect(() => {
    if (!open) return;

    function updatePosition() {
      if (!btnRef.current) return;
      const btnRect = btnRef.current.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const boxWidth = Math.min(480, vw - 32);

      // Clamp horizontally: at least 16px from screen left and right
      let left = Math.max(16, Math.min(btnRect.left, vw - boxWidth - 16));

      // Avoid overlapping Event Feed (.app-layout__log)
      const logEl = document.querySelector('.app-layout__log');
      if (logEl) {
        const logRect = logEl.getBoundingClientRect();
        if (logRect.left < vw && logRect.width > 0 && left + boxWidth > logRect.left - 16) {
          left = Math.max(16, logRect.left - 16 - boxWidth);
        }
      }

      // Vertical position: sit above the button, clamp bottom and top to at least 16px from edges
      const bottom = Math.max(16, vh - btnRect.top + 8);
      const maxHeight = Math.max(180, vh - bottom - 16);

      setBoxStyle({
        position: 'fixed',
        left: `${left}px`,
        bottom: `${bottom}px`,
        width: `${boxWidth}px`,
        maxHeight: `${maxHeight}px`,
      });
    }

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open]);

  // Close on Esc
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open]);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (
        boxRef.current &&
        !boxRef.current.contains(e.target) &&
        btnRef.current &&
        !btnRef.current.contains(e.target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleRecord = useCallback(
    (record) => {
      setOpen(false);
      onClickRecord?.(record);
    },
    [onClickRecord]
  );

  const serverSummary = records.length > 0 ? buildServerSummary(records) : null;

  return (
    <div className="attack-log-wrapper">
      {/* Popover box */}
      {open && (
        <div
          ref={boxRef}
          style={boxStyle}
          className={`attack-log__box${reducedMotion ? ' attack-log__box--no-anim' : ''}`}
          role="dialog"
          aria-label="Attack Log"
        >
          {/* Header */}
          <div className="attack-log__box-header">
            <span className="attack-log__box-title">ATTACK LOG</span>
            <div className="attack-log__box-actions">
              <button
                type="button"
                className="attack-log__action-btn"
                onClick={() => {
                  if (records.length > 0) downloadCsv(records);
                }}
                disabled={records.length === 0}
                title="Download CSV report"
              >
                REPORT
              </button>
              <button
                type="button"
                className="attack-log__action-btn attack-log__action-btn--clear"
                onClick={() => {
                  onClear?.();
                }}
                title="Clear attack log"
              >
                CLEAR
              </button>
            </div>
          </div>

          {/* Server summary: names only, no counts, hidden when empty */}
          {serverSummary && (
            <div className="attack-log__server-summary">
              {'Servers hit: '}
              {serverSummary}
            </div>
          )}

          {/* Record list */}
          <div className="attack-log__list" ref={listRef}>
            {records.length === 0 ? (
              <div className="attack-log__empty">No attacks detected yet.</div>
            ) : (
              records.map((r) => (
                <AttackRecord
                  key={r.id}
                  record={r}
                  onClickRecord={handleRecord}
                />
              ))
            )}
          </div>
        </div>
      )}

      {/* Pill button */}
      <button
        ref={btnRef}
        type="button"
        className={`attack-log__pill${open ? ' attack-log__pill--active' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        id="attack-log-toggle"
      >
        <span className="attack-log__pill-label">ATTACK LOG</span>
        <span
          className={`attack-log__pill-badge${
            count > 0 ? ' attack-log__pill-badge--hot' : ''
          }`}
        >
          {count}
        </span>
      </button>
    </div>
  );
}
