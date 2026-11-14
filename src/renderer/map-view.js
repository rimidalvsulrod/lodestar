/* global d3, topojson, WORLD_110M */
import { KINDS, hexA, truncate, heat } from './util.js';

// Flat world map on a canvas with pan/zoom, pulsing events and storm tracks.
export class MapView {
  constructor(canvas, { onSelect, onHover }) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.onSelect = onSelect;
    this.onHover = onHover;
    this.evs = [];
    this.sel = null;
    this.hover = null;
    this.visible = false;
    this.land = topojson.feature(WORLD_110M, WORLD_110M.objects.countries);
    this.borders = topojson.mesh(WORLD_110M, WORLD_110M.objects.countries, (a, b) => a !== b);
    this.grat = d3.geoGraticule10();
    this.proj = d3.geoNaturalEarth1();
    this.path = d3.geoPath(this.proj, this.ctx);
    this.t = d3.zoomIdentity;
    this.screen = [];

    this.zoom = d3.zoom().scaleExtent([1, 14]).on('zoom', (ev) => { this.t = ev.transform; });
    d3.select(canvas).call(this.zoom).on('dblclick.zoom', null);
    canvas.addEventListener('mousemove', (ev) => this.pick(ev));
    canvas.addEventListener('mouseleave', () => { this.hover = null; this.onHover(null); });
    canvas.addEventListener('click', (ev) => { const e = this.nearest(ev); if (e) this.onSelect(e); });

    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
    const loop = () => { if (this.visible) this.draw(); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  resize() {
    const r = this.c.getBoundingClientRect();
    if (!r.width) return;
    const dpr = window.devicePixelRatio || 1;
    this.w = r.width; this.h = r.height;
    this.c.width = r.width * dpr; this.c.height = r.height * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.proj.fitExtent([[16, 16], [this.w - 16, this.h - 16]], { type: 'Sphere' });
    this.base = { s: this.proj.scale(), t: this.proj.translate() };
  }

  setThermal(on) { this.thermal = on; }
  setVisible(v) { this.visible = v; if (v) this.resize(); }
  setEvents(evs) { this.evs = evs; }

  applyZoom() {
    const { k, x, y } = this.t;
    this.proj.scale(this.base.s * k).translate([this.base.t[0] * k + x, this.base.t[1] * k + y]);
  }

  draw() {
    const { ctx, w, h } = this;
    if (!w) return;
    this.applyZoom();
    const now = performance.now();
    ctx.clearRect(0, 0, w, h);

    // ocean
    ctx.beginPath(); this.path({ type: 'Sphere' });
    const g = ctx.createRadialGradient(w / 2, h * 0.45, 0, w / 2, h / 2, w * 0.7);
    const T = this.thermal;
    g.addColorStop(0, T ? '#12040a' : '#0c1a2c'); g.addColorStop(1, T ? '#040106' : '#060b13');
    ctx.fillStyle = g; ctx.fill();
    ctx.beginPath(); this.path(this.grat); ctx.strokeStyle = T ? 'rgba(255,120,40,0.06)' : 'rgba(79,216,255,0.06)'; ctx.lineWidth = 1; ctx.stroke();

    // land
    ctx.beginPath(); this.path(this.land); ctx.fillStyle = T ? '#3a0d0a' : '#15243a'; ctx.fill();
    ctx.strokeStyle = T ? 'rgba(255,150,70,0.4)' : 'rgba(110,200,255,0.35)'; ctx.lineWidth = 0.8; ctx.stroke();
    ctx.beginPath(); this.path(this.borders); ctx.strokeStyle = T ? 'rgba(255,150,70,0.25)' : 'rgba(110,200,255,0.26)'; ctx.lineWidth = 0.6; ctx.stroke();

    // thermal blooms: additive heat around every event
    if (T) {
      ctx.globalCompositeOperation = 'lighter';
      const zz = Math.sqrt(this.t.k);
      for (const e of this.evs) {
        const p = this.proj([e.lon, e.lat]);
        if (!p) continue;
        const R = (16 + e.severity * 46) * zz;
        const gr = ctx.createRadialGradient(p[0], p[1], 0, p[0], p[1], R);
        gr.addColorStop(0, heat(0.85, 0.32 + e.severity * 0.3));
        gr.addColorStop(0.45, heat(0.5, 0.16));
        gr.addColorStop(1, heat(0.3, 0));
        ctx.fillStyle = gr;
        ctx.fillRect(p[0] - R, p[1] - R, R * 2, R * 2);
      }
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.beginPath(); this.path({ type: 'Sphere' }); ctx.strokeStyle = 'rgba(79,216,255,0.25)'; ctx.lineWidth = 1; ctx.stroke();

    // storm tracks
    for (const e of this.evs) {
      if (!e.track) continue;
      ctx.beginPath(); this.path({ type: 'LineString', coordinates: e.track });
      ctx.setLineDash([6, 4]); ctx.lineDashOffset = -now / 60;
      ctx.strokeStyle = 'rgba(79,216,255,0.8)'; ctx.lineWidth = 1.4; ctx.stroke(); ctx.setLineDash([]);
    }

    // events
    this.screen = [];
    const z = Math.sqrt(this.t.k);
    for (const e of this.evs) {
      const p = this.proj([e.lon, e.lat]);
      if (!p || p[0] < -20 || p[1] < -20 || p[0] > w + 20 || p[1] > h + 20) continue;
      const col = this.thermal ? '#ffe9a8' : KINDS[e.kind].color;
      const r = (2 + e.severity * 4.5) * z;
      this.screen.push([p[0], p[1], e, r]);
      if (e.severity >= 0.6) {
        const ph = ((now / (900 + (1 - e.severity) * 900)) + (e.lat % 1)) % 1;
        ctx.beginPath(); ctx.arc(p[0], p[1], r + ph * 18 * z, 0, Math.PI * 2);
        ctx.strokeStyle = hexA(col, (1 - ph) * 0.7); ctx.lineWidth = 1.3; ctx.stroke();
      }
      ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, Math.PI * 2);
      ctx.shadowColor = col; ctx.shadowBlur = 10;
      ctx.fillStyle = hexA(col, 0.85); ctx.fill();
      ctx.shadowBlur = 0;
    }

    // hover + selection
    for (const [e, color] of [[this.hover, '#ffffff99'], [this.sel, '#ffffff']]) {
      if (!e) continue;
      const p = this.proj([e.lon, e.lat]);
      if (!p) continue;
      ctx.beginPath(); ctx.arc(p[0], p[1], 10 * z, 0, Math.PI * 2);
      ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.stroke();
      if (e === this.sel) {
        ctx.font = '600 12px "Segoe UI", sans-serif';
        const text = truncate(e.title, 52);
        const tw = ctx.measureText(text).width;
        const x = Math.min(p[0] + 14, w - tw - 16), y = p[1] - 14;
        ctx.fillStyle = '#0a0f17e8'; ctx.fillRect(x - 6, y - 14, tw + 12, 20);
        ctx.strokeStyle = '#233042'; ctx.strokeRect(x - 6, y - 14, tw + 12, 20);
        ctx.fillStyle = '#f1f5fb'; ctx.fillText(text, x, y);
      }
    }
  }

  nearest(ev) {
    const r = this.c.getBoundingClientRect();
    const x = ev.clientX - r.left, y = ev.clientY - r.top;
    let best = null, bd = 12 * 12;
    for (const [px, py, e, rad] of this.screen) {
      const d = (px - x) ** 2 + (py - y) ** 2;
      if (d < Math.max(bd, rad * rad) && d < bd + rad * rad) { bd = d; best = e; }
    }
    return best;
  }

  pick(ev) {
    const e = this.nearest(ev);
    this.hover = e;
    this.c.style.cursor = e ? 'pointer' : 'grab';
    this.onHover(e, ev);
  }

  select(e) {
    this.sel = e;
    if (!e || !this.visible) return;
    const p0 = this.base;
    const proj = d3.geoNaturalEarth1().scale(p0.s).translate(p0.t);
    const [px, py] = proj([e.lon, e.lat]);
    const k = Math.max(this.t.k, 3);
    const t = d3.zoomIdentity.translate(this.w / 2 - k * px, this.h / 2 - k * py).scale(k);
    d3.select(this.c).transition().duration(900).call(this.zoom.transform, t);
  }

  home() { d3.select(this.c).transition().duration(700).call(this.zoom.transform, d3.zoomIdentity); }
}
