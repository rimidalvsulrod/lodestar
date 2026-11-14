export const KINDS = {
  conflict: { label: 'Conflict', one: 'Conflict', color: '#ff4d5e' },
  news: { label: 'News', one: 'News', color: '#a7b6ff' },
  quake: { label: 'Quakes', one: 'Quake', color: '#ffb547' },
  storm: { label: 'Storms', one: 'Storm', color: '#4fd8ff' },
  fire: { label: 'Fires', one: 'Fire', color: '#ff7a2f' },
  volcano: { label: 'Volcanoes', one: 'Volcano', color: '#e46bff' },
  flood: { label: 'Floods', one: 'Flood', color: '#3d8bff' },
  weather: { label: 'Weather', one: 'Weather', color: '#9be37a' },
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

// Markets commonly linked to an event type and place. Descriptive only, not a signal.
export function exposures(e) {
  const out = [];
  const add = (symbol, why) => { if (!out.some((o) => o.symbol === symbol)) out.push({ symbol, why }); };
  const r = e.region;
  const text = `${e.title} ${e.summary} ${e.place}`.toLowerCase();

  if (e.kind === 'conflict' || e.kind === 'news') {
    if (/\b(oil|crude|opec|refiner\w*|tanker\w*|pipeline\w*)\b/.test(text)) { add('CL=F', 'Oil named in story'); add('BZ=F', 'Oil named in story'); }
    if (/\b(lng|natural gas|gas field|gas supply)\b/.test(text)) add('NG=F', 'Gas named in story');
    if (/\b(wheat|grain|corn|harvest)\b/.test(text)) add('ZW=F', 'Grain named in story');
    if (/\bgold\b/.test(text)) add('GC=F', 'Gold named in story');
    if (r === 'middle_east') { add('BZ=F', 'Gulf and Red Sea supply routes'); add('CL=F', 'Crude risk premium'); add('GC=F', 'Safe-haven demand'); add('ITA', 'Defense spending'); }
    if (r === 'russia_ukraine') { add('NG=F', 'European gas supply'); add('ZW=F', 'Black Sea grain exports'); add('ITA', 'Defense spending'); add('GC=F', 'Safe-haven demand'); }
    if (/taiwan|china|chinese|beijing|south china sea|korea|pyongyang|japan|pla/.test(text)) { add('TSM', 'Taiwan chip supply'); add('^VIX', 'Risk sentiment'); add('ITA', 'Defense spending'); }
    if (r === 'europe' && e.kind === 'conflict') { add('ITA', 'Defense spending'); add('NG=F', 'European energy'); }
    if (/congo|drc|zambia/.test(text)) add('HG=F', 'Copper and cobalt mining');
    if (/venezuela/.test(text)) add('CL=F', 'Venezuelan crude');
    if (e.kind === 'conflict' && !out.length) { add('ITA', 'Defense spending'); add('GC=F', 'Safe-haven demand'); }
  }
  if (e.kind === 'storm') {
    if (r === 'gulf_of_mexico') { add('CL=F', 'Gulf offshore output'); add('NG=F', 'Gulf gas production'); add('RB=F', 'Gulf Coast refineries'); add('TRV', 'Insured losses'); }
    else if (r === 'americas') { add('TRV', 'Insured losses'); add('RB=F', 'Fuel distribution'); }
    else if (r === 'east_asia') { add('TSM', 'Fab and port disruption'); }
  }
  if (e.kind === 'quake' && (e.meta?.mag || 0) >= 5.5) {
    if (/japan|taiwan/.test(text)) add('TSM', 'Chip fabs');
    if (/chile|peru/.test(text)) add('HG=F', 'Copper mines');
    if (/california|alaska|oregon|washington/.test(text)) add('TRV', 'Insured losses');
    if (/turkey|iran|iraq/.test(text)) add('BZ=F', 'Regional pipelines');
  }
  if (e.kind === 'fire' && r === 'americas') add('TRV', 'Insured losses');
  if ((e.kind === 'flood' || e.kind === 'weather') && /brazil|argentina|iowa|illinois|nebraska|india|ukraine|russia|australia|drought|kenya|ethiopia/.test(text)) {
    add('ZC=F', 'Crop conditions'); add('ZS=F', 'Crop conditions'); add('ZW=F', 'Crop conditions');
  }
  return out.slice(0, 5);
}
