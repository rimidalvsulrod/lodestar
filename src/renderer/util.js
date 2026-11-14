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

// ---------------------------------------------------------------- poster palettes
function ramp(stops) {
  const rgb = stops.map(([t, hex]) => [t, [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))]);
  const lut = Array.from({ length: 256 }, (_, i) => {
    const t = i / 255;
    let k = 0;
    while (k < rgb.length - 2 && t > rgb[k + 1][0]) k++;
    const [t0, c0] = rgb[k], [t1, c1] = rgb[k + 1];
    const f = Math.max(0, Math.min(1, (t - t0) / (t1 - t0 || 1)));
    return c0.map((v, j) => Math.round(v + (c1[j] - v) * f));
  });
  const fn = (t, a = 1) => {
    const [r, g, b] = lut[Math.max(0, Math.min(255, Math.round(t * 255)))];
    return `rgba(${r},${g},${b},${a})`;
  };
  fn.lut = lut;
  return fn;
}
// Capacity-style arc colours: dark red -> red -> orange -> yellow -> white.
export const arcColor = ramp([[0, '#5a160d'], [0.35, '#b8321c'], [0.6, '#ea6f1e'], [0.8, '#f4c97a'], [0.92, '#fbf1d8'], [1, '#ffffff']]);
// Magma, for event density hex bins.
export const magma = ramp([[0, '#000004'], [0.13, '#1c1044'], [0.25, '#4f127b'], [0.38, '#812581'], [0.5, '#b5367a'], [0.63, '#e55064'], [0.75, '#fb8761'], [0.88, '#fec287'], [1, '#fcfdbf']]);

// Where each market trades: arcs run from an event to these exchanges.
export const HUBS = {
  NYC: { code: 'NYC', name: 'NEW YORK', note: 'NYMEX · COMEX · NYSE', lat: 40.71, lon: -74.01 },
  CHI: { code: 'CHI', name: 'CHICAGO', note: 'CBOT · CBOE', lat: 41.88, lon: -87.63 },
  LON: { code: 'LON', name: 'LONDON', note: 'ICE FUTURES', lat: 51.51, lon: -0.09 },
};
const SYMBOL_HUB = { 'BZ=F': 'LON', 'ZW=F': 'CHI', 'ZC=F': 'CHI', 'ZS=F': 'CHI', '^VIX': 'CHI', 'BTC-USD': null };
export const hubFor = (sym) => HUBS[SYMBOL_HUB[sym] === undefined ? 'NYC' : SYMBOL_HUB[sym]] || null;

// Where each feed reports from: "news flow" arcs run from here to the event.
export const SOURCE_HUBS = {
  BBC: { name: 'London', lat: 51.52, lon: -0.14 },
  'The Guardian': { name: 'London', lat: 51.53, lon: -0.12 },
  OilPrice: { name: 'London', lat: 51.5, lon: -0.1 },
  'Al Jazeera': { name: 'Doha', lat: 25.29, lon: 51.53 },
  NYT: { name: 'New York', lat: 40.76, lon: -73.99 },
  'UN News': { name: 'New York', lat: 40.75, lon: -73.97 },
  NPR: { name: 'Washington', lat: 38.9, lon: -77.01 },
  DW: { name: 'Bonn', lat: 50.73, lon: 7.1 },
  'France 24': { name: 'Paris', lat: 48.83, lon: 2.27 },
  USGS: { name: 'Golden CO', lat: 39.75, lon: -105.22 },
  'NASA EONET': { name: 'Greenbelt MD', lat: 38.99, lon: -76.85 },
  GDACS: { name: 'Ispra', lat: 45.81, lon: 8.61 },
  'NOAA NHC': { name: 'Miami', lat: 25.75, lon: -80.38 },
};

// Arcs for the map. Two kinds:
//  market  event -> the exchange where its linked markets trade (thicker)
//  source  where the report came from -> the event (thin, like traffic routes)
export function eventArcs(events, max = 420) {
  const out = [];
  for (const e of events) {
    const seen = new Set();
    for (const x of exposures(e)) {
      const h = hubFor(x.symbol);
      if (!h || seen.has(h.code)) continue;
      seen.add(h.code);
      out.push({ id: `${e.id}>${h.code}`, type: 'market', ev: e, from: [e.lon, e.lat], to: [h.lon, h.lat], hub: h, sev: e.severity });
    }
    const src = SOURCE_HUBS[e.source];
    if (src && Math.hypot(src.lon - e.lon, src.lat - e.lat) > 3) {
      out.push({ id: `${e.id}<src`, type: 'source', ev: e, from: [e.lon, e.lat], to: [src.lon, src.lat], hub: src, sev: e.severity * 0.85 });
    }
  }
  return out.sort((a, b) => b.sev - a.sev).slice(0, max);
}

// Reference cities for the map's fine labels.
export const CITIES = [
  ['SEATTLE', 47.61, -122.33], ['SAN FRANCISCO', 37.77, -122.42], ['LOS ANGELES', 34.05, -118.24], ['DENVER', 39.74, -104.99],
  ['DALLAS', 32.78, -96.8], ['HOUSTON', 29.76, -95.37], ['MIAMI', 25.76, -80.19], ['ATLANTA', 33.75, -84.39],
  ['WASHINGTON', 38.9, -77.04], ['TORONTO', 43.65, -79.38], ['MONTREAL', 45.5, -73.57], ['MEXICO CITY', 19.43, -99.13],
  ['BOGOTA', 4.71, -74.07], ['LIMA', -12.05, -77.04], ['SANTIAGO', -33.45, -70.67], ['BUENOS AIRES', -34.6, -58.38],
  ['SAO PAULO', -23.55, -46.63], ['RIO DE JANEIRO', -22.91, -43.17], ['CARACAS', 10.48, -66.9], ['REYKJAVIK', 64.15, -21.94],
  ['DUBLIN', 53.35, -6.26], ['LISBON', 38.72, -9.14], ['MADRID', 40.42, -3.7], ['PARIS', 48.86, 2.35], ['AMSTERDAM', 52.37, 4.9],
  ['FRANKFURT', 50.11, 8.68], ['ZURICH', 47.38, 8.54], ['MILAN', 45.46, 9.19], ['STOCKHOLM', 59.33, 18.07], ['WARSAW', 52.23, 21.01],
  ['KYIV', 50.45, 30.52], ['MOSCOW', 55.76, 37.62], ['ISTANBUL', 41.01, 28.98], ['ATHENS', 37.98, 23.73], ['CAIRO', 30.04, 31.24],
  ['TEL AVIV', 32.08, 34.78], ['RIYADH', 24.71, 46.68], ['DUBAI', 25.2, 55.27], ['TEHRAN', 35.69, 51.39], ['KARACHI', 24.86, 67.0],
  ['MUMBAI', 19.08, 72.88], ['DELHI', 28.61, 77.21], ['CHENNAI', 13.08, 80.27], ['LAGOS', 6.52, 3.38], ['NAIROBI', -1.29, 36.82],
  ['JOHANNESBURG', -26.2, 28.05], ['CAPE TOWN', -33.92, 18.42], ['KINSHASA', -4.44, 15.27], ['ADDIS ABABA', 9.03, 38.74],
  ['SINGAPORE', 1.35, 103.82], ['JAKARTA', -6.21, 106.85], ['BANGKOK', 13.76, 100.5], ['HONG KONG', 22.32, 114.17],
  ['SHANGHAI', 31.23, 121.47], ['BEIJING', 39.9, 116.4], ['SEOUL', 37.57, 126.98], ['TOKYO', 35.68, 139.69], ['TAIPEI', 25.03, 121.57],
  ['MANILA', 14.6, 120.98], ['SYDNEY', -33.87, 151.21], ['PERTH', -31.95, 115.86], ['AUCKLAND', -36.85, 174.76],
  ['ANCHORAGE', 61.22, -149.9], ['VANCOUVER', 49.28, -123.12], ['CALGARY', 51.05, -114.07], ['PHOENIX', 33.45, -112.07],
  ['SALT LAKE CITY', 40.76, -111.89], ['MINNEAPOLIS', 44.98, -93.27], ['KANSAS CITY', 39.1, -94.58], ['ST. LOUIS', 38.63, -90.2],
  ['NASHVILLE', 36.16, -86.78], ['CHARLOTTE', 35.23, -80.84], ['BOSTON', 42.36, -71.06], ['PHILADELPHIA', 39.95, -75.17],
  ['DETROIT', 42.33, -83.05], ['HALIFAX', 44.65, -63.57], ['HAVANA', 23.11, -82.37], ['SAN JUAN', 18.47, -66.11],
  ['PANAMA CITY', 8.98, -79.52], ['GUATEMALA', 14.63, -90.51], ['QUITO', -0.18, -78.47], ['LA PAZ', -16.5, -68.15],
  ['ASUNCION', -25.26, -57.58], ['MONTEVIDEO', -34.9, -56.16], ['FORTALEZA', -3.73, -38.52], ['RECIFE', -8.05, -34.88],
  ['SALVADOR', -12.97, -38.5], ['MANAUS', -3.12, -60.02], ['NUUK', 64.18, -51.72], ['EDINBURGH', 55.95, -3.19],
  ['OSLO', 59.91, 10.75], ['COPENHAGEN', 55.68, 12.57], ['HELSINKI', 60.17, 24.94], ['ST. PETERSBURG', 59.93, 30.34],
  ['RIGA', 56.95, 24.11], ['MINSK', 53.9, 27.56], ['BERLIN', 52.52, 13.4], ['PRAGUE', 50.08, 14.44], ['VIENNA', 48.21, 16.37],
  ['BUDAPEST', 47.5, 19.04], ['BUCHAREST', 44.43, 26.1], ['SOFIA', 42.7, 23.32], ['BELGRADE', 44.79, 20.45], ['ROME', 41.9, 12.5],
  ['MARSEILLE', 43.3, 5.37], ['BARCELONA', 41.39, 2.17], ['ALGIERS', 36.75, 3.06], ['TUNIS', 36.81, 10.18], ['TRIPOLI', 32.89, 13.19],
  ['CASABLANCA', 33.57, -7.59], ['DAKAR', 14.72, -17.47], ['ABIDJAN', 5.36, -4.01], ['ACCRA', 5.6, -0.19], ['KHARTOUM', 15.5, 32.56],
  ['DJIBOUTI', 11.59, 43.15], ['MOGADISHU', 2.05, 45.32], ['DAR ES SALAAM', -6.79, 39.21], ['LUANDA', -8.84, 13.23],
  ['MAPUTO', -25.97, 32.57], ['ANTANANARIVO', -18.88, 47.51], ['BEIRUT', 33.89, 35.5], ['DAMASCUS', 33.51, 36.28],
  ['BAGHDAD', 33.31, 44.36], ['KUWAIT', 29.37, 47.98], ['DOHA', 25.29, 51.53], ['MUSCAT', 23.59, 58.41], ['SANAA', 15.37, 44.19],
  ['BAKU', 40.41, 49.87], ['TBILISI', 41.72, 44.79], ['ALMATY', 43.24, 76.95], ['TASHKENT', 41.3, 69.24], ['KABUL', 34.53, 69.17],
  ['ISLAMABAD', 33.68, 73.05], ['KOLKATA', 22.57, 88.36], ['DHAKA', 23.81, 90.41], ['COLOMBO', 6.93, 79.86], ['YANGON', 16.84, 96.17],
  ['HANOI', 21.03, 105.85], ['HO CHI MINH', 10.82, 106.63], ['KUALA LUMPUR', 3.14, 101.69], ['GUANGZHOU', 23.13, 113.26],
  ['CHONGQING', 29.56, 106.55], ['VLADIVOSTOK', 43.12, 131.89], ['OSAKA', 34.69, 135.5], ['GUAM', 13.44, 144.79],
  ['DARWIN', -12.46, 130.84], ['BRISBANE', -27.47, 153.03], ['MELBOURNE', -37.81, 144.96], ['HONOLULU', 21.31, -157.86],
  ['SUVA', -18.14, 178.44], ['NOVOSIBIRSK', 55.03, 82.92], ['YEKATERINBURG', 56.84, 60.6],
];
