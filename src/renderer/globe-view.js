/* global Globe, topojson, WORLD_110M */
import { KINDS, hexA, esc, truncate, timeAgo } from './util.js';

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
  constructor(el, { onSelect }) {
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
      .pointColor((e) => (e === this.sel ? '#ffffff' : KINDS[e.kind].color))
      .pointAltitude((e) => (e === this.sel ? 0.22 : 0.01 + e.severity * 0.1))
      .pointRadius((e) => (e === this.sel ? 0.45 : 0.15 + e.severity * 0.4))
      .pointResolution(10)
      .pointsTransitionDuration(0)
      .pointLabel(tipHtml)
      .onPointClick((e) => onSelect(e))
      .ringLat('lat').ringLng('lon')
      .ringColor((e) => (t) => hexA(KINDS[e.kind].color, (1 - t) * 0.9))
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
      .labelSize(0.62).labelDotRadius(0.32).labelAltitude(0.23).labelResolution(3);

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
  }

  select(e, fly = true) {
    this.sel = e;
    this.g.labelsData(e ? [e] : []);
    this.g.pointsData([...this.evs]);
    if (e && fly) this.g.pointOfView({ lat: e.lat, lng: e.lon, altitude: 1.45 }, 1300);
  }

  setStyle(style, satUrl) {
    const url = style === 'satellite' ? satUrl || TEX.day : TEX[style] || TEX.night;
    this.g.globeImageUrl(url);
    this.g.bumpImageUrl(style === 'satellite' ? null : '../../assets/earth-topology.png');
    this.stroke = style === 'satellite' ? 'rgba(255,255,255,0.22)' : style === 'dark' ? 'rgba(110,200,255,0.42)' : 'rgba(110,200,255,0.30)';
    this.g.polygonStrokeColor(() => this.stroke);
    this.g.atmosphereColor(style === 'satellite' ? '#8cc8ff' : '#4fb8ff');
  }

  setRotate(on) { this.g.controls().autoRotate = on; }
  home() { this.g.pointOfView(HOME, 1100); }
  pause() { this.g.pauseAnimation(); }
  resume() { this.g.resumeAnimation(); }
}
