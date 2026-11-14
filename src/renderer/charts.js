// Small, fast canvas charts written for Lodestar (no third-party chart library).
const FONT = '10px "IBM Plex Mono", monospace';
const AXIS = 'rgba(150,190,196,0.75)';
const GRID = 'rgba(87,199,212,0.08)';

function fmt(v) {
  if (!Number.isFinite(v)) return '';
  const a = Math.abs(v);
  const d = a >= 10000 ? 0 : a >= 100 ? 2 : a >= 1 ? 2 : 4;
  return v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}
function timeLabel(sec, span) {
  const d = new Date(sec * 1000);
  if (span < 2 * 86400) return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  if (span < 200 * 86400) return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
}

class Base {
  constructor(host) {
    this.host = host;
    this.c = document.createElement('canvas');
    Object.assign(this.c.style, { position: 'absolute', inset: '0', width: '100%', height: '100%' });
    host.appendChild(this.c);
    this.ctx = this.c.getContext('2d');
    this.hover = null;
    new ResizeObserver(() => this.resize()).observe(host);
    this.c.addEventListener('mousemove', (e) => { const r = this.c.getBoundingClientRect(); this.hover = { x: e.clientX - r.left, y: e.clientY - r.top }; this.draw(); });
    this.c.addEventListener('mouseleave', () => { this.hover = null; this.draw(); });
    this.resize();
  }
  resize() {
    const r = this.host.getBoundingClientRect();
    if (!r.width) return;
    const dpr = window.devicePixelRatio || 1;
    this.w = r.width; this.h = r.height;
    this.c.width = r.width * dpr; this.c.height = r.height * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw();
  }
  empty(msg) {
    const { ctx } = this;
    ctx.font = FONT; ctx.fillStyle = AXIS; ctx.textAlign = 'center';
    ctx.fillText(msg, this.w / 2, this.h / 2); ctx.textAlign = 'left';
  }
  axisLabel(y, text, bg, fg = '#000') {
    const { ctx } = this;
    ctx.font = FONT;
    const tw = ctx.measureText(text).width;
    ctx.fillStyle = bg; ctx.fillRect(this.w - 62, y - 7, Math.max(58, tw + 8), 14);
    ctx.fillStyle = fg; ctx.fillText(text, this.w - 58, y + 3.5);
  }
}

export class CandleChart extends Base {
  constructor(host, opts = {}) {
    super(host);
    this.up = opts.up || '#3ddc84';
    this.down = opts.down || '#ff5a4e';
    this.data = [];
    this.lines = [];
  }
  setData(candles) { this.data = candles || []; this.draw(); }
  setLines(lines) { this.lines = lines || []; this.draw(); }
  tick(price) {
    const c = this.data.at(-1);
    if (!c || !Number.isFinite(price)) return;
    c.close = price; c.high = Math.max(c.high, price); c.low = Math.min(c.low, price);
    this.draw();
  }
  draw() {
    const { ctx, w, h, data } = this;
    if (!w) return;
    ctx.clearRect(0, 0, w, h);
    if (!data.length) return this.empty('NO DATA');
    const L = 8, R = 66, T = 10, B = 20;
    const pw = w - L - R, ph = h - T - B, vh = ph * 0.16;
    let lo = Infinity, hi = -Infinity;
    for (const c of data) { if (c.low < lo) lo = c.low; if (c.high > hi) hi = c.high; }
    for (const l of this.lines) { if (l.price < lo) lo = l.price; if (l.price > hi) hi = l.price; }
    const padv = (hi - lo) * 0.06 || hi * 0.01 || 1;
    lo -= padv; hi += padv;
    const n = data.length;
    const step = pw / n, bw = Math.max(1, step * 0.62);
    const x = (i) => L + (i + 0.5) * step;
    const y = (v) => T + ((hi - v) / (hi - lo)) * (ph - vh - 6);

    // grid + price axis
    ctx.font = FONT; ctx.lineWidth = 1;
    for (let k = 0; k <= 4; k++) {
      const v = lo + ((hi - lo) * k) / 4, yy = Math.round(y(v)) + 0.5;
      ctx.strokeStyle = GRID; ctx.beginPath(); ctx.moveTo(L, yy); ctx.lineTo(w - R, yy); ctx.stroke();
      ctx.fillStyle = AXIS; ctx.fillText(fmt(v), w - R + 6, yy + 3.5);
    }
    // time axis
    const span = data[n - 1].time - data[0].time;
    const ticks = Math.max(2, Math.floor(pw / 110));
    for (let k = 0; k <= ticks; k++) {
      const i = Math.min(n - 1, Math.round((k / ticks) * (n - 1)));
      const label = timeLabel(data[i].time, span);
      const xx = Math.min(Math.max(x(i), L + 18), w - R - 18);
      ctx.fillStyle = AXIS; ctx.textAlign = 'center'; ctx.fillText(label, xx, h - 6); ctx.textAlign = 'left';
    }
    // volume
    const vmax = Math.max(...data.map((c) => c.volume || 0), 1);
    for (let i = 0; i < n; i++) {
      const c = data[i], vhh = ((c.volume || 0) / vmax) * vh;
      ctx.fillStyle = c.close >= c.open ? 'rgba(61,220,132,0.22)' : 'rgba(255,90,78,0.22)';
      ctx.fillRect(x(i) - bw / 2, T + ph - vhh, bw, vhh);
    }
    // candles
    for (let i = 0; i < n; i++) {
      const c = data[i], up = c.close >= c.open, col = up ? this.up : this.down;
      const xx = Math.round(x(i)) + 0.5;
      ctx.strokeStyle = col; ctx.beginPath(); ctx.moveTo(xx, y(c.high)); ctx.lineTo(xx, y(c.low)); ctx.stroke();
      const y0 = y(Math.max(c.open, c.close)), y1 = y(Math.min(c.open, c.close));
      ctx.fillStyle = col; ctx.fillRect(xx - bw / 2, y0, bw, Math.max(1, y1 - y0));
    }
    // reference lines (entry, stop, target)
    for (const l of this.lines) {
      const yy = Math.round(y(l.price)) + 0.5;
      ctx.setLineDash([4, 4]); ctx.strokeStyle = l.color; ctx.beginPath(); ctx.moveTo(L, yy); ctx.lineTo(w - R, yy); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = l.color; ctx.font = FONT; ctx.fillText(l.label, L + 4, yy - 4);
      this.axisLabel(yy, fmt(l.price), l.color);
    }
    // last price
    const last = data[n - 1];
    this.axisLabel(Math.round(y(last.close)) + 0.5, fmt(last.close), last.close >= last.open ? this.up : this.down);

    // crosshair + readout
    if (this.hover && this.hover.x >= L && this.hover.x <= w - R) {
      const i = Math.max(0, Math.min(n - 1, Math.floor((this.hover.x - L) / step)));
      const c = data[i], xx = Math.round(x(i)) + 0.5;
      ctx.strokeStyle = 'rgba(87,199,212,0.45)'; ctx.setLineDash([2, 3]);
      ctx.beginPath(); ctx.moveTo(xx, T); ctx.lineTo(xx, T + ph); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(L, this.hover.y + 0.5); ctx.lineTo(w - R, this.hover.y + 0.5); ctx.stroke(); ctx.setLineDash([]);
      const pv = hi - ((this.hover.y - T) / (ph - vh - 6)) * (hi - lo);
      if (this.hover.y < T + ph - vh) this.axisLabel(this.hover.y, fmt(pv), '#57c7d4');
      ctx.font = FONT; ctx.fillStyle = '#d9e3e6';
      const when = new Date(c.time * 1000).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
      ctx.fillText(`O ${fmt(c.open)}  H ${fmt(c.high)}  L ${fmt(c.low)}  C ${fmt(c.close)}  ·  ${when}`, L + 4, T + 10);
    }
  }
}

export class LineChart extends Base {
  constructor(host, opts = {}) {
    super(host);
    this.color = opts.color || '#57c7d4';
    this.pts = [];
  }
  setData(pts) { this.pts = pts || []; this.draw(); }
  draw() {
    const { ctx, w, h, pts } = this;
    if (!w) return;
    ctx.clearRect(0, 0, w, h);
    if (pts.length < 2) return this.empty('EQUITY HISTORY BUILDS AS PRICES UPDATE');
    const L = 6, R = 66, T = 10, B = 18;
    const pw = w - L - R, ph = h - T - B;
    let lo = Infinity, hi = -Infinity;
    for (const p of pts) { if (p.v < lo) lo = p.v; if (p.v > hi) hi = p.v; }
    const pad = (hi - lo) * 0.1 || Math.abs(hi) * 0.001 || 1;
    lo -= pad; hi += pad;
    const t0 = pts[0].t, t1 = pts.at(-1).t;
    const x = (t) => L + ((t - t0) / (t1 - t0 || 1)) * pw;
    const y = (v) => T + ((hi - v) / (hi - lo)) * ph;
    ctx.font = FONT;
    for (let k = 0; k <= 3; k++) {
      const v = lo + ((hi - lo) * k) / 3, yy = Math.round(y(v)) + 0.5;
      ctx.strokeStyle = GRID; ctx.beginPath(); ctx.moveTo(L, yy); ctx.lineTo(w - R, yy); ctx.stroke();
      ctx.fillStyle = AXIS; ctx.fillText(fmt(v), w - R + 6, yy + 3.5);
    }
    const span = (t1 - t0) / 1000;
    ctx.fillStyle = AXIS;
    ctx.fillText(timeLabel(t0 / 1000, span), L, h - 4);
    ctx.textAlign = 'right'; ctx.fillText(timeLabel(t1 / 1000, span), w - R, h - 4); ctx.textAlign = 'left';
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(x(p.t), y(p.v)) : ctx.moveTo(x(p.t), y(p.v))));
    ctx.strokeStyle = this.color; ctx.lineWidth = 1.6; ctx.stroke();
    ctx.lineTo(x(t1), T + ph); ctx.lineTo(x(t0), T + ph); ctx.closePath();
    const g = ctx.createLinearGradient(0, T, 0, T + ph);
    g.addColorStop(0, 'rgba(87,199,212,0.25)'); g.addColorStop(1, 'rgba(87,199,212,0)');
    ctx.fillStyle = g; ctx.fill(); ctx.lineWidth = 1;
    this.axisLabel(Math.round(y(pts.at(-1).v)) + 0.5, fmt(pts.at(-1).v), this.color);
    if (this.hover && this.hover.x >= L && this.hover.x <= w - R) {
      const tt = t0 + ((this.hover.x - L) / pw) * (t1 - t0);
      let best = pts[0];
      for (const p of pts) if (Math.abs(p.t - tt) < Math.abs(best.t - tt)) best = p;
      const xx = Math.round(x(best.t)) + 0.5;
      ctx.strokeStyle = 'rgba(87,199,212,0.45)'; ctx.setLineDash([2, 3]);
      ctx.beginPath(); ctx.moveTo(xx, T); ctx.lineTo(xx, T + ph); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#d9e3e6';
      ctx.fillText(`${fmt(best.v)}  ·  ${new Date(best.t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}`, L + 4, T + 10);
    }
  }
}

// Tiny sparkline for dashboard rows.
export function spark(cv, data, base, opts = {}) {
  const dpr = window.devicePixelRatio || 1;
  const W = cv.clientWidth || cv.width, H = cv.clientHeight || cv.height;
  if (cv.width !== W * dpr) { cv.width = W * dpr; cv.height = H * dpr; }
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  if (!data || data.length < 2) return;
  const lo = Math.min(...data, base ?? Infinity), hi = Math.max(...data, base ?? -Infinity);
  const y = (v) => H - 2 - ((v - lo) / (hi - lo || 1)) * (H - 4);
  const col = opts.color || (data.at(-1) >= (base ?? data[0]) ? '#3ddc84' : '#ff5a4e');
  ctx.beginPath();
  data.forEach((v, i) => { const x = (i / (data.length - 1)) * W; i ? ctx.lineTo(x, y(v)) : ctx.moveTo(x, y(v)); });
  ctx.strokeStyle = col; ctx.lineWidth = 1.3; ctx.stroke();
}
