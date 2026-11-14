/* global Globe, topojson, WORLD_110M */
import { KINDS, hexA, esc, truncate, timeAgo, heat, HEAT_LUT } from './util.js';

// Build a thermal globe texture once: cold oceans and ice, warm land, hot deserts and city lights.
async function makeThermalTexture() {
  const load = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
  const [day, night] = await Promise.all([load(TEX.day), load(TEX.night)]);
  const W = 2048, H = 1024;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(night, 0, 0, W, H);
  const n = x.getImageData(0, 0, W, H).data;
  x.drawImage(day, 0, 0, W, H);
  const img = x.getImageData(0, 0, W, H);
  const p = img.data;
  for (let i = 0; i < p.length; i += 4) {
    const r = p[i] / 255, g = p[i + 1] / 255, b = p[i + 2] / 255;
    const lum = 0.3 * r + 0.59 * g + 0.11 * b;
    const ocean = b > r + 0.05 && b >= g * 0.95;
    const ice = r > 0.72 && g > 0.72 && b > 0.72;
    const lights = (n[i] + n[i + 1] + n[i + 2]) / 765;
    let t = ice ? 0.1 : ocean ? 0.04 + lum * 0.2 : 0.22 + lum * 0.55;
    t = Math.min(1, t + lights * 0.85);
    const [R, G, B] = HEAT_LUT[Math.round(t * 255)];
    p[i] = R; p[i + 1] = G; p[i + 2] = B;
  }
  x.putImageData(img, 0, 0);
  return c.toDataURL('image/jpeg', 0.9);
}

function tagText(e) {
  if (e.kind === 'quake' && e.meta?.mag) return `M${e.meta.mag.toFixed(1)} ${(e.place || '').replace(/^.*? of /, '')}`;
  return e.title;
}

const TEX = {
  night: '../../assets/earth-night.jpg',
  dark: '../../assets/earth-dark.jpg',
  day: '../../assets/earth-blue-marble.jpg',
};
const HOME = { lat: 24, lng: 28, altitude: 1.95 };

export function tipHtml(e) {
  const k = KINDS[e.kind];
  return `<div class="globe-tip"><div class="tip-kind" style="color:${k.color}">${k.one}</div>
    <div>${esc(truncate(e.title, 110))}</div>
    <div class="tip-meta">${esc(e.place || '')}${e.place ? ' · ' : ''}${esc(e.source)} · ${timeAgo(e.time)} ago</div></div>`;
}

export class GlobeView {
  constructor(el, { onSelect, onView }) {
    this.onSelect = onSelect;
    this.el = el;
    this.evs = [];
    this.sel = null;
    const countries = topojson.feature(WORLD_110M, WORLD_110M.objects.countries).features;
    this.stroke = 'rgba(110,200,255,0.30)';

    this.g = Globe({ rendererConfig: { antialias: true, alpha: true, powerPreference: 'high-performance' }, animateIn: true })(el)
      .backgroundColor('rgba(0,0,0,0)')
      .backgroundImageUrl('../../assets/night-sky.png')
      .globeImageUrl(TEX.night)
      .bumpImageUrl('../../assets/earth-topology.png')
      .showGraticules(true)
      .atmosphereColor('#4fb8ff')
      .atmosphereAltitude(0.17)
      .polygonsData(countries)
      .polygonCapColor(() => 'rgba(0,0,0,0)')
      .polygonSideColor(() => 'rgba(0,0,0,0)')
      .polygonStrokeColor(() => this.stroke)
      .polygonAltitude(0.0035)
      .polygonsTransitionDuration(0)
      .pointLat('lat').pointLng('lon')
      .pointColor((e) => (e === this.sel ? '#ffffff' : this.thermal ? heat(0.62 + e.severity * 0.38) : KINDS[e.kind].color))
      .pointAltitude((e) => (e === this.sel ? 0.22 : 0.01 + e.severity * 0.1))
      .pointRadius((e) => (e === this.sel ? 0.45 : 0.15 + e.severity * 0.4))
      .pointResolution(10)
      .pointsTransitionDuration(0)
      .pointLabel(tipHtml)
      .onPointClick((e) => onSelect(e))
      .ringLat('lat').ringLng('lon')
      .ringColor((e) => (t) => (this.thermal ? heat(1 - t * 0.55, (1 - t) * 0.9) : hexA(KINDS[e.kind].color, (1 - t) * 0.9)))
      .heatmapPointLat('lat').heatmapPointLng('lon')
      .heatmapPointWeight((e) => 0.25 + e.severity * 1.2)
      .heatmapBandwidth(1.6)
      .heatmapColorFn(() => (t) => heat(Math.min(1, t * 1.15), Math.min(0.92, t * 2.2)))
      .heatmapColorSaturation(2.2)
      .heatmapBaseAltitude(0.004)
      .heatmapTopAltitude(0.07)
      .heatmapsTransitionDuration(0)
      .ringMaxRadius((e) => 1.4 + e.severity * 4.5)
      .ringPropagationSpeed((e) => 1.2 + e.severity * 2)
      .ringRepeatPeriod((e) => 700 + (1 - e.severity) * 1600)
      .pathPoints('track')
      .pathPointLat((p) => p[1]).pathPointLng((p) => p[0]).pathPointAlt(0.008)
      .pathColor(() => ['rgba(79,216,255,0.1)', 'rgba(79,216,255,0.95)'])
      .pathStroke(1.8)
      .pathDashLength(0.22).pathDashGap(0.03).pathDashAnimateTime(5000)
      .pathTransitionDuration(0)
      .labelLat('lat').labelLng('lon')
      .labelText((e) => truncate(e.title, 46))
      .labelColor(() => '#f4f8ff')
      .labelSize(0.62).labelDotRadius(0.32).labelAltitude(0.23).labelResolution(3)
      .htmlLat('lat').htmlLng('lon').htmlAltitude(0.015)
      .htmlElement((e) => {
        const el = document.createElement('div');
        el.className = 'gtag';
        el.style.setProperty('--c', e === this.sel ? '#ffffff' : KINDS[e.kind].color);
        el.innerHTML = `<b>${KINDS[e.kind].code}</b>${esc(truncate(tagText(e), 34))}`;
        el.onclick = (ev) => { ev.stopPropagation(); onSelect(e); };
        return el;
      })
      .onZoom((pov) => onView?.(pov));
    if (typeof this.g.htmlElementVisibilityModifier === 'function') {
      this.g.htmlElementVisibilityModifier((el, visible) => { el.style.opacity = visible ? 1 : 0; el.style.pointerEvents = visible ? 'auto' : 'none'; });
    }

    const c = this.g.controls();
    c.autoRotate = true;
    c.autoRotateSpeed = 0.32;
    c.enableDamping = true;
    c.dampingFactor = 0.08;
    c.minDistance = 140;
    c.maxDistance = 700;
    this.g.pointOfView(HOME);

    new ResizeObserver(() => this.resize()).observe(el);
    this.resize();
  }

  resize() {
    if (!this.el.clientWidth) return;
    this.g.width(this.el.clientWidth).height(this.el.clientHeight);
  }

  setEvents(evs) {
    this.evs = evs;
    const now = Date.now();
    this.g.pointsData(evs);
    this.g.ringsData(evs.filter((e) => e.severity >= 0.65 || (now - e.time < 3 * 3600e3 && e.severity >= 0.35)).slice(0, 70));
    this.g.pathsData(evs.filter((e) => e.track));
    this.g.heatmapsData(this.thermal ? [evs] : []);
    this.tags();
  }

  async setThermal(on) {
    this.thermal = on;
    this.el.classList.toggle('thermal', on);
    if (on) {
      if (!this.thermalUrl) this.thermalUrl = await makeThermalTexture();
      if (!this.thermal) return;
      this.g.globeImageUrl(this.thermalUrl).bumpImageUrl(null).showGraticules(false).atmosphereColor('#ff7a1a');
      this.stroke = 'rgba(255,170,90,0.22)';
      this.g.polygonStrokeColor(() => this.stroke);
    } else {
      this.g.showGraticules(true);
      this.setStyle(this.baseStyle || 'night', this.satUrl);
    }
    this.g.heatmapsData(on ? [this.evs] : []);
    this.g.pointsData([...this.evs]);
    this.g.ringsData([...this.g.ringsData()]);
  }

  // Tactical tags on the most important recent events (plus the selected one).
  tags() {
    const now = Date.now();
    const top = this.evs.filter((e) => now - e.time < 48 * 3600e3 && e.severity >= 0.5)
      .sort((a, b) => b.severity - a.severity || b.time - a.time).slice(0, 12);
    if (this.sel && !top.includes(this.sel)) top.push(this.sel);
    this.g.htmlElementsData(top);
  }

  select(e, fly = true) {
    this.sel = e;
    this.g.pointsData([...this.evs]);
    this.tags();
    if (e && fly) this.g.pointOfView({ lat: e.lat, lng: e.lon, altitude: 1.45 }, 1300);
  }

  setStyle(style, satUrl) {
    this.baseStyle = style;
    this.satUrl = satUrl;
    if (this.thermal) return;
    const url = style === 'satellite' ? satUrl || TEX.day : TEX[style] || TEX.night;
    this.g.globeImageUrl(url);
    this.g.bumpImageUrl(style === 'satellite' ? null : '../../assets/earth-topology.png');
    this.stroke = style === 'satellite' ? 'rgba(255,255,255,0.22)' : style === 'dark' ? 'rgba(110,200,255,0.42)' : 'rgba(110,200,255,0.30)';
    this.g.polygonStrokeColor(() => this.stroke);
    this.g.atmosphereColor(style === 'satellite' ? '#8cc8ff' : '#3fb6ff');
  }

  setRotate(on) { this.g.controls().autoRotate = on; }
  home() { this.g.pointOfView(HOME, 1100); }
  pov() { return this.g.pointOfView(); }
  pause() { this.g.pauseAnimation(); }
  resume() { this.g.resumeAnimation(); }
}
