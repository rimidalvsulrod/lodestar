// Live world-event feeds. All free, no API keys. Every event is normalised to:
// { id, kind, title, summary, lat, lon, time, source, url, severity (0..1), place, region, track? }
const { XMLParser } = require('fast-xml-parser');
const { locate } = require('./gazetteer');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Lodestar/1.0';
const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@' });

async function get(url, { type = 'json', timeout = 20000 } = {}) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: '*/*' }, signal: AbortSignal.timeout(timeout) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (type === 'json') return res.json();
  if (type === 'buffer') return Buffer.from(await res.arrayBuffer());
  return res.text();
}

const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const stripHtml = (s) => String(s || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------- earthquakes
async function quakes() {
  const d = await get('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson');
  return d.features.map((f) => {
    const p = f.properties;
    const [lon, lat, depth] = f.geometry.coordinates;
    return {
      id: `usgs:${f.id}`, kind: 'quake', title: `M${(p.mag ?? 0).toFixed(1)} earthquake`, summary: p.place || '',
      place: p.place || '', lat, lon, time: p.time, source: 'USGS', url: p.url,
      severity: clamp(((p.mag ?? 0) - 2.5) / 5), meta: { mag: p.mag, depth, tsunami: !!p.tsunami, alert: p.alert },
    };
  });
}

// ---------------------------------------------------------------- NASA EONET (fires, storms, volcanoes, floods)
const EONET_KIND = { wildfires: 'fire', severeStorms: 'storm', volcanoes: 'volcano', floods: 'flood', landslides: 'flood', tempExtremes: 'weather', drought: 'weather', dustHaze: 'weather', snow: 'weather' };

async function eonet() {
  const d = await get('https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=30');
  const out = [];
  for (const e of d.events) {
    const kind = EONET_KIND[e.categories?.[0]?.id];
    if (!kind || !e.geometry?.length) continue;
    const pts = e.geometry.map((g) => (g.type === 'Point' ? g.coordinates : g.coordinates?.[0]?.[0])).filter(Boolean);
    const last = e.geometry[e.geometry.length - 1];
    const [lon, lat] = pts[pts.length - 1];
    const mag = last.magnitudeValue;
    out.push({
      id: `eonet:${e.id}`, kind, title: e.title, summary: e.description || e.categories[0].title,
      place: e.title, lat, lon, time: Date.parse(last.date), source: 'NASA EONET', url: e.sources?.[0]?.url || e.link,
      severity: kind === 'storm' && mag ? clamp(mag / 140) : kind === 'volcano' ? 0.55 : 0.35,
      track: kind === 'storm' && pts.length > 1 ? pts : undefined, meta: { magnitude: mag, unit: last.magnitudeUnit },
    });
  }
  return out;
}

// ---------------------------------------------------------------- GDACS (global disaster alerts incl. typhoons)
const GDACS_KIND = { TC: 'storm', EQ: 'quake', FL: 'flood', VO: 'volcano', WF: 'fire', DR: 'weather' };
const GDACS_SEV = { Green: 0.3, Orange: 0.65, Red: 0.95 };

async function gdacs() {
  const to = new Date();
  const from = new Date(Date.now() - 14 * 864e5);
  const iso = (x) => x.toISOString().slice(0, 10);
  const d = await get(`https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=EQ;TC;FL;VO;WF;DR&fromDate=${iso(from)}&toDate=${iso(to)}`, { timeout: 45000 });
  return (d.features || []).filter((f) => f.properties.eventtype !== 'EQ').map((f) => {
    const p = f.properties;
    const [lon, lat] = f.geometry.coordinates;
    return {
      id: `gdacs:${p.eventtype}:${p.eventid}`, kind: GDACS_KIND[p.eventtype] || 'weather',
      title: p.name || p.eventname || p.description, summary: p.severitydata?.severitytext || p.description || '',
      place: p.country || '', lat, lon, time: Date.parse(p.todate || p.fromdate), source: 'GDACS',
      url: p.url?.report, severity: GDACS_SEV[p.alertlevel] ?? 0.3, meta: { alert: p.alertlevel },
    };
  });
}

// ---------------------------------------------------------------- NOAA National Hurricane Center
async function nhc() {
  const d = await get('https://www.nhc.noaa.gov/CurrentStorms.json');
  const NAMES = { HU: 'Hurricane', TS: 'Tropical Storm', TD: 'Tropical Depression', STS: 'Subtropical Storm', PTC: 'Potential Tropical Cyclone' };
  return (d.activeStorms || []).map((s) => ({
    id: `nhc:${s.id}`, kind: 'storm', title: `${NAMES[s.classification] || 'Storm'} ${s.name}`,
    summary: `${s.intensity} kt winds, ${s.pressure} mb, moving ${s.movementDir}° at ${s.movementSpeed} mph`,
    place: s.name, lat: Number(s.latitudeNumeric), lon: Number(s.longitudeNumeric), time: Date.parse(s.lastUpdate),
    source: 'NOAA NHC', url: 'https://www.nhc.noaa.gov/', severity: clamp(Number(s.intensity) / 140),
    meta: { intensity: s.intensity, pressure: s.pressure },
  }));
}

// ---------------------------------------------------------------- news (RSS), geolocated and classified
const NEWS_FEEDS = [
  ['BBC', 'https://feeds.bbci.co.uk/news/world/rss.xml'],
  ['Al Jazeera', 'https://www.aljazeera.com/xml/rss/all.xml'],
  ['The Guardian', 'https://www.theguardian.com/world/rss'],
  ['NYT', 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml'],
  ['DW', 'https://rss.dw.com/rdf/rss-en-world'],
  ['France 24', 'https://www.france24.com/en/rss'],
  ['NPR', 'https://feeds.npr.org/1004/rss.xml'],
  ['UN News', 'https://news.un.org/feed/subscribe/en/news/all/rss.xml'],
  ['OilPrice', 'https://oilprice.com/rss/main'],
];

const CONFLICT_WORDS = {
  killed: 3, airstrike: 3, 'air strike': 3, missile: 3, missiles: 3, drone: 2, drones: 2, shelling: 3, bombing: 3,
  invasion: 3, offensive: 2, troops: 2, military: 1, army: 1, war: 2, attack: 2, attacks: 2, attacked: 2, strike: 2,
  strikes: 2, ceasefire: 2, truce: 1, rebels: 2, militants: 2, insurgents: 2, hostages: 2, clashes: 2, gunmen: 2,
  frontline: 2, artillery: 3, warship: 2, navy: 1, nuclear: 2, sanctions: 1, coup: 3, siege: 3, massacre: 3, raid: 2,
};
const MARKET_WORDS = /\b(oil|crude|opec|brent|gas|lng|pipeline|refinery|tanker|shipping|wheat|grain|gold|tariff|sanction|export)\w*/i;

function scoreConflict(text) {
  let s = 0;
  const t = text.toLowerCase();
  for (const [w, v] of Object.entries(CONFLICT_WORDS)) if (new RegExp(`\\b${w}\\b`).test(t)) s += v;
  return s;
}

function parseItems(feedXml) {
  const doc = xml.parse(feedXml);
  const items = doc?.rss?.channel?.item || doc?.['rdf:RDF']?.item || doc?.feed?.entry || [];
  return Array.isArray(items) ? items : [items];
}

async function newsFeed([source, url]) {
  const body = await get(url, { type: 'text' });
  const out = [];
  for (const it of parseItems(body)) {
    const title = stripHtml(typeof it.title === 'object' ? it.title['#text'] : it.title);
    const desc = stripHtml(it.description || it.summary || it['content:encoded'] || '').slice(0, 400);
    const link = typeof it.link === 'object' ? it.link['@href'] || it.link['#text'] : it.link;
    const when = Date.parse(it.pubDate || it['dc:date'] || it.updated || it.published) || Date.now();
    if (!title) continue;
    const loc = locate(`${title}. ${desc}`);
    if (!loc) continue; // only plot what we can place
    const c = scoreConflict(`${title} ${desc}`);
    const kind = c >= 3 ? 'conflict' : 'news';
    out.push({
      id: `news:${link || title}`, kind, title, summary: desc, place: loc.place, region: loc.region,
      // jitter so stories about the same capital don't stack exactly
      lat: loc.lat + (Math.random() - 0.5) * 0.8, lon: loc.lon + (Math.random() - 0.5) * 0.8,
      time: when, source, url: link, severity: kind === 'conflict' ? clamp(c / 10, 0.35, 1) : 0.2,
      meta: { marketRelevant: MARKET_WORDS.test(`${title} ${desc}`) },
    });
  }
  return out;
}

async function news() {
  const results = await Promise.allSettled(NEWS_FEEDS.map(newsFeed));
  const all = [];
  const errors = [];
  results.forEach((r, i) => (r.status === 'fulfilled' ? all.push(...r.value) : errors.push(`${NEWS_FEEDS[i][0]}: ${r.reason.message}`)));
  if (!all.length && errors.length) throw new Error(errors.join('; '));
  // de-duplicate near-identical headlines from different outlets
  const seen = new Set();
  const cutoff = Date.now() - 3 * 864e5;
  return all.filter((e) => {
    const key = e.title.toLowerCase().replace(/[^a-z ]/g, '').split(' ').slice(0, 7).join(' ');
    if (seen.has(key) || e.time < cutoff) return false;
    seen.add(key);
    return true;
  });
}

// ---------------------------------------------------------------- region tag for natural events
function regionFor(e) {
  if (e.region) return e.region;
  const { lat, lon } = e;
  if (lat > 17 && lat < 31 && lon > -98 && lon < -80) return 'gulf_of_mexico';
  if (lat > 12 && lat < 42 && lon > 25 && lon < 63) return 'middle_east';
  if (lat > 44 && lat < 60 && lon > 22 && lon < 50) return 'russia_ukraine';
  if (lat > 0 && lat < 50 && lon > 95 && lon < 150) return 'east_asia';
  if (lat > -60 && lat < 15 && lon > -82 && lon < -34) return 'south_america';
  if (lat > 15 && lon > -170 && lon < -50) return 'americas';
  return 'other';
}

const SOURCES = {
  quakes: { fn: quakes, every: 60e3, label: 'USGS quakes' },
  nhc: { fn: nhc, every: 10 * 60e3, label: 'NOAA hurricanes' },
  eonet: { fn: eonet, every: 10 * 60e3, label: 'NASA EONET' },
  gdacs: { fn: gdacs, every: 10 * 60e3, label: 'GDACS alerts' },
  news: { fn: news, every: 3 * 60e3, label: 'World news' },
};

// GIBS true-colour mosaic from yesterday (today's is still being stitched)
async function satelliteImage() {
  const day = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  const url = `https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=VIIRS_NOAA20_CorrectedReflectance_TrueColor&STYLES=&FORMAT=image/jpeg&CRS=EPSG:4326&BBOX=-90,-180,90,180&WIDTH=4096&HEIGHT=2048&TIME=${day}`;
  return { day, data: await get(url, { type: 'buffer', timeout: 90000 }) };
}

module.exports = { SOURCES, regionFor, satelliteImage, get, UA };
