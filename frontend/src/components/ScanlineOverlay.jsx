/**
 * Full-viewport scanline + CRT grain overlay.
 * CSS-only effect rendered as an overlay with pointer-events: none.
 */
export default function ScanlineOverlay() {
  return <div className="scanline-overlay" aria-hidden="true" />;
}
