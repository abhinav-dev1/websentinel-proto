import { useUptime } from '../hooks/useUptime';

/**
 * Top status bar — minimal typographic display of key metrics.
 * No card borders, no boxes — just clean data hierarchy.
 */
export default function StatusBar({ nodeCount, threatCount, isConnected }) {
  const uptime = useUptime();

  return (
    <header className="status-bar" id="status-bar">
      {/* Brand */}
      <div className="status-bar__brand">
        <span className="status-bar__dot" />
        WEBSENTINEL
      </div>

      {/* Metrics */}
      <div className="status-bar__metrics">
        <div className="status-bar__metric">
          <span className="status-bar__metric-label">Nodes</span>
          <span className="status-bar__metric-value">{nodeCount}</span>
        </div>

        <div className="status-bar__metric">
          <span className="status-bar__metric-label">Threats</span>
          <span
            className={`status-bar__metric-value ${
              threatCount > 0 ? 'status-bar__metric-value--threat' : ''
            }`}
          >
            {threatCount}
          </span>
        </div>

        <div className="status-bar__metric">
          <span className="status-bar__metric-label">Uptime</span>
          <span className="status-bar__metric-value">{uptime}</span>
        </div>
      </div>

      {/* Connection status */}
      <div className="status-bar__connection">
        <span
          className={`status-bar__connection-dot ${
            isConnected
              ? 'status-bar__connection-dot--connected'
              : 'status-bar__connection-dot--disconnected'
          }`}
        />
        {isConnected ? 'LIVE' : 'RECONNECTING'}
      </div>
    </header>
  );
}
