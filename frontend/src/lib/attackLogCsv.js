/**
 * attackLogCsv.js
 *
 * Pure helper: converts attack log records to a CSV string.
 *
 * Format:
 *   - UTF-8 BOM prefix so Excel opens it correctly
 *   - CRLF line endings
 *   - All fields wrapped in double-quotes
 *   - Internal double-quotes doubled ("")
 *
 * Columns (in order):
 *   time, attack_name, severity, count, attempts,
 *   attacker_ip, source, target_host, target_ip, summary
 */

const CSV_COLUMNS = [
  'time',
  'attack_name',
  'severity',
  'count',
  'attempts',
  'attacker_ip',
  'source',
  'target_host',
  'target_ip',
  'summary',
];

/**
 * Escape a single CSV field:
 * - Wrap in double quotes
 * - Double any existing double-quote inside the value
 */
function escapeField(value) {
  const str = value == null ? '' : String(value);
  return '"' + str.replace(/"/g, '""') + '"';
}

/**
 * Convert an array of attack log records to a CSV string.
 * Records are already newest-first; we preserve that order.
 *
 * @param {Array} records - attack log records from useAttackLog
 * @returns {string}      - complete CSV content with BOM
 */
export function toCsv(records) {
  const BOM = '\uFEFF';
  const CRLF = '\r\n';

  const header = CSV_COLUMNS.map(escapeField).join(',');

  const rows = records.map((r) => {
    return [
      escapeField(r.time),
      escapeField(r.attackName),
      escapeField(r.severity),
      escapeField(r.count),
      escapeField(r.attempts),
      escapeField(r.attackerIp),
      escapeField(r.source),
      escapeField(r.targetHost),
      escapeField(r.targetIp),
      escapeField(r.summary),
    ].join(',');
  });

  return BOM + [header, ...rows].join(CRLF) + CRLF;
}

/**
 * Trigger a CSV download in the browser.
 * Creates a temporary Blob URL, clicks an invisible <a> element, then revokes the URL.
 *
 * @param {Array}  records - attack log records
 * @param {string} [filename] - override the auto-generated filename
 */
export function downloadCsv(records, filename) {
  const csv = toCsv(records);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const ts = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const name =
    filename ||
    `netsentinel-attack-log-${ts.getFullYear()}${pad(ts.getMonth() + 1)}${pad(
      ts.getDate()
    )}-${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}.csv`;

  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  // Revoke after a brief delay to let the browser start the download
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
