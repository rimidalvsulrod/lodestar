/* global LightweightCharts */
import { KINDS, $, $$, esc, fmtPrice, fmtMoney, fmtPct, cls, timeAgo, fmtTime, sevLabel, exposures, truncate } from './util.js';
import { GlobeView, tipHtml } from './globe-view.js';
import { MapView } from './map-view.js';

const api = window.lodestar;

const S = {
  settings: null, info: null, update: null,
  events: [], status: {}, quotes: {},
  ledger: null, auto: null,
  selEvent: null, symbol: 'CL=F', range: '1D',
  view: 'globe', sort: 'time', search: '',
  pfTab: 'mine', pfList: 'positions',
  satUrl: null, satDay: null, pov: { lat: 24, lng: 28, altitude: 1.95 },
};

const FILTERS = {
  normal: 'none',
  nvg: 'grayscale(1) brightness(1.15) sepia(1) hue-rotate(52deg) saturate(2.6) contrast(1.15)',
  thermal: 'contrast(1.06) saturate(1.1)',
  crt: 'saturate(1.25) contrast(1.08)',
  noir: 'grayscale(1) contrast(1.3) brightness(0.95)',
};

let globe, map, chart, candles, volume, eqChart, eqSeries, priceLines = [];
const tzShift = -new Date().getTimezoneOffset() * 60;
const tip = Object.assign(document.createElement('div'), { className: 'tooltip hidden' });
document.body.appendChild(tip);

// ================================================================ boot
async function boot() {
  [S.settings, S.info] = await Promise.all([api.settings.get(), api.info()]);
  globe = new GlobeView($('#globe'), { onSelect: (e) => selectEvent(e), onView: (pov) => { S.pov = pov; renderReadout(); } });
  map = new MapView($('#map2d'), { onSelect: (e) => selectEvent(e), onHover: showMapTip });

  wireUi();
  initChart();
  setSurface(S.settings.globeStyle || 'night', false);
  setFilter(FILTERS[S.settings.filter] ? S.settings.filter : 'normal', false);
  setSpin(S.settings.autoRotate !== false && !matchMedia('(prefers-reduced-motion: reduce)').matches, false);

  api.feeds.onEvents(onEvents);
  api.feeds.onStatus(onStatus);
  api.feeds.onFocus((id) => { const e = S.events.find((x) => x.id === id); if (e) selectEvent(e); });
  api.markets.onQuotes(onQuotes);
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
  setInterval(() => renderEvents(), 30000);
}

function tick() {
  $('#clock').textContent = `${new Date().toISOString().slice(11, 19)} UTC`;
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
    && (!q || `${e.title} ${e.place} ${e.source}`.toLowerCase().includes(q)));
}

function refreshEvents() {
  const list = filtered();
  globe.setEvents(list);
  map.setEvents(list);
  renderLayers();
  renderEvents(list);
}

function renderLayers() {
  const counts = {};
  for (const e of S.events) counts[e.kind] = (counts[e.kind] || 0) + 1;
  $('#layers').innerHTML = Object.entries(KINDS).map(([k, v]) =>
    `<button class="layer ${S.settings.layers[k] ? 'on' : ''}" data-k="${k}" style="--c:${v.color}" aria-pressed="${!!S.settings.layers[k]}"><i></i><span>${v.label}</span><b>${counts[k] || 0}</b></button>`).join('');
}

function renderEvents(list = filtered()) {
  const sorted = [...list].sort((a, b) => (S.sort === 'severity' ? b.severity - a.severity || b.time - a.time : b.time - a.time));
  $('#eventCount').textContent = `${list.length}`;
  const el = $('#eventList');
  if (!sorted.length) {
    el.innerHTML = `<div class="empty">${S.events.length ? 'Nothing matches. Turn a layer on or clear the search.' : 'Connecting to live feeds…'}</div>`;
    return;
  }
  el.innerHTML = sorted.slice(0, 300).map((e) => {
    const k = KINDS[e.kind];
    return `<button class="ev ${S.selEvent?.id === e.id ? 'sel' : ''}" data-id="${esc(e.id)}" style="--c:${k.color}">
      <div class="ev-top"><i></i><span class="k">${k.one}</span><span>${esc(e.source)}</span><span class="t">${timeAgo(e.time)}</span></div>
      <div class="ev-title">${esc(e.title)}</div>
      <div class="ev-place"><span class="sev"><span style="width:${Math.round(e.severity * 100)}%"></span></span>${esc(truncate(e.place || '', 46))}</div>
    </button>`;
  }).join('');
}

function onStatus(st) {
  S.status = st;
  const feeds = Object.values(st);
  const live = feeds.filter((f) => f.ok).length;
  $('#feedsLine').innerHTML = `<span>${feeds.map((f) => `<i class="${f.loading ? 'load' : f.ok ? 'ok' : f.ok === false ? 'err' : ''}" title="${esc(f.label)}${f.ok ? ` · ${f.count} items` : f.error ? ` · ${esc(f.error)}` : ''}"></i>`).join('')}</span><span>${live} of ${feeds.length} feeds live</span>`;
}

// ================================================================ selection
function selectEvent(e) {
  S.selEvent = e;
  if (e) setSpin(false, false);
  globe.select(e, S.view === 'globe');
  map.select(e);
  renderEvents();
  renderDetail();
  renderReadout();
}

function renderDetail() {
  const e = S.selEvent;
  const el = $('#detail');
  if (!e) { el.classList.add('hidden'); return; }
  const k = KINDS[e.kind];
  const [sl, sc] = sevLabel(e.severity);
  const facts = [];
  if (e.place) facts.push(['Where', e.place]);
  facts.push(['When', `${fmtTime(e.time)} · ${timeAgo(e.time)} ago`]);
  if (e.meta?.mag) facts.push(['Magnitude', `M${e.meta.mag.toFixed(1)}, ${Math.round(e.meta.depth)} km deep${e.meta.tsunami ? ', tsunami flag' : ''}`]);
  if (e.meta?.intensity) facts.push(['Winds', `${e.meta.intensity} kt, ${e.meta.pressure} mb`]);
  if (e.meta?.alert) facts.push(['Alert', e.meta.alert]);
  facts.push(['Source', e.source]);
  const ex = exposures(e);
  el.style.setProperty('--c', k.color);
  el.innerHTML = `
    <div class="card-head"><i></i><span>${k.one}</span><span class="badge" style="color:${sc}">${sl}</span><button class="icon-btn close" id="dClose" aria-label="Close">✕</button></div>
    <h3>${esc(e.title)}</h3>
    ${e.summary && e.summary !== e.title ? `<p>${esc(truncate(e.summary, 280))}</p>` : ''}
    <dl class="facts">${facts.map(([a, b]) => `<dt>${esc(a)}</dt><dd>${esc(b)}</dd>`).join('')}</dl>
    ${e.url ? '<button class="link" id="dOpen">Read the source report ↗</button>' : ''}
    ${ex.length ? `<div class="sub">Linked markets</div><div class="links">${ex.map((x) => {
      const q = S.quotes[x.symbol];
      const d = x.dir > 0 ? '<span class="dir l">USUALLY UP</span>' : x.dir < 0 ? '<span class="dir s">USUALLY DOWN</span>' : '<span class="dir n">MENTIONED</span>';
      return `<button class="lm" data-sym="${esc(x.symbol)}"><b>${esc(x.symbol)}</b><span>${esc(x.why)}</span>${d}<em class="${cls(q?.change)}">${q?.ok ? fmtPct(q.change) : ''}</em></button>`;
    }).join('')}</div><p class="fine">Textbook relationships for this kind of event, not a prediction. Click one to trade it on paper.</p>` : ''}`;
  el.classList.remove('hidden');
  $('#dClose').onclick = () => selectEvent(null);
  if ($('#dOpen')) $('#dOpen').onclick = () => api.openExternal(e.url);
  $$('.lm', el).forEach((b) => (b.onclick = () => selectSymbol(b.dataset.sym, true)));
}

function renderReadout() {
  const p = S.pov || {};
  const lat = p.lat ?? 0, lng = p.lng ?? 0;
  const altKm = Math.round((p.altitude ?? 2) * 6371);
  const look = `${(S.settings.globeStyle || 'night').toUpperCase()} · ${(S.settings.filter || 'normal').toUpperCase()}`;
  const focus = S.selEvent ? truncate(S.selEvent.place || S.selEvent.title, 40) : 'Whole world';
  $('#readout').innerHTML = S.view === 'globe'
    ? `<div><b>View</b> ${look}</div><div>Lat ${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'} · Lon ${Math.abs(lng).toFixed(2)}°${lng >= 0 ? 'E' : 'W'} · Alt ${altKm.toLocaleString()} km</div><div><b>Focus</b> ${esc(focus)}</div>`
    : `<div><b>View</b> Map · ${look}</div><div><b>Focus</b> ${esc(focus)}</div>`;
}

function showMapTip(e, ev) {
  if (!e) { tip.classList.add('hidden'); return; }
  tip.innerHTML = tipHtml(e);
  tip.style.left = `${Math.min(ev.clientX + 14, innerWidth - 320)}px`;
  tip.style.top = `${ev.clientY + 14}px`;
  tip.classList.remove('hidden');
}

// ================================================================ look
function setView(v) {
  S.view = v;
  $$('#viewSeg button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
  $('#globe').classList.toggle('hidden', v !== 'globe');
  $('#map2d').classList.toggle('hidden', v !== 'map');
  map.setVisible(v === 'map');
  if (v === 'globe') { globe.resume(); globe.resize(); } else globe.pause();
  tip.classList.add('hidden');
  if (S.selEvent) map.select(S.selEvent);
  renderReadout();
}

async function setSurface(style, save = true) {
  $$('#surfaceSeg button').forEach((b) => b.classList.toggle('on', b.dataset.v === style));
  if (style === 'satellite' && !S.satUrl) {
    toast('Loading yesterday’s NASA satellite image…');
    try { const s = await api.feeds.satellite(); S.satUrl = s.url; S.satDay = s.day; } catch (e) { toast(`Satellite image unavailable: ${e.message}`, 'err'); }
  }
  globe.setStyle(style, S.satUrl);
  S.settings.globeStyle = style;
  renderReadout();
  if (save) S.settings = await api.settings.set({ globeStyle: style });
}

async function setFilter(f, save = true) {
  $$('#filterSeg button').forEach((b) => b.classList.toggle('on', b.dataset.v === f));
  $('#globe').style.filter = FILTERS[f] || 'none';
  $('#map2d').style.filter = FILTERS[f] || 'none';
  $('#fx').className = `fx ${['crt', 'nvg', 'thermal'].includes(f) ? f : ''}`;
  globe.setThermal(f === 'thermal');
  map.setThermal(f === 'thermal');
  document.body.classList.toggle('mode-thermal', f === 'thermal');
  S.settings.filter = f;
  renderReadout();
  if (save) S.settings = await api.settings.set({ filter: f });
}

async function setSpin(on, save = true) {
  globe.setRotate(on);
  $('#spinSwitch').classList.toggle('on', on);
  $('#spinSwitch').setAttribute('aria-checked', on);
  if (save) S.settings = await api.settings.set({ autoRotate: on });
}

// ================================================================ markets
function watchNames() { return Object.fromEntries(S.settings.watchlist.flatMap((g) => g.symbols)); }

function renderWatchlist() {
  $('#watchlist').innerHTML = S.settings.watchlist.map((g) => `
    <div class="wl-group"><h3>${esc(g.group)}</h3>
      ${g.symbols.map(([s, n]) => `<button class="row ${S.symbol === s ? 'sel' : ''}" data-sym="${esc(s)}">
        <div><div class="s">${esc(s)}</div><div class="n">${esc(n)}</div></div>
        <canvas width="112" height="40"></canvas><div class="p">—</div><div class="c">—</div></button>`).join('')}
    </div>`).join('');
  $$('#watchlist .row').forEach((r) => (r.onclick = () => selectSymbol(r.dataset.sym)));
  updateWatchlist();
}

function updateWatchlist() {
  for (const row of $$('#watchlist .row')) {
    const q = S.quotes[row.dataset.sym];
    if (!q) continue;
    if (!q.ok) { $('.p', row).textContent = 'n/a'; row.title = q.error || ''; continue; }
    $('.p', row).textContent = fmtPrice(q.price);
    const c = $('.c', row);
    c.textContent = fmtPct(q.change);
    c.className = `c ${cls(q.change)}`;
    spark($('canvas', row), q.spark, q.prevClose);
  }
}

function spark(cv, data, base) {
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, cv.width, cv.height);
  if (!data || data.length < 2) return;
  const lo = Math.min(...data, base ?? Infinity), hi = Math.max(...data, base ?? -Infinity);
  const W = cv.width, H = cv.height, pad = 3;
  const y = (v) => H - pad - ((v - lo) / (hi - lo || 1)) * (H - pad * 2);
  const col = data.at(-1) >= (base ?? data[0]) ? '#30d158' : '#ff453a';
  if (base != null) { ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(0, Math.round(y(base)), W, 1); }
  ctx.beginPath();
  data.forEach((v, i) => { const x = (i / (data.length - 1)) * W; i ? ctx.lineTo(x, y(v)) : ctx.moveTo(x, y(v)); });
  ctx.strokeStyle = col; ctx.lineWidth = 2.2; ctx.lineJoin = 'round'; ctx.stroke();
}

function onQuotes(q) {
  S.quotes = { ...S.quotes, ...q };
  if (!$('#watchlist .row')) renderWatchlist(); else updateWatchlist();
  renderTrade();
  renderChartHead();
  if (S.selEvent) for (const b of $$('#detail .lm')) {
    const qq = S.quotes[b.dataset.sym];
    if (qq?.ok) { $('em', b).textContent = fmtPct(qq.change); $('em', b).className = cls(qq.change); }
  }
}

function selectSymbol(sym, focusTrade = false) {
  S.symbol = sym;
  $$('#watchlist .row').forEach((r) => r.classList.toggle('sel', r.dataset.sym === sym));
  $('#watchlist .row.sel')?.scrollIntoView({ block: 'nearest' });
  renderTrade();
  if (!$('#chartSheet').classList.contains('hidden')) loadChart();
  if (focusTrade) $('#tQty').focus();
}

// ================================================================ trade
function activePosition(sym) { return S.ledger?.account.positions.find((p) => p.symbol === sym); }

function renderTrade() {
  const sym = S.symbol;
  const q = S.quotes[sym];
  const qty = +$('#tQty').value || 0;
  $('#tSym').textContent = sym;
  $('#tName').textContent = watchNames()[sym] || q?.name || '';
  $('#tPx').textContent = q?.ok ? fmtPrice(q.price) : '—';
  $('#tCh').textContent = q?.ok ? fmtPct(q.change) : '';
  $('#tCh').className = `mono small ${cls(q?.change)}`;
  $('#tNotional').textContent = q?.ok ? fmtMoney(qty * q.price) : '';
  const p = activePosition(sym);
  $('#tPos').innerHTML = p
    ? `<span>${p.qty > 0 ? 'Long' : 'Short'} ${Math.abs(p.qty)} · <span class="${cls(p.pnl)} mono">${fmtMoney(p.pnl, true)}</span></span><button id="tClose">Close position</button>`
    : '<span class="dim">No position. Long profits if it rises, short if it falls.</span>';
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

// ================================================================ ledger + autopilot state
function onLedger(st) {
  // the "mine" view never shows the autopilot account
  if (S.auto?.accountId && st.active === S.auto.accountId) return;
  S.ledger = st;
  S.mineId = st.active;
  const a = st.account;
  $('#equityBtn').innerHTML = `<span class="tag">PAPER</span><span>${fmtMoney(a.equityNow)}</span><span class="${cls(a.dayPnl)}">${fmtMoney(a.dayPnl, true)}</span>`;
  renderTrade();
  drawPositionLines();
  if (isOpen('portfolio') && S.pfTab === 'mine') updatePortfolio();
}

function onAuto(st) {
  S.auto = st;
  const on = !!st.enabled;
  const b = $('#btnAuto');
  b.classList.toggle('on', on);
  b.setAttribute('aria-checked', on);
  $('b', b).textContent = on ? 'On' : 'Off';
  if (isOpen('portfolio') && S.pfTab === 'auto') updatePortfolio();
}

async function toggleAuto() {
  if (S.auto?.enabled) {
    onAuto(await api.autopilot.stop());
    toast('Autopilot off. Its positions keep their stops and targets.');
    return;
  }
  if (!S.settings.autoIntroSeen) {
    const ok = await confirmModal('Start Autopilot?', `Autopilot trades its own $100,000 paper account, long and short, using two simple rules:
      <p><b>Event reaction.</b> When a new high-severity event lands, it takes the textbook move in the linked markets. A Gulf conflict goes long Brent and gold. A Gulf hurricane goes long natural gas and short an insurer.</p>
      <p><b>Trend.</b> Every hour it goes long markets above their 20- and 50-day averages and short markets below both.</p>
      <p>Every trade gets a stop and a target. It keeps running in the tray if you close the window. Neither rule is a proven edge, so treat it as an experiment you watch, not a money maker.</p>`, 'Start Autopilot', 'go');
    if (!ok) return;
    S.settings = await api.settings.set({ autoIntroSeen: true });
  }
  onAuto(await api.autopilot.start());
  toast('Autopilot on', 'ok');
  openPortfolio('auto');
}

// ================================================================ chart sheet
function initChart() {
  const base = {
    autoSize: true,
    layout: { background: { type: 'solid', color: 'transparent' }, textColor: 'rgba(236,236,240,0.5)', fontFamily: 'JetBrains Mono, Consolas, monospace', fontSize: 11 },
    grid: { vertLines: { color: 'rgba(255,255,255,0.04)' }, horzLines: { color: 'rgba(255,255,255,0.04)' } },
    rightPriceScale: { borderColor: 'rgba(255,255,255,0.08)' },
    timeScale: { borderColor: 'rgba(255,255,255,0.08)', timeVisible: true, secondsVisible: false },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal, vertLine: { color: 'rgba(47,211,255,0.4)', labelBackgroundColor: '#1c2230' }, horzLine: { color: 'rgba(47,211,255,0.4)', labelBackgroundColor: '#1c2230' } },
  };
  S.chartBase = base;
  chart = LightweightCharts.createChart($('#chart'), base);
  candles = chart.addCandlestickSeries({ upColor: '#30d158', downColor: '#ff453a', borderVisible: false, wickUpColor: '#30d15899', wickDownColor: '#ff453a99' });
  volume = chart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: 'vol' });
  chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });
}

let chartReq = 0;
async function loadChart() {
  const req = ++chartReq;
  renderChartHead();
  try {
    const c = await api.markets.chart(S.symbol, S.range);
    if (req !== chartReq) return;
    const shift = ['1D', '5D', '1M'].includes(S.range) ? tzShift : 0;
    candles.setData(c.candles.map((x) => ({ time: x.time + shift, open: x.open, high: x.high, low: x.low, close: x.close })));
    volume.setData(c.candles.map((x) => ({ time: x.time + shift, value: x.volume, color: x.close >= x.open ? 'rgba(48,209,88,0.25)' : 'rgba(255,69,58,0.25)' })));
    chart.timeScale().fitContent();
    drawPositionLines();
  } catch (e) { if (req === chartReq) toast(`No chart for ${S.symbol}: ${e.message}`, 'err'); }
}

function renderChartHead() {
  const q = S.quotes[S.symbol];
  $('#chartHead').innerHTML = `<b>${esc(S.symbol)}</b><span>${esc(watchNames()[S.symbol] || q?.name || '')}</span>${q?.ok ? `<span class="mono">${fmtPrice(q.price)}</span><span class="mono ${cls(q.change)}">${fmtPct(q.change)}</span>` : ''}`;
}

function drawPositionLines() {
  if (!candles) return;
  priceLines.forEach((l) => candles.removePriceLine(l));
  priceLines = [];
  const p = activePosition(S.symbol);
  if (!p) return;
  priceLines.push(candles.createPriceLine({ price: p.avg, color: '#2fd3ff', lineWidth: 1, lineStyle: 2, title: `${p.qty > 0 ? 'LONG' : 'SHORT'} ${Math.abs(p.qty)}` }));
  if (p.stop) priceLines.push(candles.createPriceLine({ price: p.stop, color: '#ff453a', lineWidth: 1, lineStyle: 1, title: 'STOP' }));
  if (p.target) priceLines.push(candles.createPriceLine({ price: p.target, color: '#30d158', lineWidth: 1, lineStyle: 1, title: 'TARGET' }));
}

// ================================================================ portfolio sheet
const isOpen = (id) => !$(`#${id}`).classList.contains('hidden');

function openPortfolio(tab = S.pfTab) {
  S.pfTab = tab;
  $('#portfolio').classList.remove('hidden');
  $('#chartSheet').classList.add('hidden');
  $('#btnPortfolio').classList.add('on');
  $('#btnChart').classList.remove('on');
  buildPortfolio();
}

function closeSheet(id) {
  $(`#${id}`).classList.add('hidden');
  $(id === 'portfolio' ? '#btnPortfolio' : '#btnChart').classList.remove('on');
}

function pfData() {
  if (S.pfTab === 'auto') return S.auto?.account ? { snap: S.auto.account, auto: true } : { snap: null, auto: true };
  return { snap: S.ledger, auto: false };
}

function buildPortfolio() {
  const el = $('#portfolio');
  const auto = S.pfTab === 'auto';
  const accounts = (S.ledger?.accounts || []).filter((a) => a.id !== S.auto?.accountId);
  el.innerHTML = `
    <div class="p-head">
      <h2>Portfolio</h2>
      ${!auto && accounts.length > 1 ? `<select id="pfAcct" style="width:160px">${accounts.map((a) => `<option value="${a.id}" ${a.id === S.ledger.active ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select>` : ''}
      <div class="seg sm" id="pfSeg"><button data-v="mine" class="${auto ? '' : 'on'}">My trades</button><button data-v="auto" class="${auto ? 'on' : ''}">Autopilot</button></div>
      <button class="icon-btn" data-close="portfolio" aria-label="Close portfolio">✕</button>
    </div>
    <div class="pf-body">
      <div class="kpis" id="pfKpis"></div>
      ${auto ? autoControls() : ''}
      <div class="pf-grid">
        <div class="box"><h4>Equity</h4><div class="eq-box"><div id="eqChart"></div></div></div>
        <div class="box"><h4>Exposure <span class="dim small" id="pfExpoTxt"></span></h4><div class="expo" id="pfExpo"></div><div class="alloc" id="pfAlloc"></div></div>
      </div>
      <div class="box">
        <h4><span>${auto ? 'What Autopilot holds' : 'Your positions'}</span>
          <div class="seg sm" id="pfListSeg"><button data-v="positions">Positions</button><button data-v="orders">Orders</button>${auto ? '<button data-v="log">Activity</button>' : ''}</div></h4>
        <div id="pfList"></div>
      </div>
      ${auto ? '' : mineControls()}
    </div>`;
  if (!auto && S.pfList === 'log') S.pfList = 'positions';
  $$('#pfListSeg button').forEach((b) => b.classList.toggle('on', b.dataset.v === S.pfList));

  if (eqChart) { eqChart.remove(); eqChart = null; }
  eqChart = LightweightCharts.createChart($('#eqChart'), { ...S.chartBase, rightPriceScale: { borderVisible: false }, timeScale: { borderVisible: false, timeVisible: true } });
  eqSeries = eqChart.addAreaSeries({ lineColor: '#2fd3ff', topColor: 'rgba(47,211,255,0.28)', bottomColor: 'rgba(47,211,255,0)', lineWidth: 2, priceLineVisible: false });

  wirePortfolio();
  updatePortfolio();
}

function autoControls() {
  const a = S.auto || {};
  const st = a.strategies || {};
  return `<div class="box" id="pfAuto">
    <h4><span>Autopilot <span class="badge" id="autoBadge"></span></span><span class="actions">
      <button class="btn tonal go" id="aToggle"></button>
      <button class="btn tonal danger" id="aFlat">Close all positions</button>
      <button class="btn tonal" id="aReset">Reset account</button></span></h4>
    <p class="strategy"><b>Event reaction</b> takes the textbook move in an event's linked markets. <b>Trend</b> goes long above the 20- and 50-day averages and short below both, checked hourly. Every trade has a stop and a target.</p>
    <div class="cfg" style="margin-top:10px">
      <label class="sw">Event reaction<button class="switch ${st.events ? 'on' : ''}" data-strat="events" role="switch" aria-checked="${!!st.events}"></button></label>
      <label class="sw">Trend<button class="switch ${st.trend ? 'on' : ''}" data-strat="trend" role="switch" aria-checked="${!!st.trend}"></button></label>
      <label>Risk per trade %<input type="number" data-k="riskPct" min="0.1" step="0.1" value="${a.riskPct ?? 0.5}"></label>
      <label>Stop %<input type="number" data-k="stopPct" min="0.5" step="0.5" value="${a.stopPct ?? 2.5}"></label>
      <label>Target %<input type="number" data-k="targetPct" min="0.5" step="0.5" value="${a.targetPct ?? 5}"></label>
      <label>Max hold (hours)<input type="number" data-k="maxHoldHrs" min="1" step="1" value="${a.maxHoldHrs ?? 72}"></label>
    </div>
    <p class="fine" style="margin-top:8px">Paper money only. Neither rule has a proven edge; the earlier backtests found none. Watch it for weeks before believing any number here.</p>
  </div>`;
}

function mineControls() {
  const r = S.ledger?.account.rules || {};
  return `<div class="box"><h4>Account</h4>
    <div class="cfg">
      <label>Fee per trade (bps)<input type="number" id="rFee" min="0" step="0.5" value="${r.feeBps ?? 5}"></label>
      <label>Max position % of equity<input type="number" id="rMax" min="0" step="1" value="${r.maxPositionPct ?? 25}"></label>
      <label>Stop trading after daily loss %<input type="number" id="rLoss" min="0" step="0.5" value="${r.dailyLossPct ?? 5}"></label>
    </div>
    <div class="actions" style="margin-top:12px">
      <button class="btn tonal" id="mNew">New account</button>
      <button class="btn tonal" id="mReset">Reset account</button>
      <button class="btn tonal" id="mCsv">Export orders (CSV)</button>
    </div></div>`;
}

function wirePortfolio() {
  const el = $('#portfolio');
  $('[data-close]', el).onclick = () => closeSheet('portfolio');
  $('#pfSeg').onclick = (ev) => { const b = ev.target.closest('button'); if (b) { S.pfTab = b.dataset.v; buildPortfolio(); } };
  $('#pfListSeg').onclick = (ev) => { const b = ev.target.closest('button'); if (!b) return; S.pfList = b.dataset.v; $$('#pfListSeg button').forEach((x) => x.classList.toggle('on', x === b)); updatePortfolio(); };
  if ($('#pfAcct')) $('#pfAcct').onchange = async (ev) => { onLedger(await api.ledger.switchAccount(ev.target.value)); buildPortfolio(); };
  if (S.pfTab === 'auto') {
    $('#aToggle').onclick = toggleAuto;
    $('#aFlat').onclick = async () => { if (await confirmModal('Close every Autopilot position?', 'Each position is closed at the latest delayed price.', 'Close all', 'danger')) onAuto(await api.autopilot.flatten()); };
    $('#aReset').onclick = async () => { if (await confirmModal('Reset the Autopilot account?', 'Positions, orders and history are cleared and cash goes back to $100,000.', 'Reset', 'danger')) { onAuto(await api.autopilot.reset()); buildPortfolio(); } };
    $$('#pfAuto [data-strat]').forEach((b) => (b.onclick = async () => {
      const on = !b.classList.contains('on');
      b.classList.toggle('on', on); b.setAttribute('aria-checked', on);
      onAuto(await api.autopilot.configure({ strategies: { [b.dataset.strat]: on } }));
    }));
    $$('#pfAuto [data-k]').forEach((i) => (i.onchange = async () => onAuto(await api.autopilot.configure({ [i.dataset.k]: +i.value }))));
  } else {
    const saveRules = async () => onLedger(await api.ledger.rules({ feeBps: +$('#rFee').value, maxPositionPct: +$('#rMax').value, dailyLossPct: +$('#rLoss').value }));
    ['#rFee', '#rMax', '#rLoss'].forEach((s) => ($(s).onchange = saveRules));
    $('#mNew').onclick = newAccountModal;
    $('#mReset').onclick = async () => { if (await confirmModal('Reset this account?', 'Positions, orders and history are cleared and cash returns to the starting balance.', 'Reset', 'danger')) { onLedger(await api.ledger.resetAccount()); buildPortfolio(); } };
    $('#mCsv').onclick = async () => { const f = await api.ledger.exportCsv(); toast(`Saved ${f.split(/[\\/]/).pop()} to Downloads`, 'ok'); };
  }
}

function updatePortfolio() {
  if (!isOpen('portfolio')) return;
  const { snap, auto } = pfData();
  if (auto) {
    const on = !!S.auto?.enabled;
    $('#autoBadge').textContent = on ? 'Running' : 'Off';
    $('#autoBadge').style.color = on ? 'var(--up)' : 'var(--text-3)';
    $('#aToggle').textContent = on ? 'Stop Autopilot' : 'Start Autopilot';
  }
  if (!snap) {
    $('#pfKpis').innerHTML = '<div class="empty" style="grid-column:1/-1">Autopilot has no account yet. Start it to create one with $100,000 of paper money.</div>';
    $('#pfList').innerHTML = ''; $('#pfAlloc').innerHTML = ''; $('#pfExpo').innerHTML = ''; eqSeries.setData([]);
    return;
  }
  const a = snap.account;
  const longV = a.positions.filter((p) => p.qty > 0).reduce((s, p) => s + p.value, 0);
  const shortV = a.positions.filter((p) => p.qty < 0).reduce((s, p) => s + Math.abs(p.value), 0);
  const closed = a.orders.filter((o) => o.realized);
  const wins = closed.filter((o) => o.realized > 0).length;
  const k = (label, value, c = '', hero = false) => `<div class="kpi ${hero ? 'hero' : ''}"><span>${label}</span><b class="${c}">${value}</b></div>`;
  $('#pfKpis').innerHTML = [
    k('Equity', fmtMoney(a.equityNow), '', true),
    k('Today', fmtMoney(a.dayPnl, true), cls(a.dayPnl)),
    k('All time', `${fmtPct(a.totalPnl / a.startCash)}`, cls(a.totalPnl)),
    k('Cash', fmtMoney(a.cash)),
    k('Long', fmtMoney(longV), longV ? 'up' : ''),
    k('Short', fmtMoney(shortV), shortV ? 'down' : ''),
    k('Win rate', closed.length ? `${Math.round((wins / closed.length) * 100)}% of ${closed.length}` : '—'),
  ].join('');

  const gross = longV + shortV;
  $('#pfExpo').innerHTML = gross ? `<div class="l" style="width:${(longV / gross) * 100}%"></div><div class="s" style="width:${(shortV / gross) * 100}%"></div>` : '';
  $('#pfExpoTxt').textContent = gross ? `${Math.round((gross / a.equityNow) * 100)}% of equity invested` : 'All cash';
  const maxV = Math.max(...a.positions.map((p) => Math.abs(p.value)), 1);
  $('#pfAlloc').innerHTML = a.positions.length
    ? [...a.positions].sort((x, y) => Math.abs(y.value) - Math.abs(x.value)).map((p) => `<div class="al"><b>${esc(p.symbol)}</b><div class="bar"><span style="width:${Math.min(100, (Math.abs(p.value) / a.equityNow / 0.25) * 100)}%;background:${p.qty > 0 ? 'var(--up)' : 'var(--down)'}"></span></div><em>${fmtPct(Math.abs(p.value) / a.equityNow, 1).replace(/^[+−]/, '')}</em></div>`).join('')
    : '<div class="dim small">No open positions.</div>';

  const pts = (snap.equityCurve || []).map((p) => ({ time: Math.floor(p.t / 1000) + tzShift, value: p.v }));
  const dedup = [];
  for (const p of pts) if (!dedup.length || p.time > dedup.at(-1).time) dedup.push(p);
  eqSeries.setData(dedup);
  eqChart.timeScale().fitContent();

  const list = $('#pfList');
  if (S.pfList === 'orders') {
    list.innerHTML = a.orders.length ? `<table><thead><tr><th>Time</th><th>Market</th><th>Side</th><th class="n">Qty</th><th class="n">Price</th><th class="n">Realized</th><th>Why</th></tr></thead><tbody>
      ${a.orders.slice(0, 120).map((o) => `<tr><td class="mono dim">${fmtTime(o.time)}</td><td class="mono">${esc(o.symbol)}</td><td class="${o.side === 'buy' ? 'up' : 'down'}">${o.side === 'buy' ? 'Buy' : 'Sell'}</td><td class="n">${o.qty}</td><td class="n">${fmtPrice(o.price)}</td><td class="n ${cls(o.realized)}">${o.realized ? fmtMoney(o.realized, true) : '—'}</td><td class="dim">${esc(o.reason)}</td></tr>`).join('')}</tbody></table>`
      : '<div class="empty">No orders yet.</div>';
  } else if (S.pfList === 'log') {
    const log = S.auto?.log || [];
    list.innerHTML = log.length ? `<div class="log">${log.slice(0, 150).map((l) => `<div><time>${new Date(l.t).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' })}</time><span class="ty ${l.type}">${l.type}</span><span>${esc(l.text)}</span></div>`).join('')}</div>` : '<div class="empty">Nothing yet.</div>';
  } else {
    list.innerHTML = a.positions.length ? `<table><thead><tr><th>Market</th><th>Side</th><th class="n">Qty</th><th class="n">Entry</th><th class="n">Last</th><th class="n">P&amp;L</th><th class="n">Stop</th><th class="n">Target</th>${auto ? '<th>Rule</th>' : ''}<th></th></tr></thead><tbody>
      ${a.positions.map((p) => `<tr><td class="mono">${esc(p.symbol)}</td><td><span class="dir ${p.qty > 0 ? 'l' : 's'}">${p.qty > 0 ? 'LONG' : 'SHORT'}</span></td><td class="n">${Math.abs(p.qty)}</td><td class="n">${fmtPrice(p.avg)}</td><td class="n">${fmtPrice(p.price)}</td>
        <td class="n ${cls(p.pnl)}">${fmtMoney(p.pnl, true)} <span class="dim">${fmtPct(p.pnlPct, 1)}</span></td><td class="n dim">${p.stop ? fmtPrice(p.stop) : '—'}</td><td class="n dim">${p.target ? fmtPrice(p.target) : '—'}</td>${auto ? `<td class="dim">${esc(p.owner || '')}</td>` : ''}
        <td style="text-align:right"><button class="link" data-close-pos="${esc(p.symbol)}">Close</button></td></tr>`).join('')}</tbody></table>`
      : `<div class="empty">${auto ? (S.auto?.enabled ? 'Watching. Autopilot opens trades on new high-severity events and on its hourly trend check.' : 'Autopilot is off.') : 'No positions. Pick a market on the right and press Long or Short.'}</div>`;
    $$('[data-close-pos]', list).forEach((b) => (b.onclick = () => closePos(b.dataset.closePos, auto)));
  }
}

// ================================================================ updater, modals, toasts
function onUpdater(u) {
  S.update = u;
  const pill = $('#updatePill');
  if (u.status === 'ready') { pill.textContent = `Restart to update to ${u.version}`; pill.classList.remove('hidden'); }
  else if (u.status === 'downloading') { pill.textContent = u.message; pill.classList.remove('hidden'); }
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

function confirmModal(title, bodyHtml, okLabel, tone = 'go') {
  return new Promise((resolve) => {
    const m = openModal(`<header><h2>${esc(title)}</h2></header><section>${bodyHtml.startsWith('<') ? bodyHtml : `<p>${bodyHtml}</p>`}</section>
      <footer><button class="btn tonal" id="mNo">Cancel</button><button class="btn tonal ${tone}" id="mYes">${esc(okLabel)}</button></footer>`);
    $('#mNo', m).onclick = () => { closeModal(); resolve(false); };
    $('#mYes', m).onclick = () => { closeModal(); resolve(true); };
    $('#mYes', m).focus();
  });
}

function newAccountModal() {
  const m = openModal(`<header><h2>New paper account</h2></header>
    <section><div class="r"><span>Name</span><input type="text" id="naName" value="Strategy test"></div>
    <div class="r"><span>Starting cash (USD)</span><input type="number" id="naCash" value="100000" min="100" step="1000"></div></section>
    <footer><button class="btn tonal" id="mNo">Cancel</button><button class="btn tonal go" id="mYes">Create account</button></footer>`);
  $('#mNo', m).onclick = closeModal;
  $('#mYes', m).onclick = async () => { onLedger(await api.ledger.createAccount($('#naName').value, +$('#naCash').value)); closeModal(); buildPortfolio(); toast('Account created', 'ok'); };
}

function settingsModal() {
  const st = S.settings;
  const m = openModal(`<header><img src="logo.svg" alt=""><h2>Settings</h2><span class="dim mono small">v${esc(S.info.version)}</span><button class="icon-btn" id="mX" aria-label="Close">✕</button></header>
    <section><h3>Alerts</h3>
      <div class="r"><span>Desktop alerts for major events</span><button class="switch ${st.notifications ? 'on' : ''}" id="sNotif" role="switch" aria-label="Desktop alerts"></button></div>
      <div class="r"><span>Alert at</span><select id="sSev"><option value="0.95">Critical only</option><option value="0.8">Critical</option><option value="0.6">High and above</option></select></div>
      <div class="r"><span>Hide earthquakes below magnitude</span><input type="number" id="sMag" min="2.5" max="7" step="0.5" value="${st.minQuakeMag}"></div>
    </section>
    <section><h3>Markets</h3>
      <div class="r"><span>Refresh prices every (seconds)</span><input type="number" id="sQuote" min="10" step="5" value="${st.quoteEverySec}"></div>
      <div class="r"><span>Add a market</span><span style="display:flex;gap:6px"><input type="text" id="sAddSym" placeholder="Ticker, e.g. XOM" style="width:130px"><select id="sAddGrp" style="width:120px">${st.watchlist.map((g, i) => `<option value="${i}">${esc(g.group)}</option>`).join('')}</select><button class="btn tonal" id="sAdd">Add</button></span></div>
      <div class="chips" id="sWl"></div>
    </section>
    <section><h3>Data</h3>
      <table><tbody>${Object.values(S.status).map((f) => `<tr><td>${esc(f.label)}</td><td class="${f.ok ? 'up' : f.ok === false ? 'down' : ''}">${f.ok ? 'Live' : f.ok === false ? 'Error' : '…'}</td><td class="n">${f.count ?? 0}</td><td class="dim">${f.ok ? `${timeAgo(f.lastOk)} ago` : esc(f.error || '')}</td></tr>`).join('')}</tbody></table>
      <p class="fine">USGS, NOAA, NASA EONET and GIBS, GDACS, public news RSS and Yahoo Finance delayed quotes. News is placed on the map from place names in the headline, so it can be wrong. Layout inspired by God's Eye View (MIT).</p>
    </section>
    <section><h3>Updates</h3><div class="r"><span id="updStatus">${esc(S.update?.message || 'Not checked yet')}</span><button class="btn tonal" id="sUpd">Check now</button></div>
      <p class="fine">Data folder: ${esc(S.info.dataDir)}</p></section>`);
  $('#sSev', m).value = String(st.notifyMinSeverity);
  $('#mX', m).onclick = closeModal;
  const save = async (patch) => { S.settings = await api.settings.set(patch); refreshEvents(); };
  $('#sNotif', m).onclick = (ev) => { ev.currentTarget.classList.toggle('on'); save({ notifications: ev.currentTarget.classList.contains('on') }); };
  $('#sSev', m).onchange = (ev) => save({ notifyMinSeverity: +ev.target.value });
  $('#sMag', m).onchange = (ev) => save({ minQuakeMag: +ev.target.value });
  $('#sQuote', m).onchange = (ev) => save({ quoteEverySec: Math.max(10, +ev.target.value) });
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
    } catch (e) { toast(`Couldn't find ${sym}`, 'err'); }
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
  $('#btnLook').onclick = () => { $('#lookTray').classList.toggle('hidden'); $('#btnLook').classList.toggle('on'); };
  $('#surfaceSeg').onclick = (ev) => { const b = ev.target.closest('button'); if (b) setSurface(b.dataset.v); };
  $('#filterSeg').onclick = (ev) => { const b = ev.target.closest('button'); if (b) setFilter(b.dataset.v); };
  $('#spinSwitch').onclick = () => setSpin(!$('#spinSwitch').classList.contains('on'));
  $('#btnHome').onclick = () => { selectEvent(null); if (S.view === 'globe') globe.home(); else map.home(); };
  $('#btnChart').onclick = () => {
    if (isOpen('chartSheet')) return closeSheet('chartSheet');
    closeSheet('portfolio');
    $('#chartSheet').classList.remove('hidden');
    $('#btnChart').classList.add('on');
    loadChart();
  };
  $('#btnPortfolio').onclick = () => (isOpen('portfolio') ? closeSheet('portfolio') : openPortfolio());
  $('#equityBtn').onclick = () => openPortfolio('mine');
  $('#btnAuto').onclick = toggleAuto;
  $('#btnSettings').onclick = settingsModal;
  $('#updatePill').onclick = () => { if (S.update?.status === 'ready') api.updater.install(); };
  $('[data-close="chartSheet"]').onclick = () => closeSheet('chartSheet');
  $('#rangeSeg').onclick = (ev) => { const b = ev.target.closest('button'); if (!b) return; S.range = b.dataset.v; $$('#rangeSeg button').forEach((x) => x.classList.toggle('on', x === b)); loadChart(); };
  $('#btnLong').onclick = () => placeOrder(1);
  $('#btnShort').onclick = () => placeOrder(-1);
  $('#tQty').oninput = renderTrade;
  $$('.qty .step').forEach((b) => (b.onclick = () => {
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
      if (!$('#lookTray').classList.contains('hidden')) { $('#lookTray').classList.add('hidden'); $('#btnLook').classList.remove('on'); return; }
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
