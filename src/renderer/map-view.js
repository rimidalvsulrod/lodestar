/* global d3, topojson, WORLD_110M */
import { KINDS, hexA, truncate, arcColor, magma, HUBS, SOURCE_HUBS, CITIES, eventArcs } from './util.js';

// Wall-map framing (after the TeleGeography internet map): 440° of longitude so Asia
// shows on both edges, Antarctica and the far north cropped, Atlantic in the middle.
const LON0 = -250, LON1 = 190, LAT0 = -56, LAT1 = 76;
const CENTER = 50; // degrees west at the middle of the map
const RAD = Math.PI / 180;
const FONT = '"IBM Plex Mono", monospace';
const LABEL = '#5fc3d0';
const COAST = 'rgba(64,92,108,0.55)';

export class MapView {
  constructor(canvas, { onSelect, onHover }) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.layer = document.createElement('canvas'); // cached still layers
    this.lctx = this.layer.getContext('2d');
    this.onSelect = onSelect;
    this.onHover = onHover;
    this.evs = [];
    this.arcs = [];
    this.sel = null;
    this.hover = null;
    this.visible = true;
    this.dirty = true;
    this.fx = { arcs: true, hex: false, labels: true };
    const obj = WORLD_110M.objects.countries;
    this.coast = topojson.mesh(WORLD_110M, obj, (a, b) => a === b);
    this.borders = topojson.mesh(WORLD_110M, obj, (a, b) => a !== b);
    this.pA = d3.geoEquirectangular();
    this.pB = d3.geoEquirectangular(); // the same world one turn to the west
    this.t = d3.zoomIdentity;
    this.screen = [];
    this.lastFrame = 0;

    this.zoom = d3.zoom().scaleExtent([1, 16]).on('zoom', (ev) => { this.t = ev.transform; this.dirty = true; });
    d3.select(canvas).call(this.zoom).on('dblclick.zoom', null);
    canvas.addEventListener('mousemove', (ev) => this.pick(ev));
    canvas.addEventListener('mouseleave', () => { this.hover = null; this.onHover(null); });
    canvas.addEventListener('click', (ev) => { const e = this.nearest(ev); if (e) this.onSelect(e); });

    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
    const loop = (now) => {
      // still layers redraw only when something changed; the animation runs at ~30 fps
      if (this.visible && !document.hidden && (this.dirty || now - this.lastFrame > 33)) {
        this.lastFrame = now;
        this.frame(now);
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  resize() {
    const r = this.c.getBoundingClientRect();
    if (!r.width) return;
    const dpr = window.devicePixelRatio || 1;
    this.w = r.width; this.h = r.height; this.dpr = dpr;
    for (const cv of [this.c, this.layer]) { cv.width = r.width * dpr; cv.height = r.height * dpr; }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.lctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    let s = (this.h - 12) / ((LAT1 - LAT0) * RAD);
    if (this.w / s > (LON1 - LON0) * RAD) s = this.w / ((LON1 - LON0) * RAD);
    const top = (this.h - s * (LAT1 - LAT0) * RAD) / 2;
    this.base = { s, tx: this.w / 2 + s * CENTER * RAD, ty: top + s * LAT1 * RAD };
    this.dirty = true;
  }

  setVisible(v) { this.visible = v; if (v) this.resize(); }
  setEvents(evs) { this.evs = evs; this.arcs = eventArcs(evs); this.dirty = true; }
  setFx(fx) { this.fx = { ...this.fx, ...fx }; this.dirty = true; }
  setThermal() { /* look removed */ }

  applyZoom() {
    const { k, x, y } = this.t;
    const { s, tx, ty } = this.base;
    const turn = 2 * Math.PI * s;
    this.pA.scale(s * k).translate([tx * k + x, ty * k + y]).clipExtent([[0, 0], [this.w, this.h]]);
    this.pB.scale(s * k).translate([(tx - turn) * k + x, ty * k + y]).clipExtent([[0, 0], [this.w, this.h]]);
  }

  copies(lon, lat, margin = 30) {
    const out = [];
    for (const p of [this.pA, this.pB]) {
      const q = p([lon, lat]);
      if (q && q[0] > -margin && q[0] < this.w + margin && q[1] > -margin && q[1] < this.h + margin) out.push(q);
    }
    return out;
  }

  // ---------------------------------------------------------------- still layers (cached)
  renderLayer() {
    const ctx = this.lctx, { w, h } = this;
    this.applyZoom();
    const z = Math.sqrt(this.t.k);
    ctx.clearRect(0, 0, w, h);

    // coastlines and borders: faint slate hairlines
    const pathA = d3.geoPath(this.pA, ctx), pathB = d3.geoPath(this.pB, ctx);
    ctx.strokeStyle = COAST; ctx.lineWidth = 0.7;
    for (const path of [pathA, pathB]) { ctx.beginPath(); path(this.coast); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(64,92,108,0.22)'; ctx.lineWidth = 0.5;
    for (const path of [pathA, pathB]) { ctx.beginPath(); path(this.borders); ctx.stroke(); }

    if (this.fx.hex) this.drawHex(ctx);

    // arcs: event <-> exchange and report source; thin single-colour curves bowing to the left of travel
    this.arcGeo = [];
    if (this.fx.arcs) {
      ctx.lineCap = 'round';
      // colour by severity rank so the palette spans red -> orange -> cream -> white like the poster
      const ordered = [...this.arcs].sort((a, b) => a.sev - b.sev || (a.type === 'market') - (b.type === 'market'));
      const n = Math.max(1, ordered.length - 1);
      ordered.forEach((a, i) => { a.rank = i / n; });
      for (const a of ordered) {
        const p1 = this.pA(a.to);
        if (!p1) continue;
        const opts = [this.pA(a.from), this.pB(a.from)].filter((p) => p && p[0] > -500 && p[0] < w + 500);
        if (!opts.length) continue;
        const p0 = opts.sort((u, v) => Math.abs(u[0] - p1[0]) - Math.abs(v[0] - p1[0]))[0];
        // travel from the hub to the event; bow to the left of that direction
        const dx = p0[0] - p1[0], dy = p0[1] - p1[1], d = Math.hypot(dx, dy);
        if (d < 3) continue;
        const nx = dy / d, ny = -dx / d;
        const bulge = d * 0.3;
        const cx = (p0[0] + p1[0]) / 2 + nx * bulge;
        const cy = Math.max(-h * 0.08, Math.min(h * 1.08, (p0[1] + p1[1]) / 2 + ny * bulge)); // keep arcs on the map
        const sel = a.ev === this.sel;
        // most routes red/orange, fewer yellow and cream, only the top few white and heavy
        const t = 0.2 + Math.pow(a.rank, 1.8) * 0.8;
        ctx.strokeStyle = sel ? '#ffffff' : arcColor(t, t > 0.93 ? 0.95 : 0.78);
        ctx.lineWidth = (sel ? 2.4 : t > 0.96 ? 3 : t > 0.88 ? 1.6 : t > 0.65 ? 1 : 0.75) * Math.min(1.5, z);
        ctx.beginPath(); ctx.moveTo(p1[0], p1[1]); ctx.quadraticCurveTo(cx, cy, p0[0], p0[1]); ctx.stroke();
        this.arcGeo.push([p1, cx, cy, p0, a]);
      }
      this.arcGeo.reverse(); // strongest first for the pulses
    }

    // report sources: small amber squares
    if (this.fx.arcs) {
      const done = new Set();
      ctx.fillStyle = '#f4c97a';
      for (const sh of Object.values(SOURCE_HUBS)) {
        if (done.has(sh.name)) continue;
        done.add(sh.name);
        const p = this.pA([sh.lon, sh.lat]);
        if (p) ctx.fillRect(p[0] - 1.5, p[1] - 1.5, 3, 3);
      }
    }

    // city labels sit above the arcs, like the poster
    if (this.fx.labels) {
      ctx.font = `${Math.min(10.5, 8 + this.t.k * 0.4)}px ${FONT}`;
      ctx.fillStyle = LABEL;
      for (const [name, lat, lon] of CITIES) {
        const label = name.toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase());
        for (const p of this.copies(lon, lat, 0)) {
          ctx.fillRect(p[0] - 1, p[1] - 1, 2, 2);
          ctx.fillText(label, p[0] + 4, p[1] + 3);
        }
      }
    }

    // exchange hubs
    for (const hb of Object.values(HUBS)) {
      const p = this.pA([hb.lon, hb.lat]);
      if (!p) continue;
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.1;
      ctx.beginPath(); ctx.arc(p[0], p[1], 4, 0, Math.PI * 2); ctx.stroke();
      ctx.font = `600 10.5px ${FONT}`; ctx.fillStyle = '#ffffff';
      ctx.fillText(hb.name, p[0] + 7, p[1] - 5);
      ctx.font = `9px ${FONT}`; ctx.fillStyle = LABEL;
      ctx.fillText(hb.note, p[0] + 7, p[1] + 6);
    }

    // events
    this.screen = [];
    for (const e of this.evs) {
      const r = (1.1 + e.severity * 2.2) * Math.min(1.8, z);
      ctx.fillStyle = hexA(KINDS[e.kind].color, 0.95);
      for (const p of this.copies(e.lon, e.lat, 10)) {
        this.screen.push([p[0], p[1], e, r]);
        ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, Math.PI * 2); ctx.fill();
      }
    }

    // short codes on the strongest events, like the airport codes on the poster
    if (this.fx.labels) {
      ctx.font = `500 9.5px ${FONT}`; ctx.fillStyle = '#ffffff';
      const top = this.evs.filter((e) => e.severity >= 0.6).sort((a, b) => b.severity - a.severity).slice(0, 14);
      for (const e of top) {
        const label = (e.place || e.title).replace(/^.*? of /, '').toUpperCase().slice(0, 16);
        for (const p of this.copies(e.lon, e.lat, 0)) ctx.fillText(label, p[0] + 6, p[1] - 5);
      }
    }
    this.dirty = false;
  }

  drawHex(ctx) {
    const { k } = this.t;
    const R = 4.6 * Math.min(2.4, Math.sqrt(k));
    const W = Math.sqrt(3) * R, H = 1.5 * R;
    const cols = Math.ceil(this.w / W) + 2, rows = Math.ceil(this.h / H) + 2;
    const dens = new Float32Array(cols * rows);
    const sigma = 13 * Math.sqrt(k), rad = sigma * 2.6, s2 = 2 * sigma * sigma;
    for (const e of this.evs) {
      const wgt = (e.kind === 'news' ? 0.35 : 0.6) + e.severity * 1.3;
      for (const p of this.copies(e.lon, e.lat, rad)) {
        const r0 = Math.max(0, Math.floor((p[1] - rad) / H)), r1 = Math.min(rows - 1, Math.ceil((p[1] + rad) / H));
        for (let r = r0; r <= r1; r++) {
          const off = (r & 1) * W / 2, cy = r * H;
          const c0 = Math.max(0, Math.floor((p[0] - rad - off) / W)), c1 = Math.min(cols - 1, Math.ceil((p[0] + rad - off) / W));
          for (let c = c0; c <= c1; c++) {
            const ddx = c * W + off - p[0], ddy = cy - p[1];
            dens[r * cols + c] += wgt * Math.exp(-(ddx * ddx + ddy * ddy) / s2);
          }
        }
      }
    }
    let max = 0;
    for (const v of dens) if (v > max) max = v;
    if (!max) return;
    const norm = Math.max(max * 0.55, 1.2);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const v = dens[r * cols + c] / norm;
        if (v < 0.08) continue;
        const q = Math.sqrt(Math.min(1, v));
        ctx.fillStyle = magma(0.3 + q * 0.7, 0.42 + q * 0.5);
        const cx = c * W + (r & 1) * W / 2, cy = r * H;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = Math.PI / 6 + (i * Math.PI) / 3;
          i ? ctx.lineTo(cx + R * 0.97 * Math.cos(a), cy + R * 0.97 * Math.sin(a)) : ctx.moveTo(cx + R * 0.97 * Math.cos(a), cy + R * 0.97 * Math.sin(a));
        }
        ctx.fill();
      }
    }
  }

  // ---------------------------------------------------------------- per-frame overlay
  frame(now) {
    if (!this.w) return;
    const t0 = performance.now();
    let layerMs = 0;
    if (this.dirty) { this.renderLayer(); layerMs = performance.now() - t0; }
    const { ctx, w, h } = this;
    const z = Math.sqrt(this.t.k);
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(this.layer, 0, 0, w, h);

    // pulses travelling along the strongest arcs
    if (this.fx.arcs && this.arcGeo) {
      ctx.fillStyle = 'rgba(255,250,235,0.95)';
      for (const [p0, cx, cy, p1, a] of this.arcGeo.slice(0, 20)) {
        const t = ((now / (2800 + (1 - a.sev) * 2800)) + (Math.abs(a.from[0]) % 1)) % 1;
        const u = 1 - t;
        const x = u * u * p0[0] + 2 * u * t * cx + t * t * p1[0];
        const y = u * u * p0[1] + 2 * u * t * cy + t * t * p1[1];
        ctx.beginPath(); ctx.arc(x, y, 1.4 * Math.min(1.5, z), 0, Math.PI * 2); ctx.fill();
      }
    }

    // pulse rings on severe events
    ctx.lineWidth = 1;
    for (const [px, py, e, r] of this.screen) {
      if (e.severity < 0.65) continue;
      const ph = ((now / (1200 + (1 - e.severity) * 900)) + (Math.abs(e.lat) % 1)) % 1;
      ctx.strokeStyle = hexA(KINDS[e.kind].color, (1 - ph) * 0.55);
      ctx.beginPath(); ctx.arc(px, py, r + 2 + ph * 12 * z, 0, Math.PI * 2); ctx.stroke();
    }

    // hover + selection
    for (const [e, color] of [[this.hover, 'rgba(255,255,255,0.6)'], [this.sel, '#ffffff']]) {
      if (!e) continue;
      for (const p of this.copies(e.lon, e.lat, 0)) {
        ctx.strokeStyle = color; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(p[0], p[1], 9 * Math.min(1.6, z), 0, Math.PI * 2); ctx.stroke();
        if (e === this.sel) {
          ctx.font = `500 11px ${FONT}`;
          const text = truncate(e.title, 58).toUpperCase();
          const tw = ctx.measureText(text).width;
          const x = Math.min(p[0] + 14, w - tw - 18), y = p[1] - 16;
          ctx.fillStyle = 'rgba(0,0,0,0.9)'; ctx.fillRect(x - 7, y - 13, tw + 14, 19);
          ctx.strokeStyle = 'rgba(95,195,208,0.7)'; ctx.lineWidth = 1; ctx.strokeRect(x - 7, y - 13, tw + 14, 19);
          ctx.fillStyle = '#ffffff'; ctx.fillText(text, x, y);
        }
      }
    }
    const perf = (window.__mapPerf = window.__mapPerf || { frames: 0, frameMs: 0, layerMs: 0 });
    perf.frames++;
    perf.frameMs = performance.now() - t0 - layerMs;
    if (layerMs) perf.layerMs = layerMs;
  }

  nearest(ev) {
    const r = this.c.getBoundingClientRect();
    const x = ev.clientX - r.left, y = ev.clientY - r.top;
    let best = null, bd = Infinity;
    for (const [px, py, e, rad] of this.screen) {
      const d = Math.hypot(px - x, py - y);
      if (d < Math.max(9, rad + 3) && d < bd) { bd = d; best = e; }
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
    this.dirty = true;
    if (!e || !this.visible || !this.base) return;
    const { s, tx, ty } = this.base;
    const cands = [tx + s * e.lon * RAD, tx - 2 * Math.PI * s + s * e.lon * RAD].filter((x) => x > 0 && x < this.w);
    const px = cands.sort((a, b) => Math.abs(a - this.w / 2) - Math.abs(b - this.w / 2))[0] ?? tx + s * e.lon * RAD;
    const py = ty - s * e.lat * RAD;
    const k = Math.max(this.t.k, 2.4);
    const t = d3.zoomIdentity.translate(this.w / 2 - k * px, this.h / 2 - k * py).scale(k);
    d3.select(this.c).transition().duration(900).call(this.zoom.transform, t);
  }

  home() { d3.select(this.c).transition().duration(700).call(this.zoom.transform, d3.zoomIdentity); }
}
