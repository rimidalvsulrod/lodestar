/* global LightweightCharts */
import { KINDS, $, $$, esc, fmtPrice, fmtMoney, fmtPct, cls, timeAgo, fmtTime, sevLabel, exposures, truncate } from './util.js';
import { GlobeView, tipHtml } from './globe-view.js';
import { MapView } from './map-view.js';

const api = window.lodestar;

const S = {
  settings: null,
  events: [],
  firstSeen: new Map(),
  bootAt: Date.now(),
  status: {},
  quotes: {},
  ledger: null,
  selEvent: null,
  symbol: 'CL=F',
  range: '1D',
  side: 'buy',
  view: 'globe',
  sort: 'time',
  search: '',
  dockTab: 'chart',
  satUrl: null,
  satDay: null,
};

// ================================================================ boot
let globe, map;
async function boot() {
  S.settings = await api.settings.get();
  const info = await api.info();
  S.info = info;

  globe = new GlobeView($('#globe'), { onSelect: (e) => selectEvent(e) });
  map = new MapView($('#map2d'), { onSelect: (e) => selectEvent(e), onHover: showMapTip });

  buildLegend();
  buildChips();
  wireUi();
  initCharts();
  setRotate(S.settings.autoRotate);
  setStyle(S.settings.globeStyle || 'night');

  api.feeds.onEvents(onEvents);
  api.feeds.onStatus(onStatus);
  api.feeds.onFocus((id) => { const e = S.events.find((x) => x.id === id); if (e) selectEvent(e); });
  api.markets.onQuotes(onQuotes);
  api.ledger.onState(onLedger);
  api.updater.onStatus(onUpdater);

  const snap = await api.feeds.snapshot();
  onStatus(snap.status);
  if (snap.events.length) onEvents(snap.events);
  onQuotes(await api.markets.quotes());
  onLedger(await api.ledger.state());
  loadChart();

  setInterval(tickClock, 1000);
  tickClock();
  setInterval(() => renderEvents(), 30000); // refresh "x min ago"
}

// ================================================================ events
function onEvents(list) {
  // anything that arrives during the first 90 s is the backlog, not "new"
  const warmup = Date.now() - S.bootAt < 90e3;
  for (const e of list) if (!S.firstSeen.has(e.id)) S.firstSeen.set(e.id, warmup ? 0 : Date.now());
  S.events = list;
  if (S.selEvent) S.selEvent = list.find((e) => e.id === S.selEvent.id) || S.selEvent;
  refreshEvents();
  $('#stageLoading').classList.add('done');
}

function filtered() {
  const L = S.settings.layers;
  const q = S.search.trim().toLowerCase();
  const minMag = S.settings.minQuakeMag ?? 0;
  return S.events.filter((e) => {
    if (!L[e.kind]) return false;
    if (e.kind === 'quake' && (e.meta?.mag ?? 0) < minMag) return false;
    if (q && !`${e.title} ${e.place} ${e.source} ${e.summary}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

function refreshEvents() {
  const list = filtered();
  globe.setEvents(list);
  map.setEvents(list);
  renderEvents(list);
  renderStats();
  buildChips();
}

function renderEvents(list = filtered()) {
  const sorted = [...list].sort((a, b) => (S.sort === 'severity' ? b.severity - a.severity || b.time - a.time : b.time - a.time));
  $('#eventCount').textContent = `${list.length} on map`;
  const el = $('#eventList');
  if (!sorted.length) {
    el.innerHTML = `<div class="empty">${S.events.length ? 'No events match these filters.' : 'Waiting for feeds…'}</div>`;
    return;
  }
  const now = Date.now();
  el.innerHTML = sorted.slice(0, 400).map((e) => {
    const k = KINDS[e.kind];
    const fresh = S.firstSeen.get(e.id) > 0 && now - S.firstSeen.get(e.id) < 30 * 60e3;
    return `<div class="ev ${S.selEvent?.id === e.id ? 'sel' : ''}" data-id="${esc(e.id)}" style="--c:${k.color}">
      <div class="top"><span class="kind">${k.one}</span>${fresh ? '<span class="new">NEW</span>' : ''}<span>${esc(e.source)}</span><span class="time">${timeAgo(e.time)}</span></div>
      <div class="title">${esc(e.title)}</div>
      <div class="meta"><span class="sev"><span style="width:${Math.round(e.severity * 100)}%"></span></span><span>${esc(truncate(e.place || '', 48))}</span></div>
    </div>`;
  }).join('');
}

function renderStats() {
  const counts = {};
  for (const e of filtered()) counts[e.kind] = (counts[e.kind] || 0) + 1;
  const crit = S.events.filter((e) => e.severity >= 0.8).length;
  $('#stats').innerHTML = ['conflict', 'news', 'quake', 'storm', 'fire', 'volcano', 'flood']
    .map((k) => `<span class="stat"><i style="background:${KINDS[k].color}"></i>${KINDS[k].label}<b>${counts[k] || 0}</b></span>`).join('')
    + `<span class="stat" title="Events rated critical"><i style="background:#fff"></i>Critical<b>${crit}</b></span>`;
}

function buildChips() {
  const counts = {};
  for (const e of S.events) counts[e.kind] = (counts[e.kind] || 0) + 1;
  $('#layerChips').innerHTML = Object.entries(KINDS).map(([k, v]) =>
    `<button class="chip ${S.settings.layers[k] ? 'on' : ''}" data-k="${k}" style="color:${S.settings.layers[k] ? '' : ''}"><i style="background:${v.color};color:${v.color}"></i>${v.label}<b>${counts[k] || 0}</b></button>`).join('');
}

function buildLegend() {
  $('#legend').innerHTML = Object.entries(KINDS).map(([, v]) => `<span><i style="background:${v.color};color:${v.color}"></i>${v.label}</span>`).join('');
}

function onStatus(st) {
  S.status = st;
  $('#feedsHealth').innerHTML = Object.values(st).map((s) =>
    `<i class="${s.loading ? 'load' : s.ok ? 'ok' : s.ok === false ? 'err' : ''}" title="${esc(s.label)}: ${s.ok ? `${s.count} items, updated ${timeAgo(s.lastOk)} ago` : esc(s.error || 'loading')}"></i>`).join('');
}

// ================================================================ selection + detail
function selectEvent(e, fly = true) {
  S.selEvent = e;
  if (e) setRotate(false);
  globe.select(e, fly && S.view === 'globe');
  map.select(e);
  renderEvents();
  renderDetail();
}

function renderDetail() {
  const e = S.selEvent;
  const el = $('#detail');
  if (!e) { el.classList.add('hidden'); return; }
  const k = KINDS[e.kind];
  const [sl, sc] = sevLabel(e.severity);
  const ex = exposures(e);
  const meta = [];
  if (e.place) meta.push(['Place', e.place]);
  meta.push(['Time', `${fmtTime(e.time)} (${timeAgo(e.time)} ago)`]);
  meta.push(['Coordinates', `${e.lat.toFixed(2)}, ${e.lon.toFixed(2)}`]);
  if (e.meta?.mag) meta.push(['Magnitude', `M${e.meta.mag.toFixed(1)} · depth ${Math.round(e.meta.depth)} km${e.meta.tsunami ? ' · tsunami flag' : ''}`]);
  if (e.meta?.intensity) meta.push(['Winds', `${e.meta.intensity} kt · ${e.meta.pressure} mb`]);
  if (e.meta?.magnitude) meta.push(['Intensity', `${e.meta.magnitude} ${e.meta.unit || ''}`]);
  if (e.meta?.alert) meta.push(['Alert level', e.meta.alert]);
  meta.push(['Source', e.source]);

  el.style.setProperty('--c', k.color);
  el.innerHTML = `
    <div class="d-head"><span class="d-kind">${k.one}</span>
      <span class="d-sev" style="color:${sc};border-color:${sc}55">${sl}</span>
      <button class="d-close" id="dClose" title="Close (Esc)">×</button></div>
    <h3>${esc(e.title)}</h3>
    ${e.summary && e.summary !== e.title ? `<p class="d-sum">${esc(truncate(e.summary, 320))}</p>` : ''}
    <dl class="d-grid">${meta.map(([a, b]) => `<dt>${esc(a)}</dt><dd>${esc(b)}</dd>`).join('')}</dl>
    ${e.url ? `<div class="d-section" style="padding-top:0;border:0"><button class="link-btn" id="dOpen">Open source report ↗</button></div>` : ''}
    ${ex.length ? `<div class="d-section"><h4>Linked markets</h4><div class="exposures">${ex.map((x) => {
      const q = S.quotes[x.symbol];
      return `<div class="expo" data-sym="${esc(x.symbol)}"><b>${esc(x.symbol)}</b><span>${esc(x.why)}</span><em class="${cls(q?.change)}">${q?.ok ? fmtPct(q.change) : ''}</em></div>`;
    }).join('')}</div>
    <p class="fine">Markets commonly exposed to this kind of event. Descriptive context only — not a trading signal or a prediction.</p></div>` : ''}`;
  el.classList.remove('hidden');
  $('#dClose').onclick = () => selectEvent(null);
  if ($('#dOpen')) $('#dOpen').onclick = () => api.openExternal(e.url);
  $$('.expo', el).forEach((x) => (x.onclick = () => selectSymbol(x.dataset.sym)));
}

function showMapTip(e, ev) {
  const tip = $('#tooltip');
  if (!e) { tip.classList.add('hidden'); return; }
  const r = $('#stage').getBoundingClientRect();
  tip.innerHTML = tipHtml(e);
  tip.style.left = `${Math.min(ev.clientX - r.left + 14, r.width - 310)}px`;
  tip.style.top = `${ev.clientY - r.top + 14}px`;
  tip.classList.remove('hidden');
  tip.style.padding = '0'; tip.style.border = '0'; tip.style.background = 'transparent';
}

// ================================================================ globe / map controls
function setView(v) {
  S.view = v;
  $$('#viewSeg button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
  $('#globe').classList.toggle('hidden', v !== 'globe');
  $('#map2d').classList.toggle('hidden', v !== 'map');
  $('#styleSeg').classList.toggle('hidden', v !== 'globe');
  $('#btnRotate').classList.toggle('hidden', v !== 'globe');
  map.setVisible(v === 'map');
  if (v === 'globe') { globe.resume(); globe.resize(); } else globe.pause();
  $('#tooltip').classList.add('hidden');
  if (S.selEvent) map.select(S.selEvent);
}

async function setStyle(style) {
  $$('#styleSeg button').forEach((b) => b.classList.toggle('on', b.dataset.v === style));
  if (style === 'satellite' && !S.satUrl) {
    toast('Loading yesterday’s NASA satellite mosaic…', 'info');
    try {
      const s = await api.feeds.satellite();
      S.satUrl = s.url; S.satDay = s.day;
    } catch (e) {
      toast(`Satellite imagery unavailable: ${e.message}`, 'err');
    }
  }
  globe.setStyle(style, S.satUrl);
  const note = $('#satNote');
  note.classList.toggle('hidden', style !== 'satellite' || !S.satDay);
  note.textContent = `NASA VIIRS true-colour · ${S.satDay}`;
  if (S.settings.globeStyle !== style) S.settings = await api.settings.set({ globeStyle: style });
}

function setRotate(on) {
  globe.setRotate(on);
  $('#btnRotate').classList.toggle('on', on);
}

// ================================================================ markets
function allSymbols() { return S.settings.watchlist.flatMap((g) => g.symbols.map(([s, n]) => ({ s, n, g: g.group }))); }

function renderWatchlist() {
  const el = $('#watchlist');
  el.innerHTML = S.settings.watchlist.map((g) => `
    <div class="wl-group"><h4>${esc(g.group)}</h4>
      ${g.symbols.map(([s, n]) => `<div class="wl-row ${S.symbol === s ? 'sel' : ''}" data-sym="${esc(s)}">
        <div><div class="sym">${esc(s)}</div><div class="nm">${esc(n)}</div></div>
        <canvas width="128" height="44"></canvas><div class="px">—</div><div class="ch">—</div></div>`).join('')}
    </div>`).join('');
  $$('.wl-row', el).forEach((r) => (r.onclick = () => selectSymbol(r.dataset.sym)));
  updateWatchlist({});
}

function updateWatchlist(prev) {
  for (const row of $$('.wl-row')) {
    const q = S.quotes[row.dataset.sym];
    if (!q) continue;
    if (!q.ok) { $('.px', row).textContent = 'n/a'; $('.px', row).title = q.error; continue; }
    $('.px', row).textContent = fmtPrice(q.price);
    const ch = $('.ch', row);
    ch.textContent = fmtPct(q.change);
    ch.className = `ch ${cls(q.change)}`;
    const p = prev[row.dataset.sym];
    if (p?.ok && p.price !== q.price) {
      row.classList.remove('flash-up', 'flash-down');
      void row.offsetWidth;
      row.classList.add(q.price > p.price ? 'flash-up' : 'flash-down');
    }
    spark($('canvas', row), q.spark, q.prevClose);
  }
}

function spark(cv, data, base) {
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, cv.width, cv.height);
  if (!data || data.length < 2) return;
  const min = Math.min(...data, base ?? Infinity), max = Math.max(...data, base ?? -Infinity);
  const W = cv.width, H = cv.height, pad = 4;
  const y = (v) => H - pad - ((v - min) / (max - min || 1)) * (H - pad * 2);
  const up = data.at(-1) >= (base ?? data[0]);
  const col = up ? '#2ee59d' : '#ff5a6a';
  if (base != null) {
    ctx.setLineDash([3, 3]); ctx.strokeStyle = '#33415580'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, y(base)); ctx.lineTo(W, y(base)); ctx.stroke(); ctx.setLineDash([]);
  }
  ctx.beginPath();
  data.forEach((v, i) => { const x = (i / (data.length - 1)) * W; i ? ctx.lineTo(x, y(v)) : ctx.moveTo(x, y(v)); });
  ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke();
  ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath();
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, `${col}40`); g.addColorStop(1, `${col}00`);
  ctx.fillStyle = g; ctx.fill();
}

function onQuotes(q) {
  const prev = S.quotes;
  S.quotes = { ...S.quotes, ...q };
  if (!$('.wl-row')) renderWatchlist(); else updateWatchlist(prev);
  renderChartHead();
  renderTicketEst();
  if (S.selEvent) {
    for (const x of $$('#detail .expo')) {
      const qq = S.quotes[x.dataset.sym];
      if (qq?.ok) { $('em', x).textContent = fmtPct(qq.change); $('em', x).className = cls(qq.change); }
    }
  }
}

function selectSymbol(sym) {
  S.symbol = sym;
  $('#tSymbol').value = sym;
  $$('.wl-row').forEach((r) => r.classList.toggle('sel', r.dataset.sym === sym));
  setDockTab('chart');
  loadChart();
  renderTicketEst();
}

// ================================================================ charts
let chart, candleSeries, volSeries, eqChart, eqSeries, priceLines = [];
const tzShift = -new Date().getTimezoneOffset() * 60;

function initCharts() {
  const base = {
    autoSize: true,
    layout: { background: { type: 'solid', color: 'transparent' }, textColor: '#7c8ba1', fontFamily: 'Cascadia Mono, Consolas, monospace', fontSize: 11 },
    grid: { vertLines: { color: '#0f1620' }, horzLines: { color: '#0f1620' } },
    rightPriceScale: { borderColor: '#19222f' },
    timeScale: { borderColor: '#19222f', timeVisible: true, secondsVisible: false },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal, vertLine: { color: '#4fd8ff55', labelBackgroundColor: '#13202f' }, horzLine: { color: '#4fd8ff55', labelBackgroundColor: '#13202f' } },
  };
  chart = LightweightCharts.createChart($('#chart'), base);
  candleSeries = chart.addCandlestickSeries({ upColor: '#2ee59d', downColor: '#ff5a6a', borderVisible: false, wickUpColor: '#2ee59d99', wickDownColor: '#ff5a6a99' });
  volSeries = chart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: 'vol', color: '#24324a' });
  chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

  eqChart = LightweightCharts.createChart($('#equityChart'), base);
  eqSeries = eqChart.addAreaSeries({ lineColor: '#4fd8ff', topColor: '#4fd8ff40', bottomColor: '#4fd8ff00', lineWidth: 2 });
}

let chartReq = 0;
async function loadChart() {
  const req = ++chartReq;
  renderChartHead();
  try {
    const c = await api.markets.chart(S.symbol, S.range);
    if (req !== chartReq) return;
    const shift = ['1D', '5D', '1M'].includes(S.range) ? tzShift : 0;
    candleSeries.setData(c.candles.map((x) => ({ time: x.time + shift, open: x.open, high: x.high, low: x.low, close: x.close })));
    volSeries.setData(c.candles.map((x) => ({ time: x.time + shift, value: x.volume, color: x.close >= x.open ? '#2ee59d33' : '#ff5a6a33' })));
    chart.timeScale().fitContent();
    S.chartName = c.name;
    renderChartHead();
    drawPositionLines();
  } catch (e) {
    if (req === chartReq) toast(`Chart failed for ${S.symbol}: ${e.message}`, 'err');
  }
}

function renderChartHead() {
  const q = S.quotes[S.symbol];
  const name = S.chartName && S.chartName !== S.symbol ? S.chartName : allSymbols().find((x) => x.s === S.symbol)?.n || '';
  $('#chartHead').innerHTML = `<b>${esc(S.symbol)}</b><span class="nm">${esc(name)}</span>${q?.ok ? `<span class="px">${fmtPrice(q.price)}</span><span class="${cls(q.change)} mono">${fmtPct(q.change)}</span>` : ''}`;
}

function drawPositionLines() {
  priceLines.forEach((l) => candleSeries.removePriceLine(l));
  priceLines = [];
  const p = S.ledger?.account.positions.find((x) => x.symbol === S.symbol);
  if (!p) return;
  priceLines.push(candleSeries.createPriceLine({ price: p.avg, color: '#a7b6ff', lineWidth: 1, lineStyle: 2, title: `AVG ${p.qty > 0 ? 'LONG' : 'SHORT'} ${Math.abs(p.qty)}` }));
  if (p.stop) priceLines.push(candleSeries.createPriceLine({ price: p.stop, color: '#ff5a6a', lineWidth: 1, lineStyle: 1, title: 'STOP' }));
  if (p.target) priceLines.push(candleSeries.createPriceLine({ price: p.target, color: '#2ee59d', lineWidth: 1, lineStyle: 1, title: 'TARGET' }));
}

function setDockTab(v) {
  S.dockTab = v;
  $$('#dockTabs button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
  $$('.dock-pane').forEach((p) => p.classList.toggle('hidden', p.dataset.pane !== v));
  $('#rangeSeg').classList.toggle('hidden', v !== 'chart');
  $('#chartHead').style.visibility = v === 'chart' ? '' : 'hidden';
  if (v === 'equity') renderEquity();
}

// ================================================================ ledger
function onLedger(st) {
  S.ledger = st;
  renderAccount();
  renderPositions();
  renderOrders();
  renderTicketEst();
  drawPositionLines();
  if (S.dockTab === 'equity') renderEquity();
}

function renderAccount() {
  const { account: a, accounts } = S.ledger;
  const ret = a.totalPnl / a.startCash;
  $('#equityMini').innerHTML = `<span>${fmtMoney(a.equityNow)}</span><small class="${cls(a.dayPnl)}">${fmtMoney(a.dayPnl, true)} today</small>`;
  $('#account').innerHTML = `
    <div class="acct-head"><h3>Paper account</h3>
      <select id="acctSel">${accounts.map((x) => `<option value="${x.id}" ${x.id === a.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>
    <div class="acct-eq">${fmtMoney(a.equityNow)}</div>
    <div class="acct-grid">
      <div><span>Today</span><b class="${cls(a.dayPnl)}">${fmtMoney(a.dayPnl, true)}</b></div>
      <div><span>All time</span><b class="${cls(a.totalPnl)}">${fmtMoney(a.totalPnl, true)} (${fmtPct(ret)})</b></div>
      <div><span>Cash</span><b>${fmtMoney(a.cash)}</b></div>
      <div><span>Realized · fees</span><b>${fmtMoney(a.realized, true)} · ${fmtMoney(a.fees)}</b></div>
    </div>
    <div class="acct-actions">
      <button class="ghost small" id="acctNew">New account</button>
      <button class="ghost small" id="acctReset">Reset</button>
      <button class="ghost small" id="acctCsv">Export CSV</button>
      ${accounts.length > 1 ? '<button class="ghost small danger" id="acctDel">Delete</button>' : ''}
    </div>
    <div class="rules">
      <label>Fee (bps)<input id="rFee" type="number" min="0" step="0.5" value="${a.rules.feeBps}"></label>
      <label>Max position %<input id="rMax" type="number" min="0" step="1" value="${a.rules.maxPositionPct}"></label>
      <label>Daily loss stop %<input id="rLoss" type="number" min="0" step="0.5" value="${a.rules.dailyLossPct}"></label>
    </div>
    <p class="fine">Risk rules block new orders that break them. Set a value to 0 to turn a rule off.</p>`;
  $('#acctSel').onchange = async (ev) => onLedger(await api.ledger.switchAccount(ev.target.value));
  $('#acctNew').onclick = newAccountModal;
  $('#acctReset').onclick = async () => {
    if (!(await confirmModal('Reset this paper account?', 'Positions, orders and the equity history for this account are cleared and cash returns to the starting balance.', 'Reset account'))) return;
    onLedger(await api.ledger.resetAccount());
    toast('Account reset', 'ok');
  };
  $('#acctCsv').onclick = async () => { const f = await api.ledger.exportCsv(); toast(`Saved ${f.split(/[\\/]/).pop()} to Downloads`, 'ok'); };
  if ($('#acctDel')) $('#acctDel').onclick = async () => {
    if (!(await confirmModal(`Delete “${a.name}”?`, 'This removes the account and its history from this PC. It cannot be undone.', 'Delete account'))) return;
    onLedger(await api.ledger.deleteAccount(a.id));
  };
  const saveRules = async () => onLedger(await api.ledger.rules({ feeBps: +$('#rFee').value, maxPositionPct: +$('#rMax').value, dailyLossPct: +$('#rLoss').value }));
  ['#rFee', '#rMax', '#rLoss'].forEach((s) => ($(s).onchange = saveRules));
}

function renderPositions() {
  const ps = S.ledger.account.positions;
  $('#posCount').textContent = ps.length;
  if (!ps.length) { $('#positionsTable').innerHTML = '<div class="empty">No open positions. Pick a market on the right and place a paper order.</div>'; return; }
  $('#positionsTable').innerHTML = `<table><thead><tr><th>Symbol</th><th>Side</th><th class="num">Qty</th><th class="num">Avg</th><th class="num">Last</th><th class="num">Value</th><th class="num">P&amp;L</th><th class="num">P&amp;L %</th><th>Stop</th><th>Target</th><th></th></tr></thead><tbody>
    ${ps.map((p) => `<tr data-sym="${esc(p.symbol)}">
      <td><button class="link-btn mono" data-act="chart">${esc(p.symbol)}</button></td>
      <td class="${p.qty > 0 ? 'up' : 'down'}">${p.qty > 0 ? 'Long' : 'Short'}</td>
      <td class="num">${Math.abs(p.qty)}</td><td class="num">${fmtPrice(p.avg)}</td><td class="num">${fmtPrice(p.price)}</td>
      <td class="num">${fmtMoney(p.value)}</td><td class="num ${cls(p.pnl)}">${fmtMoney(p.pnl, true)}</td><td class="num ${cls(p.pnlPct)}">${fmtPct(p.pnlPct)}</td>
      <td><input data-f="stop" type="number" step="any" value="${p.stop ?? ''}" placeholder="—"></td>
      <td><input data-f="target" type="number" step="any" value="${p.target ?? ''}" placeholder="—"></td>
      <td><button class="ghost small" data-act="save">Save</button> <button class="ghost small danger" data-act="close">Close</button></td></tr>`).join('')}
  </tbody></table>`;
  $$('#positionsTable tr[data-sym]').forEach((tr) => {
    const sym = tr.dataset.sym;
    tr.querySelector('[data-act=chart]').onclick = () => selectSymbol(sym);
    tr.querySelector('[data-act=save]').onclick = async () => {
      try {
        onLedger(await api.ledger.bracket(sym, +tr.querySelector('[data-f=stop]').value || null, +tr.querySelector('[data-f=target]').value || null));
        toast(`Stop/target saved for ${sym}`, 'ok');
      } catch (e) { toast(e.message, 'err'); }
    };
    tr.querySelector('[data-act=close]').onclick = async () => {
      try { onLedger(await api.ledger.close(sym)); toast(`Closed ${sym}`, 'ok'); } catch (e) { toast(e.message, 'err'); }
    };
  });
}

function renderOrders() {
  const os = S.ledger.account.orders;
  if (!os.length) { $('#ordersTable').innerHTML = '<div class="empty">No orders yet.</div>'; return; }
  $('#ordersTable').innerHTML = `<table><thead><tr><th>Time</th><th>Symbol</th><th>Side</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Fee</th><th class="num">Realized</th><th>Reason</th></tr></thead><tbody>
    ${os.map((o) => `<tr><td class="mono">${fmtTime(o.time)}</td><td class="mono">${esc(o.symbol)}</td><td class="${o.side === 'buy' ? 'up' : 'down'}">${o.side.toUpperCase()}</td>
      <td class="num">${o.qty}</td><td class="num">${fmtPrice(o.price)}</td><td class="num">${fmtMoney(o.fee)}</td><td class="num ${cls(o.realized)}">${o.realized ? fmtMoney(o.realized, true) : '—'}</td><td>${esc(o.reason)}</td></tr>`).join('')}
  </tbody></table>`;
}

function renderEquity() {
  const pts = (S.ledger?.equityCurve || []).map((p) => ({ time: Math.floor(p.t / 1000) + tzShift, value: p.v }));
  const dedup = [];
  for (const p of pts) if (!dedup.length || p.time > dedup.at(-1).time) dedup.push(p);
  eqSeries.setData(dedup);
  eqChart.timeScale().fitContent();
}

// ================================================================ ticket
function renderTicketEst() {
  if (!S.ledger) return;
  const sym = $('#tSymbol').value.trim().toUpperCase();
  const qty = +$('#tQty').value || 0;
  const q = S.quotes[sym];
  const px = q?.ok ? q.price : null;
  const fee = px ? Math.abs(qty * px) * S.ledger.account.rules.feeBps / 1e4 : null;
  const pos = S.ledger.account.positions.find((p) => p.symbol === sym);
  $('#tEst').innerHTML = `
    <span>Last price</span><b>${px ? fmtPrice(px) : 'fetch on submit'}</b>
    <span>Notional</span><b>${px ? fmtMoney(qty * px) : '—'}</b>
    <span>Est. fee</span><b>${fee != null ? fmtMoney(fee) : '—'}</b>
    <span>Current position</span><b>${pos ? `${pos.qty > 0 ? 'Long' : 'Short'} ${Math.abs(pos.qty)}` : 'None'}</b>`;
  const btn = $('#tSubmit');
  btn.textContent = `Place paper ${S.side} · ${qty || 0} ${sym || ''}`;
  btn.classList.toggle('sell', S.side === 'sell');
}

async function submitOrder() {
  const symbol = $('#tSymbol').value.trim().toUpperCase();
  const qty = +$('#tQty').value;
  const stop = $('#tStop').value ? +$('#tStop').value : undefined;
  const target = $('#tTarget').value ? +$('#tTarget').value : undefined;
  const btn = $('#tSubmit');
  btn.disabled = true;
  try {
    const { order, state } = await api.ledger.order({ symbol, side: S.side, qty, stop, target });
    onLedger(state);
    toast(`${order.side.toUpperCase()} ${order.qty} ${order.symbol} filled at ${fmtPrice(order.price)} (paper)`, 'ok');
    $('#tStop').value = ''; $('#tTarget').value = '';
    if (symbol !== S.symbol) selectSymbol(symbol);
  } catch (e) {
    toast(e.message, 'err');
  }
  btn.disabled = false;
}

// ================================================================ updater
function onUpdater(u) {
  const pill = $('#updatePill');
  S.update = u;
  if (u.status === 'ready') {
    pill.textContent = `Restart to update to v${u.version}`;
    pill.className = 'update-pill ready';
  } else if (u.status === 'downloading') {
    pill.textContent = u.message;
    pill.className = 'update-pill';
  } else {
    pill.className = 'update-pill hidden';
  }
  const s = $('#updStatus');
  if (s) s.textContent = u.message || '';
}

// ================================================================ modals + toasts
function toast(msg, type = 'info', ms = 4200) {
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 320); }, ms);
}

function openModal(html) {
  $('#modal').innerHTML = html;
  $('#modalBack').classList.remove('hidden');
  return $('#modal');
}
function closeModal() { $('#modalBack').classList.add('hidden'); $('#modal').innerHTML = ''; }

function confirmModal(title, body, okLabel) {
  return new Promise((resolve) => {
    const m = openModal(`<header><h2>${esc(title)}</h2></header><section><p style="margin:0;color:var(--text-2)">${esc(body)}</p></section>
      <footer><button class="ghost" id="mNo">Cancel</button><button class="ghost danger" id="mYes">${esc(okLabel)}</button></footer>`);
    $('#mNo', m).onclick = () => { closeModal(); resolve(false); };
    $('#mYes', m).onclick = () => { closeModal(); resolve(true); };
  });
}

function newAccountModal() {
  const m = openModal(`<header><h2>New paper account</h2><button class="ghost small x" id="mX">Close</button></header>
    <section><div class="row"><span>Name</span><input type="text" id="naName" value="Strategy test"></div>
    <div class="row"><span>Starting cash (USD)</span><input type="number" id="naCash" value="100000" min="100" step="1000"></div></section>
    <footer><button class="ghost" id="mNo">Cancel</button><button class="ghost toggle on" id="mYes">Create</button></footer>`);
  $('#mX', m).onclick = $('#mNo', m).onclick = closeModal;
  $('#mYes', m).onclick = async () => {
    onLedger(await api.ledger.createAccount($('#naName').value, +$('#naCash').value));
    closeModal();
    toast('Paper account created', 'ok');
  };
}

function settingsModal() {
  const st = S.settings;
  const m = openModal(`<header><img src="logo.svg" alt=""><h2>Lodestar settings</h2><span class="muted">v${esc(S.info.version)}</span><button class="ghost small x" id="mX">Close</button></header>
    <section><h3>Alerts</h3>
      <div class="row"><span>Desktop notifications for major events</span><button class="switch ${st.notifications ? 'on' : ''}" id="sNotif"></button></div>
      <div class="row"><span>Notify at severity</span><select id="sSev"><option value="0.95">Critical only</option><option value="0.8">Critical</option><option value="0.6">High and above</option></select></div>
      <div class="row"><span>Hide earthquakes below magnitude</span><input type="number" id="sMag" min="2.5" max="7" step="0.5" value="${st.minQuakeMag}"></div>
    </section>
    <section><h3>Markets</h3>
      <div class="row"><span>Quote refresh (seconds)</span><input type="number" id="sQuote" min="10" step="5" value="${st.quoteEverySec}"></div>
      <div class="row"><span>Add symbol to watchlist</span><span style="display:flex;gap:6px"><input type="text" id="sAddSym" placeholder="e.g. XOM" style="width:110px"><select id="sAddGrp">${st.watchlist.map((g, i) => `<option value="${i}">${esc(g.group)}</option>`).join('')}</select><button class="ghost small" id="sAdd">Add</button></span></div>
      <div class="wl-edit" id="sWl"></div>
    </section>
    <section><h3>Data feeds</h3><table class="feed-table"><tbody>${Object.values(S.status).map((f) => `<tr><td>${esc(f.label)}</td><td class="${f.ok ? 'up' : f.ok === false ? 'down' : ''}">${f.ok ? 'OK' : f.ok === false ? 'Error' : '…'}</td><td class="num">${f.count ?? 0}</td><td class="muted">${f.ok ? `updated ${timeAgo(f.lastOk)} ago` : esc(f.error || '')}</td></tr>`).join('')}</tbody></table>
      <p class="fine">Sources: USGS, NOAA NHC, NASA EONET, GDACS, NASA GIBS imagery, public news RSS (BBC, Al Jazeera, Guardian, NYT, DW, France 24, NPR, UN News, OilPrice) and Yahoo Finance delayed quotes. News locations are matched from headline text and can be wrong.</p></section>
    <section><h3>Updates</h3><div class="row"><span id="updStatus">${esc(S.update?.message || 'Not checked yet')}</span><button class="ghost small" id="sUpd">Check now</button></div>
      <p class="fine">Data folder: ${esc(S.info.dataDir)}</p></section>`);
  $('#sSev', m).value = String(st.notifyMinSeverity);
  $('#mX', m).onclick = closeModal;
  const save = async (patch) => { S.settings = await api.settings.set(patch); refreshEvents(); };
  $('#sNotif', m).onclick = (ev) => { ev.target.classList.toggle('on'); save({ notifications: ev.target.classList.contains('on') }); };
  $('#sSev', m).onchange = (ev) => save({ notifyMinSeverity: +ev.target.value });
  $('#sMag', m).onchange = (ev) => save({ minQuakeMag: +ev.target.value });
  $('#sQuote', m).onchange = (ev) => save({ quoteEverySec: Math.max(10, +ev.target.value) });
  $('#sUpd', m).onclick = async () => { $('#updStatus').textContent = 'Checking…'; onUpdater(await api.updater.check()); };
  const drawWl = () => {
    $('#sWl', m).innerHTML = S.settings.watchlist.flatMap((g, gi) => g.symbols.map(([s], si) => `<span class="wl-tag">${esc(s)}<button data-g="${gi}" data-s="${si}" title="Remove">×</button></span>`)).join('');
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
    } catch (e) { toast(`Could not find ${sym}: ${e.message}`, 'err'); }
  };
}

// ================================================================ wiring
function wireUi() {
  $('#eventList').addEventListener('click', (ev) => {
    const row = ev.target.closest('.ev');
    if (row) { const e = S.events.find((x) => x.id === row.dataset.id); if (e) selectEvent(e); }
  });
  $('#layerChips').addEventListener('click', async (ev) => {
    const b = ev.target.closest('.chip');
    if (!b) return;
    S.settings = await api.settings.set({ layers: { [b.dataset.k]: !S.settings.layers[b.dataset.k] } });
    refreshEvents();
  });
  $('#eventSearch').addEventListener('input', (ev) => { S.search = ev.target.value; refreshEvents(); });
  $('#sortSeg').onclick = (ev) => { const b = ev.target.closest('button'); if (!b) return; S.sort = b.dataset.v; $$('#sortSeg button').forEach((x) => x.classList.toggle('on', x === b)); renderEvents(); };
  $('#viewSeg').onclick = (ev) => { const b = ev.target.closest('button'); if (b) setView(b.dataset.v); };
  $('#styleSeg').onclick = (ev) => { const b = ev.target.closest('button'); if (b) setStyle(b.dataset.v); };
  $('#btnRotate').onclick = async () => {
    const on = !$('#btnRotate').classList.contains('on');
    setRotate(on);
    S.settings = await api.settings.set({ autoRotate: on });
  };
  $('#btnHome').onclick = () => { selectEvent(null); if (S.view === 'globe') globe.home(); else map.home(); };
  $('#btnRefreshFeeds').onclick = () => { api.feeds.refresh(); toast('Refreshing all feeds…', 'info', 2000); };
  $('#btnSettings').onclick = settingsModal;
  $('#updatePill').onclick = () => { if (S.update?.status === 'ready') api.updater.install(); };
  $('#dockTabs').onclick = (ev) => { const b = ev.target.closest('button'); if (b) setDockTab(b.dataset.v); };
  $('#rangeSeg').onclick = (ev) => { const b = ev.target.closest('button'); if (!b) return; S.range = b.dataset.v; $$('#rangeSeg button').forEach((x) => x.classList.toggle('on', x === b)); loadChart(); };
  $('#sideSeg').onclick = (ev) => { const b = ev.target.closest('button'); if (!b) return; S.side = b.dataset.v; $$('#sideSeg button').forEach((x) => x.classList.toggle('on', x === b)); renderTicketEst(); };
  $('#tQty').oninput = renderTicketEst;
  $('#tSymbol').oninput = renderTicketEst;
  $('#tSymbol').onkeydown = (ev) => { if (ev.key === 'Enter') selectSymbol(ev.target.value.trim().toUpperCase()); };
  $('#tSubmit').onclick = submitOrder;
  $('#modalBack').onclick = (ev) => { if (ev.target.id === 'modalBack') closeModal(); };
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') { if (!$('#modalBack').classList.contains('hidden')) closeModal(); else selectEvent(null); }
    if (ev.target.matches('input, select, textarea')) return;
    if (ev.key === '/') { ev.preventDefault(); $('#eventSearch').focus(); }
    if (ev.key.toLowerCase() === 'g') setView(S.view === 'globe' ? 'map' : 'globe');
  });
}

function tickClock() {
  const d = new Date();
  $('#clockUtc').textContent = `${d.toISOString().slice(11, 19)} UTC`;
  $('#clockLocal').textContent = d.toLocaleTimeString('en-US', { hour12: false });
}

boot().catch((e) => { console.error(e); toast(`Startup error: ${e.message}`, 'err', 10000); });
