export const KINDS = {
  conflict: { label: 'Conflict', one: 'Conflict', code: 'CF', color: '#ff453a' },
  news: { label: 'News', one: 'News', code: 'NW', color: '#c7c9d1' },
  quake: { label: 'Quakes', one: 'Quake', code: 'EQ', color: '#ff9f0a' },
  storm: { label: 'Storms', one: 'Storm', code: 'TS', color: '#64d2ff' },
  fire: { label: 'Fires', one: 'Fire', code: 'WF', color: '#ffd60a' },
  volcano: { label: 'Volcanoes', one: 'Volcano', code: 'VO', color: '#e0a96d' },
  flood: { label: 'Floods', one: 'Flood', code: 'FL', color: '#0a84ff' },
  weather: { label: 'Weather', one: 'Weather', code: 'WX', color: '#66d4a8' },
};

export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a))})`;
}

export function fmtPrice(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  const a = Math.abs(n);
  const d = a >= 1000 ? 2 : a >= 1 ? 2 : a >= 0.01 ? 4 : 6;
  return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}
export function fmtMoney(n, sign = false) {
  if (n == null || !Number.isFinite(n)) return '—';
  const s = Math.abs(n).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (n < 0 ? '−' : sign && n > 0 ? '+' : '') + s;
}
export function fmtPct(x, digits = 2) {
  if (x == null || !Number.isFinite(x)) return '—';
  return `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x * 100).toFixed(digits)}%`;
}
export const cls = (x) => (x > 0 ? 'up' : x < 0 ? 'down' : '');

export function timeAgo(t) {
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return `${Math.floor(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}
export function fmtTime(t) {
  return new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
}
export const truncate = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function sevLabel(s) {
  if (s >= 0.8) return ['Critical', '#ff4d5e'];
  if (s >= 0.6) return ['High', '#ff7a2f'];
  if (s >= 0.35) return ['Elevated', '#ffb547'];
  return ['Low', '#6f7f95'];
}

// Shared with the autopilot (src/shared/exposures.js, loaded as a classic script).
export const exposures = (e) => window.LodestarExposures.exposures(e);

// Hot-iron thermal palette (black -> deep red -> orange -> yellow -> white).
const HEAT = [[0, [4, 2, 10]], [0.18, [40, 6, 24]], [0.35, [110, 14, 22]], [0.52, [196, 40, 12]], [0.68, [245, 104, 18]], [0.82, [255, 176, 40]], [0.93, [255, 226, 120]], [1, [255, 252, 232]]];
export const HEAT_LUT = Array.from({ length: 256 }, (_, i) => {
  const t = i / 255;
  let k = 0;
  while (k < HEAT.length - 2 && t > HEAT[k + 1][0]) k++;
  const [t0, c0] = HEAT[k], [t1, c1] = HEAT[k + 1];
  const f = (t - t0) / (t1 - t0 || 1);
  return c0.map((v, j) => Math.round(v + (c1[j] - v) * f));
});
export function heat(t, a = 1) {
  const [r, g, b] = HEAT_LUT[Math.max(0, Math.min(255, Math.round(t * 255)))];
  return `rgba(${r},${g},${b},${a})`;
}
