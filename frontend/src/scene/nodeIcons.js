/**
 * nodeIcons.js
 *
 * Draws crisp white/green SVG-style icons onto an offscreen canvas and
 * returns a cached THREE.CanvasTexture.  No new npm dependencies.
 *
 * Exported API:
 *   getIconTexture(hostname, type) → THREE.CanvasTexture
 *   disposeIconTextures()          → call on unmount to free GPU memory
 */
import * as THREE from 'three';

// ─── Icon key resolver ──────────────────────────────────────────────────────

function iconKeyFor(hostname, type) {
  const h = hostname || '';
  if (h === 'gw-router')        return 'router';
  if (h === 'web-srv-01')       return 'server-rack';
  if (h === 'db-primary')       return 'database';
  if (h === 'nas-backup')       return 'database';
  if (h === 'api-gateway')      return 'api-gateway';
  if (h === 'dev-laptop-mk')    return 'laptop';
  if (h === 'dev-laptop-sr')    return 'laptop';
  if (h === 'print-srv')        return 'printer';
  if (h === 'redis-cache' || h.toLowerCase() === 'redis-cache') return 'database';
  if (h === 'iot-thermostat')   return 'chip';
  if (h === 'vpn-endpoint')     return 'shield';
  if (h === 'mail-srv')         return 'envelope';
  if (h === 'monitoring-agent') return 'pulse';
  if (type === 'external')      return 'warning';
  // Fallback by type
  if (type === 'router')        return 'router';
  if (type === 'storage')       return 'database';
  if (type === 'workstation')   return 'laptop';
  if (type === 'iot')           return 'chip';
  return 'server-rack'; // default
}

// ─── Canvas size ────────────────────────────────────────────────────────────

const SIZE = 128;
const C = SIZE / 2; // centre
const R = SIZE * 0.36; // drawing radius

// ─── Draw helpers ──────────────────────────────────────────────────────────

function makeCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width  = SIZE;
  canvas.height = SIZE;
  return canvas;
}

function prepare(canvas) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, SIZE, SIZE);
  ctx.strokeStyle = '#FFFFFF';
  ctx.fillStyle   = '#FFFFFF';
  ctx.lineCap     = 'round';
  ctx.lineJoin    = 'round';
  return ctx;
}

// ─── Individual icon drawers ────────────────────────────────────────────────

function drawRouter(ctx) {
  // Box body
  const bx = C - R * 0.7, by = C - R * 0.3;
  const bw = R * 1.4,       bh = R * 0.6;
  ctx.lineWidth = SIZE * 0.055;
  ctx.strokeRect(bx, by, bw, bh);

  // Three dot lights on the box
  ctx.fillStyle = '#FFFFFF';
  [-0.3, 0, 0.3].forEach((dx) => {
    ctx.beginPath();
    ctx.arc(C + dx * R * 0.8, C + R * 0.04, SIZE * 0.04, 0, Math.PI * 2);
    ctx.fill();
  });

  // Two antennas
  ctx.lineWidth = SIZE * 0.045;
  ctx.beginPath();
  ctx.moveTo(C - R * 0.4, by);
  ctx.lineTo(C - R * 0.4, C - R * 0.85);
  ctx.moveTo(C + R * 0.4, by);
  ctx.lineTo(C + R * 0.4, C - R * 0.85);
  ctx.stroke();

  // Antenna tips
  ctx.fillStyle = '#FFFFFF';
  [C - R * 0.4, C + R * 0.4].forEach((ax) => {
    ctx.beginPath();
    ctx.arc(ax, C - R * 0.85, SIZE * 0.05, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawServerRack(ctx) {
  // Three stacked rack units
  const w = R * 1.3, unit = R * 0.42;
  const startY = C - unit * 1.5;
  ctx.lineWidth = SIZE * 0.055;
  for (let i = 0; i < 3; i++) {
    ctx.strokeRect(C - w / 2, startY + i * (unit + SIZE * 0.04), w, unit);
    // small dot per unit
    ctx.beginPath();
    ctx.arc(C + w / 2 - SIZE * 0.09, startY + i * (unit + SIZE * 0.04) + unit / 2, SIZE * 0.04, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawDatabase(ctx) {
  // Cylinder top ellipse + body
  const ew = R * 1.2, eh = R * 0.28;
  const bodyH = R * 1.0;
  const topY  = C - bodyH * 0.5;
  const botY  = topY + bodyH;

  ctx.lineWidth = SIZE * 0.055;

  // Body sides
  ctx.beginPath();
  ctx.moveTo(C - ew / 2, topY);
  ctx.lineTo(C - ew / 2, botY);
  ctx.moveTo(C + ew / 2, topY);
  ctx.lineTo(C + ew / 2, botY);
  ctx.stroke();

  // Top ellipse
  ctx.beginPath();
  ctx.ellipse(C, topY, ew / 2, eh / 2, 0, 0, Math.PI * 2);
  ctx.stroke();

  // Bottom ellipse
  ctx.beginPath();
  ctx.ellipse(C, botY, ew / 2, eh / 2, 0, 0, Math.PI * 2);
  ctx.stroke();

  // Middle ellipse (stacked layer feel)
  ctx.beginPath();
  ctx.ellipse(C, topY + bodyH * 0.42, ew / 2, eh / 2, 0, 0, Math.PI * 2);
  ctx.stroke();
}

function drawApiGateway(ctx) {
  // Cloud-gateway: circle with two arrows in/out
  ctx.lineWidth = SIZE * 0.055;

  // Circle
  ctx.beginPath();
  ctx.arc(C, C, R * 0.62, 0, Math.PI * 2);
  ctx.stroke();

  // Arrow in (left -> right into circle)
  const ay = C - R * 0.22;
  ctx.beginPath();
  ctx.moveTo(C - R * 1.05, ay);
  ctx.lineTo(C - R * 0.62, ay);
  ctx.stroke();
  // arrowhead
  ctx.beginPath();
  ctx.moveTo(C - R * 0.62, ay - SIZE * 0.07);
  ctx.lineTo(C - R * 0.45, ay);
  ctx.lineTo(C - R * 0.62, ay + SIZE * 0.07);
  ctx.fill();

  // Arrow out (circle -> right)
  const by2 = C + R * 0.22;
  ctx.beginPath();
  ctx.moveTo(C + R * 0.62, by2);
  ctx.lineTo(C + R * 1.05, by2);
  ctx.stroke();
  // arrowhead
  ctx.beginPath();
  ctx.moveTo(C + R * 0.88, by2 - SIZE * 0.07);
  ctx.lineTo(C + R * 1.05, by2);
  ctx.lineTo(C + R * 0.88, by2 + SIZE * 0.07);
  ctx.fill();
}

function drawLaptop(ctx) {
  // Screen
  const sw = R * 1.3, sh = R * 0.85;
  const sx = C - sw / 2, sy = C - R * 0.9;
  ctx.lineWidth = SIZE * 0.055;
  ctx.strokeRect(sx, sy, sw, sh);

  // Base (keyboard)
  ctx.beginPath();
  ctx.moveTo(sx - SIZE * 0.08, sy + sh);
  ctx.lineTo(sx + sw + SIZE * 0.08, sy + sh);
  ctx.lineTo(sx + sw + SIZE * 0.14, sy + sh + R * 0.28);
  ctx.lineTo(sx - SIZE * 0.14, sy + sh + R * 0.28);
  ctx.closePath();
  ctx.stroke();
}

function drawPrinter(ctx) {
  // Printer body
  const pw = R * 1.35, ph = R * 0.65;
  const px = C - pw / 2, py = C - ph * 0.4;
  ctx.lineWidth = SIZE * 0.055;
  ctx.strokeRect(px, py, pw, ph);

  // Paper tray out bottom
  const tw = pw * 0.65;
  ctx.strokeRect(C - tw / 2, py + ph, tw, R * 0.35);

  // Paper sheet in top slot
  ctx.beginPath();
  ctx.moveTo(C - tw * 0.4, py);
  ctx.lineTo(C - tw * 0.4, py - R * 0.35);
  ctx.lineTo(C + tw * 0.4, py - R * 0.35);
  ctx.lineTo(C + tw * 0.4, py);
  ctx.stroke();
}

function drawChip(ctx) {
  // Central square
  const s = R * 0.75;
  ctx.lineWidth = SIZE * 0.055;
  ctx.strokeRect(C - s / 2, C - s / 2, s, s);

  // Grid lines inside
  ctx.lineWidth = SIZE * 0.03;
  ctx.beginPath();
  ctx.moveTo(C, C - s / 2); ctx.lineTo(C, C + s / 2);
  ctx.moveTo(C - s / 2, C); ctx.lineTo(C + s / 2, C);
  ctx.stroke();

  // Pins — 3 per side
  ctx.lineWidth = SIZE * 0.04;
  const pinLen = R * 0.4;
  const pinOffsets = [-s * 0.28, 0, s * 0.28];
  pinOffsets.forEach((off) => {
    // top
    ctx.beginPath(); ctx.moveTo(C + off, C - s / 2); ctx.lineTo(C + off, C - s / 2 - pinLen); ctx.stroke();
    // bottom
    ctx.beginPath(); ctx.moveTo(C + off, C + s / 2); ctx.lineTo(C + off, C + s / 2 + pinLen); ctx.stroke();
    // left
    ctx.beginPath(); ctx.moveTo(C - s / 2, C + off); ctx.lineTo(C - s / 2 - pinLen, C + off); ctx.stroke();
    // right
    ctx.beginPath(); ctx.moveTo(C + s / 2, C + off); ctx.lineTo(C + s / 2 + pinLen, C + off); ctx.stroke();
  });
}

function drawShield(ctx) {
  // Shield outline
  ctx.lineWidth = SIZE * 0.055;
  ctx.beginPath();
  ctx.moveTo(C, C - R);
  ctx.lineTo(C + R * 0.85, C - R * 0.45);
  ctx.lineTo(C + R * 0.85, C + R * 0.1);
  ctx.quadraticCurveTo(C + R * 0.85, C + R * 0.85, C, C + R);
  ctx.quadraticCurveTo(C - R * 0.85, C + R * 0.85, C - R * 0.85, C + R * 0.1);
  ctx.lineTo(C - R * 0.85, C - R * 0.45);
  ctx.closePath();
  ctx.stroke();

  // Lock body
  const lw = R * 0.45, lh = R * 0.38;
  ctx.strokeRect(C - lw / 2, C - R * 0.05, lw, lh);
  // Lock shackle
  ctx.beginPath();
  ctx.arc(C, C - R * 0.05, lw * 0.38, Math.PI, 0);
  ctx.stroke();
}

function drawEnvelope(ctx) {
  const ew = R * 1.4, eh = R * 0.95;
  const ex = C - ew / 2, ey = C - eh / 2;
  ctx.lineWidth = SIZE * 0.055;
  ctx.strokeRect(ex, ey, ew, eh);

  // Flap V
  ctx.beginPath();
  ctx.moveTo(ex, ey);
  ctx.lineTo(C, ey + eh * 0.52);
  ctx.lineTo(ex + ew, ey);
  ctx.stroke();
}

function drawPulse(ctx) {
  // EKG/pulse wave
  ctx.lineWidth = SIZE * 0.06;
  ctx.beginPath();
  ctx.moveTo(C - R, C);
  ctx.lineTo(C - R * 0.55, C);
  ctx.lineTo(C - R * 0.3, C - R * 0.75);
  ctx.lineTo(C - R * 0.05, C + R * 0.6);
  ctx.lineTo(C + R * 0.2, C);
  ctx.lineTo(C + R, C);
  ctx.stroke();
}

function drawWarning(ctx) {
  // Warning triangle (attacker / external) — drawn in red-tinted white
  ctx.strokeStyle = '#FF6B6B';
  ctx.fillStyle   = '#FF6B6B';
  ctx.lineWidth = SIZE * 0.06;

  // Triangle
  ctx.beginPath();
  ctx.moveTo(C, C - R * 0.95);
  ctx.lineTo(C + R * 0.88, C + R * 0.65);
  ctx.lineTo(C - R * 0.88, C + R * 0.65);
  ctx.closePath();
  ctx.stroke();

  // Exclamation mark
  ctx.lineWidth = SIZE * 0.065;
  ctx.beginPath();
  ctx.moveTo(C, C - R * 0.35);
  ctx.lineTo(C, C + R * 0.25);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(C, C + R * 0.44, SIZE * 0.045, 0, Math.PI * 2);
  ctx.fill();
}

// ─── Drawer map ─────────────────────────────────────────────────────────────

const DRAWERS = {
  'router':      drawRouter,
  'server-rack': drawServerRack,
  'database':    drawDatabase,
  'api-gateway': drawApiGateway,
  'laptop':      drawLaptop,
  'printer':     drawPrinter,
  'chip':        drawChip,
  'shield':      drawShield,
  'envelope':    drawEnvelope,
  'pulse':       drawPulse,
  'warning':     drawWarning,
};

// ─── Texture cache ──────────────────────────────────────────────────────────

const textureCache = new Map(); // key -> THREE.CanvasTexture

export function getIconTexture(hostname, type) {
  const key = iconKeyFor(hostname, type);

  if (textureCache.has(key)) return textureCache.get(key);

  const canvas = makeCanvas();
  const ctx = prepare(canvas);

  const drawer = DRAWERS[key] || DRAWERS['server-rack'];
  drawer(ctx);

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  tex.colorSpace = THREE.SRGBColorSpace;
  textureCache.set(key, tex);
  return tex;
}

export function disposeIconTextures() {
  textureCache.forEach((tex) => tex.dispose());
  textureCache.clear();
}
