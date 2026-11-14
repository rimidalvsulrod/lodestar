/* global Globe, topojson, WORLD_110M */
import { KINDS, hexA, esc, truncate, timeAgo, arcColor, magma, eventArcs, HUBS } from './util.js';

function tagText(e) {
  if (e.kind === 'quake' && e.meta?.mag) return `M${e.meta.mag.toFixed(1)} ${(e.place || '').replace(/^.*? of /, '')}`;
  return e.title;
}

const POSTER = (() => {
  const c = document.createElement('canvas'); c.width = 4; c.height = 2;
  const x = c.getContext('2d'); x.fillStyle = '#020506'; x.fillRect(0, 0, 4, 2);
  return c.toDataURL('image/png');
})();

const TEX = {
  poster: POSTER,
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
    this.stroke = 'rgba(87,199,212,0.55)';
    this.fx = { arcs: true, hex: false, labels: true };

    this.g = Globe({ rendererConfig: { antialias: true, alpha: true, powerPreference: 'high-performance' }, animateIn: true })(el)
      .backgroundColor('rgba(0,0,0,0)')
      .globeImageUrl(TEX.poster)
      .showGraticules(false)
      .atmosphereColor('#57c7d4')
      .atmosphereAltitude(0.1)
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
      .arcStartLat((a) => a.from[1]).arcStartLng((a) => a.from[0])
      .arcEndLat((a) => a.to[1]).arcEndLng((a) => a.to[0])
      .arcColor((a) => [arcColor(0.25 + a.sev * 0.45, 0.5), arcColor(Math.min(1, 0.5 + a.sev * 0.6), 0.95)])
      .arcStroke((a) => (a.ev === this.sel ? 0.9 : 0.12 + a.sev * 0.5))
      .arcAltitudeAutoScale(0.38)
      .arcDashLength(0.6).arcDashGap(0.22)
      .arcDashInitialGap(() => Math.random())
      .arcDashAnimateTime((a) => 2600 + (1 - a.sev) * 3200)
      .arcsTransitionDuration(0)
      .hexBinPointLat('lat').hexBinPointLng('lon')
      .hexBinPointWeight((e) => (e.kind === 'news' ? 0.35 : 0.6) + e.severity * 1.3)
      .hexBinResolution(3).hexMargin(0.14).hexBinMerge(true)
      .hexAltitude((d) => Math.min(0.06, d.sumWeight * 0.005))
      .hexTopColor((d) => magma(Math.min(1, 0.32 + Math.sqrt(d.sumWeight / 7) * 0.68), 0.9))
      .hexSideColor((d) => magma(Math.min(1, 0.25 + Math.sqrt(d.sumWeight / 7) * 0.55), 0.5))
      .hexTransitionDuration(0)
      .pathPoints('track')
      .pathPointLat((p) => p[1]).pathPointLng((p) => p[0]).pathPointAlt(0.008)
      .pathColor(() => ['rgba(79,216,255,0.1)', 'rgba(79,216,255,0.95)'])
      .pathStroke(1.8)
      .pathDashLength(0.22).pathDashGap(0.03).pathDashAnimateTime(5000)
      .pathTransitionDuration(0)
      .labelLat('lat').labelLng('lon')
      .labelText((h) => h.name)
      .labelColor(() => '#ffffff')
      .labelSize(0.75).labelDotRadius(0.42).labelAltitude(0.006).labelResolution(3)
      .labelsData(Object.values(HUBS))
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
    this.g.hexBinPointsData(this.fx.hex ? evs : []);
    this.g.arcsData(this.fx.arcs ? eventArcs(evs, 160) : []);
    this.tags();
  }

  setFx(fx) {
    this.fx = { ...this.fx, ...fx };
    this.setEvents(this.evs);
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
    this.g.arcsData([...this.g.arcsData()]);
    this.tags();
    if (e && fly) this.g.pointOfView({ lat: e.lat, lng: e.lon, altitude: 1.45 }, 1300);
  }

  setStyle(style, satUrl) {
    this.baseStyle = style;
    this.satUrl = satUrl;
    const poster = style === 'poster' || !TEX[style] && style !== 'satellite';
    const url = style === 'satellite' ? satUrl || TEX.day : TEX[style] || TEX.poster;
    this.g.globeImageUrl(url);
    this.g.bumpImageUrl(poster || style === 'satellite' ? null : '../../assets/earth-topology.png');
    this.g.backgroundImageUrl(poster ? null : '../../assets/night-sky.png');
    this.g.showGraticules(!poster);
    this.stroke = poster ? 'rgba(87,199,212,0.55)' : style === 'satellite' ? 'rgba(255,255,255,0.22)' : 'rgba(110,200,255,0.32)';
    this.g.polygonStrokeColor(() => this.stroke);
    this.g.atmosphereColor(poster ? '#57c7d4' : style === 'satellite' ? '#8cc8ff' : '#3fb6ff');
    this.g.atmosphereAltitude(poster ? 0.1 : 0.17);
  }

  setRotate(on) { this.g.controls().autoRotate = on; }
  home() { this.g.pointOfView(HOME, 1100); }
  pov() { return this.g.pointOfView(); }
  pause() { this.g.pauseAnimation(); }
  resume() { this.g.resumeAnimation(); }
}
