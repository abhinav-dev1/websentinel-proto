import { useRef, useState, useEffect, memo } from 'react';
import { Virtuoso } from 'react-virtuoso';

/**
 * Memoized row component for virtualized event feed.
 * Keyed by _seq, plays slide-in animation only for freshly arrived rows.
 */
const EventRow = memo(function EventRow({ event }) {
  // Fresh arrival animation only: true on initial mount if received recently,
  // false if scrolled into view later
  const [isFresh] = useState(
    () => Boolean(event._receivedAt && Date.now() - event._receivedAt < 1000)
  );

  const formatTime = (isoString) => {
    try {
      const d = new Date(isoString);
      return d.toLocaleTimeString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch {
      return '00:00:00';
    }
  };

  const getSeverityClass = (ev) => {
    if (ev.threat && ev.severity === 'critical') return 'event-log__entry--critical';
    if (ev.threat && ev.severity === 'medium') return 'event-log__entry--medium';
    return 'event-log__entry--normal';
  };

  const formatEventType = (type) => {
    return (type || 'unknown').toUpperCase().replace(/_/g, ' ');
  };

  return (
    <div
      className={`event-log__entry ${getSeverityClass(event)} ${
        isFresh ? 'event-log__entry--animate' : ''
      }`}
    >
      <span className="event-log__timestamp">
        [{formatTime(event.timestamp)}]
      </span>
      <span className="event-log__type">
        {formatEventType(event.event_type)}
      </span>
      {' — '}
      {event.message}
      {event.source_hostname && (
        <span className="event-log__hosts">
          {' '}({event.source_hostname} → {event.target_hostname})
        </span>
      )}
    </div>
  );
});

/**
 * Virtualized terminal-style event feed using react-virtuoso.
 * Features:
 * - Variable-height rows memoized and keyed by _seq
 * - Smooth live following when at bottom
 * - Anchored view when scrolled up (immune to buffer trimming)
 * - "↓ N new events" scroll-to-latest button
 */
export default function EventLog({ events = [], totalEvents }) {
  const virtuosoRef = useRef(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);
  const lastSeenSeqRef = useRef(0);

  // Track unread events while scrolled away from the bottom
  useEffect(() => {
    if (events.length === 0) {
      setUnreadCount(0);
      lastSeenSeqRef.current = 0;
      return;
    }

    const latestSeq = events[events.length - 1]._seq ?? 0;

    if (isAtBottom) {
      lastSeenSeqRef.current = latestSeq;
      setUnreadCount(0);
    } else {
      const unread = Math.max(0, latestSeq - lastSeenSeqRef.current);
      setUnreadCount(unread);
    }
  }, [events, isAtBottom]);

  const handleScrollToBottom = () => {
    virtuosoRef.current?.scrollToIndex({
      index: 'LAST',
      align: 'end',
      behavior: 'smooth',
    });
    const latestSeq = events.length > 0 ? (events[events.length - 1]._seq ?? 0) : 0;
    lastSeenSeqRef.current = latestSeq;
    setUnreadCount(0);
    setIsAtBottom(true);
  };

  const displayCount = totalEvents ?? events.length;

  return (
    <aside className="event-log" id="event-log">
      {/* Header */}
      <div className="event-log__header">
        <span>Event Feed</span>
        <span>{displayCount.toLocaleString()} events</span>
      </div>

      {/* Terminal prompt */}
      <div className="event-log__prompt">
        <span>root@websentinel:~$</span> monitoring...
      </div>

      {/* Virtualized event feed */}
      <Virtuoso
        ref={virtuosoRef}
        className="event-log__feed"
        data={events}
        firstItemIndex={events.length > 0 ? (events[0]._seq ?? 0) : 0}
        initialTopMostItemIndex={events.length > 0 ? events.length - 1 : 0}
        followOutput={(bottom) => (bottom ? 'smooth' : false)}
        atBottomThreshold={50}
        atBottomStateChange={(bottom) => {
          setIsAtBottom(bottom);
          if (bottom) {
            setUnreadCount(0);
            if (events.length > 0) {
              lastSeenSeqRef.current = events[events.length - 1]._seq ?? 0;
            }
          }
        }}
        computeItemKey={(index, item) => item._seq ?? index}
        itemContent={(index, event) => <EventRow event={event} />}
        components={{
          EmptyPlaceholder: () => (
            <div className="event-log__entry event-log__entry--normal">
              Waiting for network events...
            </div>
          ),
        }}
      />

      {/* Scroll back to latest button */}
      {unreadCount > 0 && (
        <button
          type="button"
          className="event-log__scroll-btn"
          onClick={handleScrollToBottom}
        >
          ↓ {unreadCount.toLocaleString()} new events
        </button>
      )}
    </aside>
  );
}
