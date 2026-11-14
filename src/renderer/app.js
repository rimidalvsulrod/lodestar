import { KINDS, $, $$, esc, fmtPrice, fmtMoney, fmtPct, cls, timeAgo, fmtTime, sevLabel, exposures, truncate, arcColor } from './util.js';
import { GlobeView, tipHtml } from './globe-view.js';
import { MapView } from './map-view.js';
import { Timeline } from './timeline.js';
import { CandleChart, LineChart, spark } from './charts.js';

const api = window.lodestar;

const S = {
  settings: null, info: null, update: null,
  events: [], status: {}, quotes: {},
  ledger: null, auto: null,
  selEvent: null, symbol: 'CL=F', range: '1D',
  view: 'map', sort: 'time', search: '',
  pfTab: 'mine', pfList: 'positions',
  satUrl: null, satDay: null,
};

const REGION = {
  middle_east: 'MIDDLE EAST', russia_ukraine: 'RUSSIA–UKRAINE', east_asia: 'EAST ASIA', gulf_of_mexico: 'GULF OF MEXICO',
  americas: 'AMERICAS', south_america: 'SOUTH AMERICA', europe: 'EUROPE', africa: 'AFRICA', south_asia: 'SOUTH ASIA',
  central_asia: 'CENTRAL ASIA', oceania: 'OCEANIA', other: 'OCEANS / OTHER',
};

let globe, map, timeline, candle, eqChart;
const tip = Object.assign(document.createElement('div'), { className: 'tooltip hidden' });
document.body.appendChild(tip);

// ================================================================ boot
async function boot() {
  [S.settings, S.info] = await Promise.all([api.settings.get(), api.info()]);
  $('#yr').textContent = new Date().getFullYear();
  $('#microRight').textContent = `LODESTAR V${S.info.version} · PAPER TRADING · NOTHING IS SENT TO A BROKER`;
  drawLegend();

  map = new MapView($('#map2d'), { onSelect: selectEvent, onHover: showTip });
  globe = new GlobeView($('#globe'), { onSelect: selectEvent });
  timeline = new Timeline($('#timeline'), { onSelect: selectEvent, onHover: showTip });

  wireUi();
  setFx(S.settings.fx || {}, false);
  setView(S.settings.view === 'globe' ? 'globe' : 'map', false);
  setSurface(S.settings.globeStyle && S.settings.globeStyle !== 'dark' ? S.settings.globeStyle : 'poster', false);
  globe.setRotate(S.settings.autoRotate !== false && !matchMedia('(prefers-reduced-motion: reduce)').matches);
  $$('#sortSeg button').forEach((b) => b.classList.toggle('on', b.dataset.v === S.sort));

  api.feeds.onEvents(onEvents);
  api.feeds.onStatus(onStatus);
  api.feeds.onFocus((id) => { const e = S.events.find((x) => x.id === id); if (e) selectEvent(e); });
  api.markets.onQuotes(onQuotes);
  api.markets.onTicks(onTicks);
  api.ledger.onState(onLedger);
  api.autopilot.onState(onAuto);
  api.updater.onStatus(onUpdater);

  const [snap, quotes, ledger, auto] = await Promise.all([api.feeds.snapshot(), api.markets.quotes(), api.ledger.state(), api.autopilot.state()]);
  onStatus(snap.status);
  onEvents(snap.events);
  onQuotes(quotes);
  onLedger(ledger);
  onAuto(auto);
  selectSymbol(S.symbol);

  tick();
  setInterval(tick, 1000);
  setInterval(async () => { $('#streamDot').classList.toggle('live', (await api.markets.streamStatus()) === 'live'); }, 5000);
  setInterval(() => renderEvents(), 30000);
}

function tick() { $('#clock').textContent = `${new Date().toISOString().slice(11, 19)} UTC`; }

function drawLegend() {
  $('#lgArcs').innerHTML = [0.2, 0.4, 0.6, 0.8, 1].map((s, i) => {
    const x0 = i * 30 + 2, w = 0.45 + s * 2.1;
    return `<path d="M${x0} 26 Q${x0 + 13} ${4 - s * 2} ${x0 + 26} 26" fill="none" stroke="${arcColor(0.25 + s * 0.75, 0.95)}" stroke-width="${w}"/>`;
  }).join('');
}

// ================================================================ events
function onEvents(list) {
  S.events = list;
  if (S.selEvent) S.selEvent = list.find((e) => e.id === S.selEvent.id) || S.selEvent;
  refreshEvents();
}

function filtered() {
  const L = S.settings.layers;
  const q = S.search.trim().toLowerCase();
  const minMag = S.settings.minQuakeMag ?? 0;
  return S.events.filter((e) => L[e.kind]
    && !(e.kind === 'quake' && (e.meta?.mag ?? 0) < minMag)
    && (!q || `${e.title} ${e.place} ${e.source} ${e.kind}`.toLowerCase().includes(q)));
}

function refreshEvents() {
  const list = filtered();
  map.setEvents(list);
  globe.setEvents(list);
  timeline.setEvents(list);
  renderLayers();
  renderRegions(list);
  renderEvents(list);
  $('#bigEvents').innerHTML = `${list.length}<u>EVT</u>`;
}

function renderLayers() {
  const counts = {};
  for (const e of S.events) counts[e.kind] = (counts[e.kind] || 0) + 1;
  $('#layers').innerHTML = Object.entries(KINDS).map(([k, v]) =>
    `<button class="layer ${S.settings.layers[k] ? 'on' : ''}" data-k="${k}" style="--c:${v.color}" aria-pressed="${!!S.settings.layers[k]}"><i></i><span>${v.label.toUpperCase()}</span><b>${counts[k] || 0}</b></button>`).join('');
}

function renderRegions(list) {
  const agg = {};
  for (const e of list) { const r = e.region || 'other'; agg[r] = (agg[r] || 0) + e.severity; }
  const rows = Object.entries(agg).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const max = rows[0]?.[1] || 1;
  $('#regions').innerHTML = rows.map(([r, v]) => `<div class="rg"><span>${REGION[r] || r.toUpperCase()}</span><div class="bar"><span style="width:${(v / max) * 100}%"></span></div><b>${v.toFixed(0)}</b></div>`).join('');
}

function renderEvents(list = filtered()) {
  const sorted = [...list].sort((a, b) => (S.sort === 'severity' ? b.severity - a.severity || b.time - a.time : b.time - a.time));
  $('#conCount').textContent = `${list.length} lines`;
  const el = $('#eventList');
  if (!sorted.length) { el.innerHTML = `<div class="empty">${S.events.length ? 'no matches — clear the grep or turn a layer on' : 'connecting to live feeds…'}</div>`; return; }
  el.innerHTML = sorted.slice(0, 300).map((e) => {
    const k = KINDS[e.kind];
    const hm = new Date(e.time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    const place = (e.place || '').replace(/^.*? of /, '').toUpperCase().slice(0, 18);
    return `<button class="ev ${S.selEvent?.id === e.id ? 'sel' : ''}" data-id="${esc(e.id)}" style="--c:${k.color}" title="${esc(e.title)}">
      <time>${hm}</time><span class="k">${k.code}</span><span class="t">${place ? `${esc(place)} · ` : ''}${esc(e.title)}</span><span class="s">${Math.round(e.severity * 100)}</span></button>`;
  }).join('');
}

function onStatus(st) { S.status = st; }

// ================================================================ selection + detail
function selectEvent(e) {
  S.selEvent = e;
  if (e) globe.setRotate(false);
  map.select(e);
  globe.select(e, S.view === 'globe');
  timeline.select(e);
  renderEvents();
  renderDetail();
}

function renderDetail() {
  const e = S.selEvent;
  const el = $('#detail');
  if (!e) { el.classList.add('hidden'); return; }
  const k = KINDS[e.kind];
  const [sl, sc] = sevLabel(e.severity);
  const facts = [];
  if (e.place) facts.push(['WHERE', e.place]);
  facts.push(['WHEN', `${fmtTime(e.time)} · ${timeAgo(e.time)} ago`]);
  if (e.meta?.mag) facts.push(['MAGNITUDE', `M${e.meta.mag.toFixed(1)}, ${Math.round(e.meta.depth)} km deep${e.meta.tsunami ? ', tsunami flag' : ''}`]);
  if (e.meta?.intensity) facts.push(['WINDS', `${e.meta.intensity} kt, ${e.meta.pressure} mb`]);
  if (e.meta?.alert) facts.push(['ALERT', e.meta.alert]);
  facts.push(['SOURCE', e.source]);
  const ex = exposures(e);
  el.style.setProperty('--c', k.color);
  el.innerHTML = `
    <div class="card-head"><span class="k">${k.one.toUpperCase()}</span><span class="sev" style="color:${sc}">${sl.toUpperCase()}</span><span class="dim">SEV ${Math.round(e.severity * 100)}</span><button class="x" id="dClose">CLOSE ✕</button></div>
    <h3>${esc(e.title)}</h3>
    ${e.summary && e.summary !== e.title ? `<p>${esc(truncate(e.summary, 280))}</p>` : ''}
    <dl class="facts">${facts.map(([a, b]) => `<dt>${a}</dt><dd>${esc(b)}</dd>`).join('')}</dl>
    ${e.url ? '<button class="lnk" id="dOpen" style="text-align:left">READ SOURCE REPORT ↗</button>' : ''}
    ${ex.length ? `<div class="sub">LINKED MARKETS → EXCHANGE</div><div class="links">${ex.map((x) => {
      const q = S.quotes[x.symbol];
      const d = x.dir > 0 ? '<span class="dir l">USUALLY UP</span>' : x.dir < 0 ? '<span class="dir s">USUALLY DOWN</span>' : '<span class="dir n">MENTIONED</span>';
      return `<button class="lm" data-sym="${esc(x.symbol)}"><b>${esc(x.symbol)}</b><span>${esc(x.why)}</span>${d}<em class="${cls(q?.change)}">${q?.ok ? fmtPct(q.change) : ''}</em></button>`;
    }).join('')}</div><p class="fine">Textbook relationships for this kind of event, not a prediction. Click a market to load it in Paper Trade.</p>` : ''}`;
  el.classList.remove('hidden');
  $('#dClose').onclick = () => selectEvent(null);
  if ($('#dOpen')) $('#dOpen').onclick = () => api.openExternal(e.url);
  $$('.lm', el).forEach((b) => (b.onclick = () => selectSymbol(b.dataset.sym, true)));
}

function showTip(e, ev) {
  if (!e) { tip.classList.add('hidden'); return; }
  tip.innerHTML = tipHtml(e);
  tip.style.left = `${Math.min(ev.clientX + 14, innerWidth - 330)}px`;
  tip.style.top = `${Math.min(ev.clientY + 14, innerHeight - 90)}px`;
  tip.classList.remove('hidden');
}

// ================================================================ view controls
function setView(v, save = true) {
  S.view = v;
  document.body.classList.toggle('view-globe', v === 'globe');
  $$('#viewSeg button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
  $('#globe').classList.toggle('hidden', v !== 'globe');
  $('#map2d').classList.toggle('hidden', v !== 'map');
  map.setVisible(v === 'map');
  if (v === 'globe') { globe.resume(); globe.resize(); } else globe.pause();
  tip.classList.add('hidden');
  if (S.selEvent) { map.select(S.selEvent); globe.select(S.selEvent, v === 'globe'); }
  if (save) api.settings.set({ view: v }).then((s) => (S.settings = s));
}

function setFx(patch, save = true) {
  const fx = { arcs: true, hex: false, labels: true, ...(S.settings.fx || {}), ...patch };
  S.settings.fx = fx;
  map.setFx(fx);
  globe.setFx(fx);
  $$('#fxSeg button').forEach((b) => b.classList.toggle('on', !!fx[b.dataset.fx]));
  if (save) api.settings.set({ fx }).then((s) => (S.settings = s));
}

async function setSurface(style, save = true) {
  $$('#surfaceSeg button').forEach((b) => b.classList.toggle('on', b.dataset.v === style));
  if (style === 'satellite' && !S.satUrl) {
    toast('Loading yesterday’s NASA satellite image…');
    try { const s = await api.feeds.satellite(); S.satUrl = s.url; S.satDay = s.day; } catch (e) { toast(`Satellite image unavailable: ${e.message}`, 'err'); }
  }
  globe.setStyle(style, S.satUrl);
  if (save) S.settings = await api.settings.set({ globeStyle: style });
}


// ================================================================ markets
const watchNames = () => Object.fromEntries(S.settings.watchlist.flatMap((g) => g.symbols));

function renderWatchlist() {
  $('#watchlist').innerHTML = S.settings.watchlist.flatMap((g) => g.symbols).map(([s, n]) =>
    `<button class="row ${S.symbol === s ? 'sel' : ''}" data-sym="${esc(s)}" title="${esc(n)}"><span class="s">${esc(s)}</span><span class="rng"><em></em><i></i></span><span class="p">—</span><span class="c">—</span></button>`).join('');
  $$('#watchlist .row').forEach((r) => (r.onclick = () => selectSymbol(r.dataset.sym)));
  updateWatchlist({});
}

function updateRow(row, prev) {
  const q = S.quotes[row.dataset.sym];
  if (!q) return;
  if (!q.ok) { $('.p', row).textContent = 'n/a'; return; }
  $('.p', row).textContent = fmtPrice(q.price);
  const c = $('.c', row);
  c.textContent = fmtPct(q.change);
  c.className = `c ${cls(q.change)}`;
  const series = q.spark?.length ? q.spark : [q.price];
  const lo = Math.min(q.dayLow ?? Infinity, ...series, q.price), hi = Math.max(q.dayHigh ?? -Infinity, ...series, q.price);
  const pos = (v) => `${Math.max(0, Math.min(100, ((v - lo) / (hi - lo || 1)) * 100))}%`;
  $('.rng i', row).style.left = pos(q.price);
  const em = $('.rng em', row);
  if (q.prevClose) { em.style.left = pos(q.prevClose); em.style.display = ''; } else em.style.display = 'none';
  if (prev && prev.price !== undefined && prev.price !== q.price) { row.classList.remove('flash'); void row.offsetWidth; row.classList.add('flash'); }
}

function updateWatchlist(prev = {}) {
  for (const row of $$('#watchlist .row')) updateRow(row, prev[row.dataset.sym]);
  const ch = Object.values(S.quotes).filter((q) => q.ok && Number.isFinite(q.change)).map((q) => q.change).sort((a, b) => a - b);
  const med = ch.length ? ch[Math.floor(ch.length / 2)] : 0;
  const big = $('#bigMarkets');
  big.textContent = fmtPct(med);
  big.className = `big ${cls(med)}`;
}

function onQuotes(q) {
  const prev = S.quotes;
  S.quotes = { ...S.quotes, ...q };
  if (!$('#watchlist .row')) renderWatchlist(); else updateWatchlist(prev);
  renderTrade();
  renderChartHead();
}

function onTicks(ticks) {
  for (const [s, t] of Object.entries(ticks)) {
    const q = S.quotes[s] || { symbol: s, ok: true, spark: [] };
    const prev = { price: q.price };
    Object.assign(q, { ok: true, price: t.price, change: t.change ?? q.change, prevClose: t.prevClose ?? q.prevClose, dayHigh: t.dayHigh ?? q.dayHigh, dayLow: t.dayLow ?? q.dayLow });
    if (q.spark?.length) q.spark[q.spark.length - 1] = t.price;
    S.quotes[s] = q;
    const row = $(`#watchlist .row[data-sym="${CSS.escape(s)}"]`);
    if (row) updateRow(row, prev);
    if (s === S.symbol) {
      renderTrade();
      renderChartHead();
      if (candle && S.range === '1D' && isOpen('chartSheet')) candle.tick(t.price);
    }
  }
}

function selectSymbol(sym, focus = false) {
  S.symbol = sym;
  $$('#watchlist .row').forEach((r) => r.classList.toggle('sel', r.dataset.sym === sym));
  renderTrade();
  if (isOpen('chartSheet')) loadChart();
  if (focus) $('#tQty').focus();
}

// ================================================================ trade
const activePosition = (sym) => S.ledger?.account.positions.find((p) => p.symbol === sym);

function renderTrade() {
  const sym = S.symbol;
  const q = S.quotes[sym];
  const qty = +$('#tQty').value || 0;
  $('#tSym').textContent = sym;
  $('#tName').textContent = watchNames()[sym] || q?.name || '';
  $('#tPx').textContent = q?.ok ? fmtPrice(q.price) : '—';
  $('#tCh').textContent = q?.ok ? fmtPct(q.change) : '';
  $('#tCh').className = cls(q?.change);
  $('#tNotional').textContent = q?.ok ? `${fmtMoney(qty * q.price)} NOTIONAL` : '';
  const p = activePosition(sym);
  $('#tPos').innerHTML = p
    ? `<span>${p.qty > 0 ? '<b class="up">LONG</b>' : '<b class="down">SHORT</b>'} ${Math.abs(p.qty)} @ ${fmtPrice(p.avg)} · <span class="${cls(p.pnl)}">${fmtMoney(p.pnl, true)}</span></span><button class="lnk" id="tClose">CLOSE</button>`
    : '<span class="dim">NO POSITION · LONG GAINS IF IT RISES, SHORT IF IT FALLS</span>';
  if ($('#tClose')) $('#tClose').onclick = () => closePos(sym);
}

async function placeOrder(dir) {
  const qty = +$('#tQty').value;
  const stop = $('#tStop').value ? +$('#tStop').value : undefined;
  const target = $('#tTarget').value ? +$('#tTarget').value : undefined;
  const btns = [$('#btnLong'), $('#btnShort')];
  btns.forEach((b) => (b.disabled = true));
  try {
    const { order, state } = await api.ledger.order({ symbol: S.symbol, side: dir > 0 ? 'buy' : 'sell', qty, stop, target });
    onLedger(state);
    const verb = order.realized ? (dir > 0 ? 'Covered' : 'Sold') : dir > 0 ? 'Long' : 'Short';
    toast(`${verb} ${order.qty} ${order.symbol} at ${fmtPrice(order.price)}`, 'ok');
    $('#tStop').value = ''; $('#tTarget').value = '';
  } catch (e) { toast(e.message, 'err'); }
  btns.forEach((b) => (b.disabled = false));
}

async function closePos(sym, auto = false) {
  try {
    if (auto) { await api.ledger.closeIn(sym, S.auto.accountId); onAuto(await api.autopilot.state()); }
    else onLedger(await api.ledger.close(sym));
    toast(`Closed ${sym}`, 'ok');
  } catch (e) { toast(e.message, 'err'); }
}

// ================================================================ ledger + autopilot
function onLedger(st) {
  if (S.auto?.accountId && st.active === S.auto.accountId) return;
  S.ledger = st;
  const a = st.account;
  $('#equityBtn').innerHTML = `<span class="tag">PAPER</span><span>${fmtMoney(a.equityNow)}</span><span class="${cls(a.dayPnl)}">${fmtMoney(a.dayPnl, true)}</span>`;
  $('#bigEquity').innerHTML = `${Math.round(a.equityNow).toLocaleString('en-US')}<u>USD</u>`;
  renderTrade();
  renderPositionsPanel();
  drawPositionLines();
  if (isOpen('portfolio') && S.pfTab === 'mine') updatePortfolio();
}

function renderPositionsPanel() {
  const a = S.ledger.account;
  const longV = a.positions.filter((p) => p.qty > 0).reduce((s, p) => s + p.value, 0);
  const shortV = a.positions.filter((p) => p.qty < 0).reduce((s, p) => s + Math.abs(p.value), 0);
  const gross = longV + shortV;
  $('#bigPos').innerHTML = `${Math.round((gross / a.equityNow) * 100)}<u>%</u>`;
  $('#posExpo').innerHTML = gross ? `<div class="l" style="width:${(longV / gross) * 100}%"></div><div class="s" style="width:${(shortV / gross) * 100}%"></div>` : '';
  const autoN = S.auto?.account?.account.positions.length || 0;
  $('#posList').innerHTML = (a.positions.length
    ? a.positions.map((p) => `<div class="pr"><span class="dir ${p.qty > 0 ? 'l' : 's'}">${p.qty > 0 ? 'LONG' : 'SHORT'}</span><button class="lnk" data-sym="${esc(p.symbol)}" style="text-align:left">${esc(p.symbol)}</button><span class="q2">${Math.abs(p.qty)} @ ${fmtPrice(p.avg)}</span><span class="${cls(p.pnl)}" style="text-align:right">${fmtMoney(p.pnl, true)}</span><button class="x" data-close-pos="${esc(p.symbol)}" title="Close position">✕</button></div>`).join('')
    : '<div class="empty" style="padding:10px 0">NO OPEN POSITIONS</div>')
    + `<div class="ap-stats" style="margin-top:6px">AUTOPILOT HOLDS ${autoN} · <button class="lnk" id="posOpen">OPEN PORTFOLIO →</button></div>`;
  $$('#posList [data-sym]').forEach((b) => (b.onclick = () => selectSymbol(b.dataset.sym)));
  $$('#posList [data-close-pos]').forEach((b) => (b.onclick = () => closePos(b.dataset.closePos)));
  $('#posOpen').onclick = () => openPortfolio('mine');
}

function onAuto(st) {
  S.auto = st;
  const on = !!st.enabled;
  $('#apStatus').textContent = on ? 'RUNNING' : 'OFF';
  $('#apStatus').className = on ? 'on' : '';
  const b = $('#btnAuto');
  b.textContent = on ? 'STOP' : 'START';
  b.classList.toggle('on', on);
  b.setAttribute('aria-checked', on);
  $('#apEvents').checked = !!st.strategies?.events;
  $('#apTrend').checked = !!st.strategies?.trend;
  const snap = st.account;
  if (snap) {
    const a = snap.account;
    const ret = a.totalPnl / a.startCash;
    const big = $('#bigAuto');
    big.textContent = fmtPct(ret);
    big.className = `big ${cls(ret)}`;
    const longs = a.positions.filter((p) => p.qty > 0).length, shorts = a.positions.length - longs;
    const closed = a.orders.filter((o) => o.realized);
    const wins = closed.filter((o) => o.realized > 0).length;
    $('#apStats').textContent = `EQUITY ${fmtMoney(a.equityNow)} · LONG ${longs} · SHORT ${shorts} · WIN ${closed.length ? `${Math.round((wins / closed.length) * 100)}%` : '—'}`;
    spark($('#apSpark'), (snap.equityCurve || []).map((p) => p.v), a.startCash, { color: '#57c7d4' });
  } else {
    $('#bigAuto').textContent = '—';
    $('#apStats').textContent = 'TRADES ITS OWN $100,000 PAPER ACCOUNT, LONG AND SHORT';
  }
  $('#apLog').innerHTML = (st.log || []).slice(0, 3).map((l) => `<div><span>${new Date(l.t).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' })}</span> ${esc(l.text)}</div>`).join('') || '<div class="dim">NO ACTIVITY YET</div>';
  if (S.ledger) renderPositionsPanel();
  if (isOpen('portfolio') && S.pfTab === 'auto') updatePortfolio();
}

async function toggleAuto() {
  if (S.auto?.enabled) {
    onAuto(await api.autopilot.stop());
    toast('Autopilot off. Its positions keep their stops and targets.');
    return;
  }
  if (!S.settings.autoIntroSeen) {
    const ok = await confirmModal('START AUTOPILOT?', `<p>Autopilot trades its own $100,000 paper account, long and short, with two simple rules.</p>
      <p><b>Event reaction.</b> When a new high-severity event lands, it takes the textbook move in the linked markets: a Gulf conflict goes long Brent and gold, a Gulf hurricane goes long natural gas and short an insurer.</p>
      <p><b>Trend.</b> Every hour it goes long markets above their 20- and 50-day averages and short markets below both.</p>
      <p>Every trade gets a stop and a target. It keeps running in the tray when you close the window. Neither rule is a proven edge, so treat it as an experiment you watch.</p>`, 'START AUTOPILOT');
    if (!ok) return;
    S.settings = await api.settings.set({ autoIntroSeen: true });
  }
  onAuto(await api.autopilot.start());
  toast('Autopilot on', 'ok');
}

// ================================================================ chart sheet
let chartReq = 0;
async function loadChart() {
  if (!candle) candle = new CandleChart($('#chart'));
  const req = ++chartReq;
  renderChartHead();
  try {
    const c = await api.markets.chart(S.symbol, S.range);
    if (req !== chartReq) return;
    candle.setData(c.candles);
    drawPositionLines();
  } catch (e) { if (req === chartReq) toast(`No chart for ${S.symbol}: ${e.message}`, 'err'); }
}

function renderChartHead() {
  const q = S.quotes[S.symbol];
  $('#chartHead').innerHTML = `<b>${esc(S.symbol)}</b><span>${esc(watchNames()[S.symbol] || q?.name || '')}</span>${q?.ok ? `<span style="color:#fff">${fmtPrice(q.price)}</span><span class="${cls(q.change)}">${fmtPct(q.change)}</span>` : ''}`;
}

function drawPositionLines() {
  if (!candle) return;
  const p = activePosition(S.symbol);
  const lines = [];
  if (p) {
    lines.push({ price: p.avg, color: '#57c7d4', label: `${p.qty > 0 ? 'LONG' : 'SHORT'} ${Math.abs(p.qty)}` });
    if (p.stop) lines.push({ price: p.stop, color: '#ff5a4e', label: 'STOP' });
    if (p.target) lines.push({ price: p.target, color: '#3ddc84', label: 'TARGET' });
  }
  candle.setLines(lines);
}

// ================================================================ sheets
const isOpen = (id) => !$(`#${id}`).classList.contains('hidden');
function syncSheets() {
  document.body.classList.toggle('sheet-open', isOpen('chartSheet') || isOpen('portfolio'));
  $('#btnChart').classList.toggle('on', isOpen('chartSheet'));
  $('#btnPortfolio').classList.toggle('on', isOpen('portfolio'));
}
function closeSheet(id) { $(`#${id}`).classList.add('hidden'); syncSheets(); }
function openChart() {
  closeSheet('portfolio');
  $('#chartSheet').classList.remove('hidden');
  syncSheets();
  loadChart();
}
function openPortfolio(tab = S.pfTab) {
  S.pfTab = tab;
  closeSheet('chartSheet');
  $('#portfolio').classList.remove('hidden');
  syncSheets();
  buildPortfolio();
}

function buildPortfolio() {
  const el = $('#portfolio');
  const auto = S.pfTab === 'auto';
  const accounts = (S.ledger?.accounts || []).filter((a) => a.id !== S.auto?.accountId);
  el.innerHTML = `
    <div class="sh-head">
      <div class="sh-title"><h2>PORTFOLIO</h2><span class="q">${auto ? 'SELECT * FROM AUTOPILOT_ACCOUNT' : 'SELECT * FROM PAPER_ACCOUNT'}</span></div>
      ${!auto && accounts.length > 1 ? `<select id="pfAcct" style="width:170px">${accounts.map((a) => `<option value="${a.id}" ${a.id === S.ledger.active ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select>` : ''}
      <div class="tg" id="pfSeg"><button data-v="mine" class="${auto ? '' : 'on'}">MY TRADES</button><button data-v="auto" class="${auto ? 'on' : ''}">AUTOPILOT</button></div>
      <button class="x" data-close="portfolio">CLOSE ✕</button>
    </div>
    <div class="pf-body">
      <div class="kpis" id="pfKpis"></div>
      ${auto ? autoControls() : ''}
      <div class="pf-grid">
        <div class="box"><h4>EQUITY</h4><div class="eq-box" id="eqChart"></div></div>
        <div class="box"><h4>EXPOSURE <span class="dim" id="pfExpoTxt"></span></h4><div class="expo" id="pfExpo"></div><div class="alloc" id="pfAlloc"></div></div>
      </div>
      <div class="box">
        <h4><span>${auto ? 'WHAT AUTOPILOT HOLDS' : 'YOUR POSITIONS'}</span><span class="tg" id="pfListSeg"><button data-v="positions">POSITIONS</button><button data-v="orders">ORDERS</button>${auto ? '<button data-v="log">ACTIVITY</button>' : ''}</span></h4>
        <div id="pfList"></div>
      </div>
      ${auto ? '' : mineControls()}
    </div>`;
  if (!auto && S.pfList === 'log') S.pfList = 'positions';
  $$('#pfListSeg button').forEach((b) => b.classList.toggle('on', b.dataset.v === S.pfList));
  eqChart = new LineChart($('#eqChart'));
  wirePortfolio();
  updatePortfolio();
}

function autoControls() {
  const a = S.auto || {};
  return `<div class="box" id="pfAuto">
    <h4><span>AUTOPILOT · <span id="autoBadge"></span></span><span class="actions">
      <button class="tbtn" id="aToggle"></button><button class="tbtn danger" id="aFlat">CLOSE ALL</button><button class="tbtn" id="aReset">RESET ACCOUNT</button></span></h4>
    <p class="strategy"><b>Event reaction</b> takes the textbook move in an event's linked markets. <b>Trend</b> goes long above the 20- and 50-day averages and short below both, checked hourly. Every trade has a stop and a target.</p>
    <div class="cfg" style="margin-top:10px">
      <label>RISK PER TRADE %<input type="number" data-k="riskPct" min="0.1" step="0.1" value="${a.riskPct ?? 0.5}"></label>
      <label>STOP %<input type="number" data-k="stopPct" min="0.5" step="0.5" value="${a.stopPct ?? 2.5}"></label>
      <label>TARGET %<input type="number" data-k="targetPct" min="0.5" step="0.5" value="${a.targetPct ?? 5}"></label>
      <label>MAX HOLD (HOURS)<input type="number" data-k="maxHoldHrs" min="1" step="1" value="${a.maxHoldHrs ?? 72}"></label>
    </div>
    <p class="fine" style="margin-top:8px">Paper money only. Neither rule has a proven edge; the earlier backtests found none.</p>
  </div>`;
}

function mineControls() {
  const r = S.ledger?.account.rules || {};
  return `<div class="box"><h4>ACCOUNT RULES</h4>
    <div class="cfg">
      <label>FEE PER TRADE (BPS)<input type="number" id="rFee" min="0" step="0.5" value="${r.feeBps ?? 5}"></label>
      <label>MAX POSITION % OF EQUITY<input type="number" id="rMax" min="0" step="1" value="${r.maxPositionPct ?? 25}"></label>
      <label>STOP TRADING AFTER DAILY LOSS %<input type="number" id="rLoss" min="0" step="0.5" value="${r.dailyLossPct ?? 5}"></label>
    </div>
    <div class="actions" style="margin-top:10px"><button class="tbtn" id="mNew">NEW ACCOUNT</button><button class="tbtn" id="mReset">RESET ACCOUNT</button><button class="tbtn" id="mCsv">EXPORT ORDERS CSV</button></div></div>`;
}

function wirePortfolio() {
  const el = $('#portfolio');
  $('[data-close]', el).onclick = () => closeSheet('portfolio');
  $('#pfSeg').onclick = (ev) => { const b = ev.target.closest('button'); if (b) { S.pfTab = b.dataset.v; buildPortfolio(); } };
  $('#pfListSeg').onclick = (ev) => { const b = ev.target.closest('button'); if (!b) return; S.pfList = b.dataset.v; $$('#pfListSeg button').forEach((x) => x.classList.toggle('on', x === b)); updatePortfolio(); };
  if ($('#pfAcct')) $('#pfAcct').onchange = async (ev) => { onLedger(await api.ledger.switchAccount(ev.target.value)); buildPortfolio(); };
  if (S.pfTab === 'auto') {
    $('#aToggle').onclick = toggleAuto;
    $('#aFlat').onclick = async () => { if (await confirmModal('CLOSE EVERY AUTOPILOT POSITION?', 'Each position is closed at the latest price.', 'CLOSE ALL')) onAuto(await api.autopilot.flatten()); };
    $('#aReset').onclick = async () => { if (await confirmModal('RESET THE AUTOPILOT ACCOUNT?', 'Positions, orders and history are cleared and cash goes back to $100,000.', 'RESET')) { onAuto(await api.autopilot.reset()); buildPortfolio(); } };
    $$('#pfAuto [data-k]').forEach((i) => (i.onchange = async () => onAuto(await api.autopilot.configure({ [i.dataset.k]: +i.value }))));
  } else {
    const saveRules = async () => onLedger(await api.ledger.rules({ feeBps: +$('#rFee').value, maxPositionPct: +$('#rMax').value, dailyLossPct: +$('#rLoss').value }));
    ['#rFee', '#rMax', '#rLoss'].forEach((s) => ($(s).onchange = saveRules));
    $('#mNew').onclick = newAccountModal;
    $('#mReset').onclick = async () => { if (await confirmModal('RESET THIS ACCOUNT?', 'Positions, orders and history are cleared and cash returns to the starting balance.', 'RESET')) { onLedger(await api.ledger.resetAccount()); buildPortfolio(); } };
    $('#mCsv').onclick = async () => { const f = await api.ledger.exportCsv(); toast(`Saved ${f.split(/[\\/]/).pop()} to Downloads`, 'ok'); };
  }
}

function updatePortfolio() {
  if (!isOpen('portfolio')) return;
  const auto = S.pfTab === 'auto';
  const snap = auto ? S.auto?.account : S.ledger;
  if (auto) {
    const on = !!S.auto?.enabled;
    $('#autoBadge').textContent = on ? 'RUNNING' : 'OFF';
    $('#autoBadge').className = on ? 'up' : 'dim';
    $('#aToggle').textContent = on ? 'STOP AUTOPILOT' : 'START AUTOPILOT';
  }
  if (!snap) {
    $('#pfKpis').innerHTML = '<div class="empty" style="grid-column:1/-1">Autopilot has no account yet. Start it to create one with $100,000 of paper money.</div>';
    $('#pfList').innerHTML = ''; $('#pfAlloc').innerHTML = ''; $('#pfExpo').innerHTML = ''; eqChart.setData([]);
    return;
  }
  const a = snap.account;
  const longV = a.positions.filter((p) => p.qty > 0).reduce((s, p) => s + p.value, 0);
  const shortV = a.positions.filter((p) => p.qty < 0).reduce((s, p) => s + Math.abs(p.value), 0);
  const closed = a.orders.filter((o) => o.realized);
  const wins = closed.filter((o) => o.realized > 0).length;
  const k = (label, value, c = '') => `<div class="kpi"><span>${label}</span><b class="${c}" title="${esc(value)}">${value}</b></div>`;
  $('#pfKpis').innerHTML = [
    k('EQUITY', fmtMoney(a.equityNow)),
    k('TODAY', fmtMoney(a.dayPnl, true), cls(a.dayPnl)),
    k('ALL TIME', fmtPct(a.totalPnl / a.startCash), cls(a.totalPnl)),
    k('CASH', fmtMoney(a.cash)),
    k('LONG', fmtMoney(longV), longV ? 'up' : ''),
    k('SHORT', fmtMoney(shortV), shortV ? 'down' : ''),
    k('WIN RATE', closed.length ? `${Math.round((wins / closed.length) * 100)}% / ${closed.length}` : '—'),
  ].join('');
  const gross = longV + shortV;
  $('#pfExpo').innerHTML = gross ? `<div class="l" style="width:${(longV / gross) * 100}%"></div><div class="s" style="width:${(shortV / gross) * 100}%"></div>` : '';
  $('#pfExpoTxt').textContent = gross ? `${Math.round((gross / a.equityNow) * 100)}% OF EQUITY INVESTED` : 'ALL CASH';
  $('#pfAlloc').innerHTML = a.positions.length
    ? [...a.positions].sort((x, y) => Math.abs(y.value) - Math.abs(x.value)).map((p) => `<div class="al"><span style="color:#fff">${esc(p.symbol)}</span><div class="bar"><span style="width:${Math.min(100, (Math.abs(p.value) / a.equityNow / 0.25) * 100)}%;background:${p.qty > 0 ? 'var(--up)' : 'var(--down)'}"></span></div><em>${(Math.abs(p.value) / a.equityNow * 100).toFixed(1)}%</em></div>`).join('')
    : '<div class="dim">NO OPEN POSITIONS</div>';
  eqChart.setData((snap.equityCurve || []).map((p) => ({ t: p.t, v: p.v })));

  const list = $('#pfList');
  if (S.pfList === 'orders') {
    list.innerHTML = a.orders.length ? `<table><thead><tr><th>TIME</th><th>MARKET</th><th>SIDE</th><th class="n">QTY</th><th class="n">PRICE</th><th class="n">REALIZED</th><th>WHY</th></tr></thead><tbody>
      ${a.orders.slice(0, 150).map((o) => `<tr><td class="dim">${fmtTime(o.time)}</td><td style="color:#fff">${esc(o.symbol)}</td><td class="${o.side === 'buy' ? 'up' : 'down'}">${o.side.toUpperCase()}</td><td class="n">${o.qty}</td><td class="n">${fmtPrice(o.price)}</td><td class="n ${cls(o.realized)}">${o.realized ? fmtMoney(o.realized, true) : '—'}</td><td class="dim">${esc(o.reason)}</td></tr>`).join('')}</tbody></table>`
      : '<div class="empty">NO ORDERS YET</div>';
  } else if (S.pfList === 'log') {
    const log = S.auto?.log || [];
    list.innerHTML = log.length ? `<div class="log">${log.slice(0, 200).map((l) => `<div><time>${new Date(l.t).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' })}</time><span class="ty ${l.type}">${l.type.toUpperCase()}</span><span>${esc(l.text)}</span></div>`).join('')}</div>` : '<div class="empty">NOTHING YET</div>';
  } else {
    list.innerHTML = a.positions.length ? `<table><thead><tr><th>MARKET</th><th>SIDE</th><th class="n">QTY</th><th class="n">ENTRY</th><th class="n">LAST</th><th class="n">P&amp;L</th><th class="n">STOP</th><th class="n">TARGET</th>${auto ? '<th>RULE</th>' : ''}<th></th></tr></thead><tbody>
      ${a.positions.map((p) => `<tr><td style="color:#fff">${esc(p.symbol)}</td><td><span class="dir ${p.qty > 0 ? 'l' : 's'}">${p.qty > 0 ? 'LONG' : 'SHORT'}</span></td><td class="n">${Math.abs(p.qty)}</td><td class="n">${fmtPrice(p.avg)}</td><td class="n">${fmtPrice(p.price)}</td>
        <td class="n ${cls(p.pnl)}">${fmtMoney(p.pnl, true)} <span class="dim">${fmtPct(p.pnlPct, 1)}</span></td><td class="n dim">${p.stop ? fmtPrice(p.stop) : '—'}</td><td class="n dim">${p.target ? fmtPrice(p.target) : '—'}</td>${auto ? `<td class="dim">${esc((p.owner || '').toUpperCase())}</td>` : ''}
        <td class="n"><button class="lnk" data-close-pos="${esc(p.symbol)}">CLOSE</button></td></tr>`).join('')}</tbody></table>`
      : `<div class="empty">${auto ? (S.auto?.enabled ? 'WATCHING — TRADES OPEN ON NEW HIGH-SEVERITY EVENTS AND THE HOURLY TREND CHECK' : 'AUTOPILOT IS OFF') : 'NO POSITIONS — PICK A MARKET AND PRESS LONG OR SHORT'}</div>`;
    $$('[data-close-pos]', list).forEach((b) => (b.onclick = () => closePos(b.dataset.closePos, auto)));
  }
}

// ================================================================ updater, modals, toasts
function onUpdater(u) {
  S.update = u;
  const pill = $('#updatePill');
  if (u.status === 'ready') { pill.textContent = `RESTART TO UPDATE · V${u.version}`; pill.classList.remove('hidden'); }
  else if (u.status === 'downloading') { pill.textContent = u.message.toUpperCase(); pill.classList.remove('hidden'); }
  else pill.classList.add('hidden');
  if ($('#updStatus')) $('#updStatus').textContent = u.message || '';
}

function toast(msg, type = 'info', ms = 3800) {
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<i></i><span>${esc(msg)}</span>`;
  $('#toasts').appendChild(t);
  setTimeout(() => { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, ms);
}

function openModal(html) { $('#modal').innerHTML = html; $('#modalBack').classList.remove('hidden'); return $('#modal'); }
function closeModal() { $('#modalBack').classList.add('hidden'); $('#modal').innerHTML = ''; }

function confirmModal(title, bodyHtml, okLabel) {
  return new Promise((resolve) => {
    const m = openModal(`<header><h2>${esc(title)}</h2></header><section>${bodyHtml.startsWith('<') ? bodyHtml : `<p>${esc(bodyHtml)}</p>`}</section>
      <footer><button class="tbtn" id="mNo">CANCEL</button><button class="tbtn on" id="mYes">${esc(okLabel)}</button></footer>`);
    $('#mNo', m).onclick = () => { closeModal(); resolve(false); };
    $('#mYes', m).onclick = () => { closeModal(); resolve(true); };
    $('#mYes', m).focus();
  });
}

function newAccountModal() {
  const m = openModal(`<header><h2>NEW PAPER ACCOUNT</h2></header>
    <section><div class="r"><span>Name</span><input type="text" id="naName" value="Strategy test"></div>
    <div class="r"><span>Starting cash (USD)</span><input type="number" id="naCash" value="100000" min="100" step="1000"></div></section>
    <footer><button class="tbtn" id="mNo">CANCEL</button><button class="tbtn on" id="mYes">CREATE</button></footer>`);
  $('#mNo', m).onclick = closeModal;
  $('#mYes', m).onclick = async () => { onLedger(await api.ledger.createAccount($('#naName').value, +$('#naCash').value)); closeModal(); buildPortfolio(); toast('Account created', 'ok'); };
}

function settingsModal() {
  const st = S.settings;
  const m = openModal(`<header><img src="logo.svg" alt=""><h2>SETTINGS</h2><span class="dim">V${esc(S.info.version)}</span><button class="x" id="mX">CLOSE ✕</button></header>
    <section><h3>ALERTS</h3>
      <div class="r"><span>Desktop alerts for major events</span><button class="switch ${st.notifications ? 'on' : ''}" id="sNotif" role="switch" aria-label="Desktop alerts"></button></div>
      <div class="r"><span>Alert at</span><select id="sSev"><option value="0.95">Critical only</option><option value="0.8">Critical</option><option value="0.6">High and above</option></select></div>
      <div class="r"><span>Hide earthquakes below magnitude</span><input type="number" id="sMag" min="2.5" max="7" step="0.5" value="${st.minQuakeMag}"></div>
    </section>
    <section><h3>MARKETS</h3>
      <div class="r"><span>Prices stream live; full refresh every (seconds)</span><input type="number" id="sQuote" min="30" step="10" value="${st.quoteEverySec}"></div>
      <div class="r"><span>Add a market</span><span style="display:flex;gap:6px"><input type="text" id="sAddSym" placeholder="TICKER, E.G. XOM" style="width:140px"><select id="sAddGrp" style="width:120px">${st.watchlist.map((g, i) => `<option value="${i}">${esc(g.group)}</option>`).join('')}</select><button class="tbtn" id="sAdd">ADD</button></span></div>
      <div class="chips" id="sWl"></div>
    </section>
    <section><h3>DATA</h3>
      <table><tbody>${Object.values(S.status).map((f) => `<tr><td>${esc(f.label)}</td><td class="${f.ok ? 'up' : f.ok === false ? 'down' : ''}">${f.ok ? 'LIVE' : f.ok === false ? 'ERROR' : '…'}</td><td class="n">${f.count ?? 0}</td><td class="dim">${f.ok ? `${timeAgo(f.lastOk)} ago` : esc(f.error || '')}</td></tr>`).join('')}</tbody></table>
      <p class="fine">USGS, NOAA, NASA EONET and GIBS, GDACS, public news RSS, and Yahoo Finance's price stream (exchange-delayed; crypto real time). News is placed from place names in the headline and can be wrong. Layout after the TeleGeography internet map; earlier version after God's Eye View (MIT).</p>
    </section>
    <section><h3>UPDATES</h3><div class="r"><span id="updStatus">${esc(S.update?.message || 'Not checked yet')}</span><button class="tbtn" id="sUpd">CHECK NOW</button></div>
      <p class="fine">Data folder: ${esc(S.info.dataDir)}</p></section>`);
  $('#sSev', m).value = String(st.notifyMinSeverity);
  $('#mX', m).onclick = closeModal;
  const save = async (patch) => { S.settings = await api.settings.set(patch); refreshEvents(); };
  $('#sNotif', m).onclick = (ev) => { ev.currentTarget.classList.toggle('on'); save({ notifications: ev.currentTarget.classList.contains('on') }); };
  $('#sSev', m).onchange = (ev) => save({ notifyMinSeverity: +ev.target.value });
  $('#sMag', m).onchange = (ev) => save({ minQuakeMag: +ev.target.value });
  $('#sQuote', m).onchange = (ev) => save({ quoteEverySec: Math.max(30, +ev.target.value) });
  $('#sUpd', m).onclick = async () => { $('#updStatus').textContent = 'Checking…'; onUpdater(await api.updater.check()); };
  const drawWl = () => {
    $('#sWl', m).innerHTML = S.settings.watchlist.flatMap((g, gi) => g.symbols.map(([s], si) => `<span class="chip">${esc(s)}<button data-g="${gi}" data-s="${si}" aria-label="Remove ${esc(s)}">✕</button></span>`)).join('');
    $$('#sWl button', m).forEach((b) => (b.onclick = async () => {
      const wl = structuredClone(S.settings.watchlist);
      wl[+b.dataset.g].symbols.splice(+b.dataset.s, 1);
      await save({ watchlist: wl }); renderWatchlist(); drawWl();
    }));
  };
  drawWl();
  $('#sAdd', m).onclick = async () => {
    const sym = $('#sAddSym').value.trim().toUpperCase();
    if (!sym) return;
    try {
      const info = await api.markets.lookup(sym);
      const wl = structuredClone(S.settings.watchlist);
      wl[+$('#sAddGrp').value].symbols.push([info.symbol, truncate(info.name || sym, 24)]);
      await save({ watchlist: wl }); renderWatchlist(); drawWl();
      $('#sAddSym').value = '';
      toast(`Added ${info.symbol}`, 'ok');
    } catch { toast(`Couldn't find ${sym}`, 'err'); }
  };
}

// ================================================================ wiring
function wireUi() {
  $('#eventList').onclick = (ev) => { const b = ev.target.closest('.ev'); if (b) { const e = S.events.find((x) => x.id === b.dataset.id); if (e) selectEvent(e); } };
  $('#layers').onclick = async (ev) => {
    const b = ev.target.closest('.layer');
    if (!b) return;
    S.settings = await api.settings.set({ layers: { [b.dataset.k]: !S.settings.layers[b.dataset.k] } });
    refreshEvents();
  };
  $('#eventSearch').oninput = (ev) => { S.search = ev.target.value; refreshEvents(); };
  $('#sortSeg').onclick = (ev) => { const b = ev.target.closest('button'); if (!b) return; S.sort = b.dataset.v; $$('#sortSeg button').forEach((x) => x.classList.toggle('on', x === b)); renderEvents(); };
  $('#viewSeg').onclick = (ev) => { const b = ev.target.closest('button'); if (b) setView(b.dataset.v); };
  $('#fxSeg').onclick = (ev) => { const b = ev.target.closest('button'); if (b) setFx({ [b.dataset.fx]: !S.settings.fx[b.dataset.fx] }); };
  $('#surfaceSeg').onclick = (ev) => { const b = ev.target.closest('button'); if (b) setSurface(b.dataset.v); };
  $('#btnHome').onclick = () => { selectEvent(null); map.home(); globe.home(); };
  $('#btnChart').onclick = () => (isOpen('chartSheet') ? closeSheet('chartSheet') : openChart());
  $('#btnPortfolio').onclick = () => (isOpen('portfolio') ? closeSheet('portfolio') : openPortfolio());
  $('#equityBtn').onclick = () => openPortfolio('mine');
  $('#btnAuto').onclick = toggleAuto;
  $('#apEvents').onchange = async (ev) => onAuto(await api.autopilot.configure({ strategies: { events: ev.target.checked } }));
  $('#apTrend').onchange = async (ev) => onAuto(await api.autopilot.configure({ strategies: { trend: ev.target.checked } }));
  $('#apLog').onclick = () => { S.pfList = 'log'; openPortfolio('auto'); };
  $('#apLog').style.cursor = 'pointer';
  $('#btnSettings').onclick = settingsModal;
  $('#updatePill').onclick = () => { if (S.update?.status === 'ready') api.updater.install(); };
  $('[data-close="chartSheet"]').onclick = () => closeSheet('chartSheet');
  $('#rangeSeg').onclick = (ev) => { const b = ev.target.closest('button'); if (!b) return; S.range = b.dataset.v; $$('#rangeSeg button').forEach((x) => x.classList.toggle('on', x === b)); loadChart(); };
  $$('#rangeSeg button').forEach((b) => b.classList.toggle('on', b.dataset.v === S.range));
  $('#btnLong').onclick = () => placeOrder(1);
  $('#btnShort').onclick = () => placeOrder(-1);
  $('#tQty').oninput = renderTrade;
  $$('.tr-row .step').forEach((b) => (b.onclick = () => {
    const i = $('#tQty');
    const q = S.quotes[S.symbol];
    const step = q?.price > 5000 ? 0.01 : q?.price > 500 ? 1 : 5;
    i.value = Math.max(0, +(+i.value + step * +b.dataset.d).toFixed(4));
    renderTrade();
  }));
  $('#modalBack').onclick = (ev) => { if (ev.target.id === 'modalBack') closeModal(); };
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      if (!$('#modalBack').classList.contains('hidden')) return closeModal();
      if (isOpen('portfolio')) return closeSheet('portfolio');
      if (isOpen('chartSheet')) return closeSheet('chartSheet');
      return selectEvent(null);
    }
    if (ev.target.matches('input, select, textarea')) return;
    const key = ev.key.toLowerCase();
    if (key === '/') { ev.preventDefault(); $('#eventSearch').focus(); }
    if (key === 'g') setView(S.view === 'globe' ? 'map' : 'globe');
    if (key === 'p') $('#btnPortfolio').click();
    if (key === 'c') $('#btnChart').click();
  });
}

boot().catch((e) => { console.error(e); toast(`Startup error: ${e.message}`, 'err', 12000); });
