import { KINDS, hexA } from './util.js';

// Event timeline strip: the last 72 hours left to right, severity bottom to top.
// Strong events are hollow rings with short codes (like the metro strip on a wall map).
const HOURS = 72;
const BANDS = [[0.35, 'ELEVATED'], [0.6, 'HIGH'], [0.8, 'CRITICAL']];

export class Timeline {
  constructor(canvas, { onSelect, onHover }) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.onSelect = onSelect;
    this.onHover = onHover;
    this.evs = [];
    this.sel = null;
    this.hover = null;
    this.pts = [];
    new ResizeObserver(() => this.resize()).observe(canvas);
    canvas.addEventListener('mousemove', (ev) => {
      const e = this.nearest(ev);
      if (e !== this.hover) { this.hover = e; this.draw(); }
      canvas.style.cursor = e ? 'pointer' : 'default';
      this.onHover(e, ev);
    });
    canvas.addEventListener('mouseleave', () => { this.hover = null; this.draw(); this.onHover(null); });
    canvas.addEventListener('click', (ev) => { const e = this.nearest(ev); if (e) this.onSelect(e); });
    setInterval(() => this.draw(), 60e3);
    this.resize();
  }

  resize() {
    const r = this.c.getBoundingClientRect();
    if (!r.width) return;
    const dpr = window.devicePixelRatio || 1;
    this.w = r.width; this.h = r.height;
    this.c.width = r.width * dpr; this.c.height = r.height * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw();
  }

  setEvents(evs) { this.evs = evs; this.draw(); }
  select(e) { this.sel = e; this.draw(); }

  draw() {
    const { ctx, w, h } = this;
    if (!w) return;
    ctx.clearRect(0, 0, w, h);
    const L = 8, R = 74, T = 14, B = 16;
    const now = Date.now(), t0 = now - HOURS * 3600e3;
    const x = (t) => L + ((t - t0) / (now - t0)) * (w - L - R);
    const y = (s) => T + (1 - (s - 0.15) / 0.85) * (h - T - B);
    ctx.font = '9px "IBM Plex Mono", monospace';

    // bands
    for (const [s, label] of BANDS) {
      const yy = Math.round(y(s)) + 0.5;
      ctx.strokeStyle = 'rgba(87,199,212,0.12)'; ctx.beginPath(); ctx.moveTo(L, yy); ctx.lineTo(w - R, yy); ctx.stroke();
      ctx.fillStyle = 'rgba(87,199,212,0.55)'; ctx.fillText(label, w - R + 8, yy + 3);
    }
    ctx.strokeStyle = 'rgba(87,199,212,0.35)';
    ctx.beginPath(); ctx.moveTo(L, h - B + 0.5); ctx.lineTo(w - R, h - B + 0.5); ctx.stroke();
    for (let hr = HOURS; hr >= 0; hr -= 12) {
      const xx = Math.round(x(now - hr * 3600e3)) + 0.5;
      ctx.beginPath(); ctx.moveTo(xx, h - B); ctx.lineTo(xx, h - B + 4); ctx.stroke();
      ctx.fillStyle = 'rgba(87,199,212,0.55)'; ctx.textAlign = hr === HOURS ? 'left' : hr === 0 ? 'right' : 'center';
      ctx.fillText(hr === 0 ? 'NOW' : `-${hr}H`, xx, h - 3);
    }
    ctx.textAlign = 'left';

    // events
    this.pts = [];
    const list = this.evs.filter((e) => e.time >= t0 && e.time <= now + 3600e3);
    const strong = [];
    for (const e of list) {
      const px = x(Math.min(e.time, now)), py = y(Math.max(0.15, Math.min(1, e.severity)));
      const col = KINDS[e.kind].color;
      if (e.severity >= 0.55) {
        const r = 3 + (e.severity - 0.5) * 16;
        ctx.strokeStyle = hexA(col, 0.85); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.stroke();
        strong.push([px, py, r, e]);
        this.pts.push([px, py, Math.max(6, r), e]);
      } else {
        ctx.fillStyle = hexA(col, 0.75);
        ctx.fillRect(px - 1, py - 1, 2, 2);
        this.pts.push([px, py, 4, e]);
      }
    }
    // codes above the strongest
    strong.sort((a, b) => b[3].severity - a[3].severity);
    const placed = [];
    ctx.font = '9px "IBM Plex Mono", monospace';
    for (const [px, py, r, e] of strong.slice(0, 26)) {
      const label = (e.place || e.title).replace(/^.*? of /, '').toUpperCase().slice(0, 10);
      const tw = ctx.measureText(label).width, lx = px - tw / 2, ly = py - r - 4;
      if (placed.some(([a, b, c]) => lx < c && lx + tw > a && Math.abs(ly - b) < 10)) continue;
      placed.push([lx, ly, lx + tw]);
      ctx.fillStyle = '#d9e3e6'; ctx.fillText(label, lx, ly);
    }
    for (const [e, col] of [[this.hover, 'rgba(255,255,255,0.7)'], [this.sel, '#ffffff']]) {
      if (!e) continue;
      const p = this.pts.find((q) => q[3] === e);
      if (!p) continue;
      ctx.strokeStyle = col; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(p[0], p[1], p[2] + 4, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.lineWidth = 1;
  }

  nearest(ev) {
    const r = this.c.getBoundingClientRect();
    const mx = ev.clientX - r.left, my = ev.clientY - r.top;
    let best = null, bd = Infinity;
    for (const [px, py, rad, e] of this.pts) {
      const d = Math.hypot(px - mx, py - my);
      if (d <= rad + 3 && d < bd) { bd = d; best = e; }
    }
    return best;
  }
}
