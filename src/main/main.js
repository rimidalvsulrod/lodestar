const { app, BrowserWindow, ipcMain, shell, Notification, nativeTheme, Menu, Tray, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const log = require('electron-log/main');
const { SOURCES, regionFor, satelliteImage } = require('./feeds');
const markets = require('./markets');
const { Ledger } = require('./ledger');
const updater = require('./updater');
const { Autopilot } = require('./autopilot');
const { QuoteStream } = require('./stream');

log.initialize();
log.transports.file.level = 'info';
process.on('uncaughtException', (e) => log.error('uncaught', e));
process.on('unhandledRejection', (e) => log.error('unhandled', e));

// Dev/test runs can use their own data folder so they never touch the installed app's data.
if (process.env.LODESTAR_DATA) app.setPath('userData', process.env.LODESTAR_DATA);
app.setAppUserModelId('com.lodestar.terminal');
if (!app.requestSingleInstanceLock()) app.quit();

const DATA = app.getPath('userData');
const SETTINGS_FILE = path.join(DATA, 'settings.json');
const DEFAULT_SETTINGS = {
  globeStyle: 'night', autoRotate: true, notifications: true, notifyMinSeverity: 0.8,
  layers: { conflict: true, news: true, quake: true, storm: true, fire: true, volcano: true, flood: true, weather: true },
  watchlist: markets.DEFAULT_WATCHLIST, quoteEverySec: 60, minQuakeMag: 3.5, view: 'map', fx: { arcs: true, hex: false, labels: true },
};

let win;
let settings = readJson(SETTINGS_FILE, DEFAULT_SETTINGS);
settings = { ...DEFAULT_SETTINGS, ...settings, layers: { ...DEFAULT_SETTINGS.layers, ...(settings.layers || {}) }, fx: { ...DEFAULT_SETTINGS.fx, ...(settings.fx || {}) } };
let ledger;
let autopilot;
let tray;
let quitting = false;
const dailyCache = new Map();
const events = new Map(); // id -> event
const feedStatus = {};
let quotes = {};
const notified = new Set();
const timers = [];

function readJson(f, fallback) {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return structuredClone(fallback); }
}
function writeJson(f, v) { fs.writeFileSync(f, JSON.stringify(v, null, 1)); }
function send(ch, payload) { if (win && !win.isDestroyed()) win.webContents.send(ch, payload); }
const prices = () => Object.fromEntries(Object.entries(quotes).filter(([, q]) => q.ok).map(([s, q]) => [s, q.price]));

// ------------------------------------------------------------------ window
function createWindow() {
  const stateFile = path.join(DATA, 'window.json');
  const ws = readJson(stateFile, { width: 1600, height: 960, maximized: true });
  win = new BrowserWindow({
    width: ws.width, height: ws.height, x: ws.x, y: ws.y, minWidth: 1180, minHeight: 720,
    backgroundColor: '#000000', show: false, title: 'Lodestar',
    icon: path.join(__dirname, '../../build/icon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#000000', symbolColor: '#57c7d4', height: 34 },
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: !process.env.LODESTAR_SHOT },
  });
  if (ws.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, '../renderer/index.html'));

  const saveState = () => {
    if (win.isDestroyed()) return;
    const b = win.getNormalBounds();
    writeJson(stateFile, { ...b, maximized: win.isMaximized() });
  };
  win.on('close', (e) => {
    saveState();
    if (!quitting && autopilot?.s.enabled) {
      e.preventDefault();
      win.hide();
      ensureTray();
      if (!trayHintShown && Notification.isSupported()) {
        trayHintShown = true;
        new Notification({ title: 'Lodestar is still running', body: 'Autopilot keeps paper trading in the background. Right-click the tray icon to quit.' }).show();
      }
    }
  });

  win.webContents.on('console-message', (e) => {
    const { level, message, sourceId, lineNumber } = e;
    if (level === 'error' || level === 'warning' || level >= 2) log.warn(`[renderer] ${message} (${sourceId}:${lineNumber})`);
  });

  // Dev self-check: LODESTAR_SHOT=<png path> captures the window after load, then quits.
  if (process.env.LODESTAR_SHOT) {
    win.webContents.once('did-finish-load', () => setTimeout(async () => {
      if (process.env.LODESTAR_EVAL) {
        try { await win.webContents.executeJavaScript(process.env.LODESTAR_EVAL); } catch (err) { log.error('eval', err.message); }
        await new Promise((r) => setTimeout(r, 4000));
      }
      const img = await win.webContents.capturePage();
      fs.writeFileSync(process.env.LODESTAR_SHOT, img.toPNG());
      log.info('shot saved', process.env.LODESTAR_SHOT);
      app.exit(0);
    }, Number(process.env.LODESTAR_SHOT_DELAY || 25000)));
  }

  // links open in the real browser, never inside the app
  win.webContents.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) { e.preventDefault(); openExternal(url); } });
}

function openExternal(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'https:' || u.protocol === 'http:') shell.openExternal(u.toString());
  } catch { /* ignore bad urls */ }
}

// ------------------------------------------------------------------ feeds
async function runFeed(key) {
  const src = SOURCES[key];
  const st = (feedStatus[key] = feedStatus[key] || { key, label: src.label, ok: null, count: 0 });
  st.loading = true;
  send('feeds:status', feedStatus);
  try {
    const list = await src.fn();
    for (const [id, e] of events) if (e._src === key) events.delete(id);
    for (const e of list) {
      if (!Number.isFinite(e.lat) || !Number.isFinite(e.lon)) continue;
      e._src = key;
      e.region = regionFor(e);
      events.set(e.id, e);
    }
    Object.assign(st, { ok: true, count: list.length, lastOk: Date.now(), error: null });
    maybeNotify(list);
    autopilot?.onEvents(list.filter((e) => Number.isFinite(e.lat)));
  } catch (err) {
    Object.assign(st, { ok: false, error: err.message, lastErr: Date.now() });
    log.warn(`feed ${key} failed: ${err.message}`);
  }
  st.loading = false;
  send('feeds:status', feedStatus);
  send('feeds:events', [...events.values()]);
}

function maybeNotify(list) {
  if (!settings.notifications || !Notification.isSupported()) return;
  const fresh = Date.now() - 2 * 3600e3;
  for (const e of list) {
    if (notified.has(e.id)) continue;
    notified.add(e.id);
    if (!appReadyAt || Date.now() - appReadyAt < 20e3) continue; // don't spam on startup
    if (e.severity < settings.notifyMinSeverity || e.time < fresh) continue;
    const n = new Notification({ title: `Lodestar · ${e.kind.toUpperCase()}`, body: `${e.title}${e.place ? ` — ${e.place}` : ''}`, silent: false });
    n.on('click', () => { win?.show(); send('events:focus', e.id); });
    n.show();
  }
}
let appReadyAt = 0;

function startFeeds() {
  for (const key of Object.keys(SOURCES)) {
    runFeed(key);
    timers.push(setInterval(() => runFeed(key), SOURCES[key].every));
  }
}

// ------------------------------------------------------------------ quotes
function watchSymbols() {
  const set = new Set();
  for (const g of settings.watchlist) for (const [s] of g.symbols) set.add(s);
  for (const a of Object.values(ledger.state.accounts)) for (const s of Object.keys(a.positions)) set.add(s);
  for (const s of autopilot?.s.universe || []) set.add(s);
  return [...set];
}

let quoteTimer;
async function refreshQuotes() {
  try {
    const syms = watchSymbols();
    stream?.subscribe(syms);
    const q = await markets.quotes(syms);
    for (const [s, v] of Object.entries(q)) {
      if (!v.ok && quotes[s]) continue;
      // keep a fresher streamed price if one arrived after this poll started
      if (quotes[s]?.streamAt && quotes[s].streamAt > Date.now() - 15e3) v.price = quotes[s].price;
      quotes[s] = { ...v, streamAt: quotes[s]?.streamAt };
    }
    send('markets:quotes', quotes);
    markBook();
  } catch (e) {
    log.warn('quotes failed', e.message);
  }
  clearTimeout(quoteTimer);
  quoteTimer = setTimeout(refreshQuotes, Math.max(30, settings.quoteEverySec) * 1000);
}

// mark positions to market, fire stops/targets, let autopilot react (throttled for streamed ticks)
let lastMark = 0;
function markBook() {
  lastMark = Date.now();
  const fired = ledger.mark(prices());
  autopilot?.onQuotes();
  for (const f of fired) {
    if (Notification.isSupported()) new Notification({ title: `Lodestar · ${f.reason.toUpperCase()} filled`, body: `${f.side.toUpperCase()} ${f.qty} ${f.symbol} @ ${f.price.toFixed(2)}` }).show();
  }
  send('ledger:state', ledger.snapshot(prices()));
}

// ------------------------------------------------------------------ live stream
let stream;
let pendingTicks = {};
let tickTimer;
function onTick(t) {
  const q = quotes[t.id] || { symbol: t.id, ok: true, spark: [] };
  q.ok = true;
  q.price = t.price;
  if (Number.isFinite(t.change)) q.prevClose = t.price - t.change;
  if (q.prevClose) q.change = t.price / q.prevClose - 1;
  if (Number.isFinite(t.dayHigh)) q.dayHigh = t.dayHigh;
  if (Number.isFinite(t.dayLow)) q.dayLow = t.dayLow;
  q.streamAt = Date.now();
  if (q.spark?.length) q.spark[q.spark.length - 1] = t.price;
  quotes[t.id] = q;
  pendingTicks[t.id] = { symbol: t.id, price: q.price, change: q.change, prevClose: q.prevClose, dayHigh: q.dayHigh, dayLow: q.dayLow, t: Date.now() };
  if (!tickTimer) {
    tickTimer = setTimeout(() => {
      send('markets:ticks', pendingTicks);
      pendingTicks = {};
      tickTimer = null;
      if (Date.now() - lastMark > 3000) markBook();
    }, 250);
  }
}

// ------------------------------------------------------------------ satellite texture cache
async function satellite() {
  const dir = path.join(DATA, 'imagery');
  fs.mkdirSync(dir, { recursive: true });
  const day = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  const file = path.join(dir, `viirs-${day}.jpg`);
  if (!fs.existsSync(file)) {
    const { data } = await satelliteImage();
    fs.writeFileSync(file, data);
    for (const f of fs.readdirSync(dir)) if (f !== path.basename(file)) fs.rmSync(path.join(dir, f), { force: true });
  }
  // data URL keeps the WebGL texture same-origin
  return { day, url: `data:image/jpeg;base64,${fs.readFileSync(file).toString('base64')}` };
}

// ------------------------------------------------------------------ tray (keeps autopilot running)
let trayHintShown = false;
function ensureTray() {
  if (tray) return refreshTray();
  const img = nativeImage.createFromPath(path.join(__dirname, '../../build/icon.png')).resize({ width: 16, height: 16 });
  tray = new Tray(img);
  tray.setToolTip('Lodestar');
  tray.on('click', () => { win.show(); win.focus(); });
  refreshTray();
}
function refreshTray() {
  if (!tray) return;
  const on = autopilot.s.enabled;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Lodestar', click: () => { win.show(); win.focus(); } },
    { type: 'separator' },
    { label: on ? 'Autopilot: on' : 'Autopilot: off', enabled: false },
    { label: on ? 'Turn Autopilot off' : 'Turn Autopilot on', click: () => { on ? autopilot.stop() : autopilot.start(); refreshTray(); } },
    { type: 'separator' },
    { label: 'Quit Lodestar', click: () => { quitting = true; app.quit(); } },
  ]));
}

// ------------------------------------------------------------------ IPC
function handle(ch, fn) {
  ipcMain.handle(ch, async (_e, ...args) => {
    try { return { ok: true, data: await fn(...args) }; } catch (err) { return { ok: false, error: err.message }; }
  });
}

function registerIpc() {
  handle('app:info', () => ({ version: app.getVersion(), dataDir: DATA, packaged: app.isPackaged }));
  handle('app:openExternal', (url) => openExternal(url));
  handle('settings:get', () => settings);
  handle('settings:set', (patch) => {
    settings = { ...settings, ...patch, layers: { ...settings.layers, ...(patch.layers || {}) } };
    writeJson(SETTINGS_FILE, settings);
    if (patch.watchlist || patch.quoteEverySec) refreshQuotes();
    return settings;
  });
  handle('feeds:snapshot', () => ({ events: [...events.values()], status: feedStatus }));
  handle('feeds:refresh', () => { for (const k of Object.keys(SOURCES)) runFeed(k); });
  handle('feeds:satellite', () => satellite());
  handle('markets:quotes', () => quotes);
  handle('markets:streamStatus', () => stream?.status || 'off');
  handle('markets:chart', (symbol, range) => markets.chart(symbol, range));
  handle('markets:lookup', async (symbol) => {
    const c = await markets.chart(symbol.toUpperCase().trim(), '1D');
    return { symbol: c.symbol, name: c.name, price: c.price };
  });
  handle('ledger:state', () => ledger.snapshot(prices()));
  handle('ledger:order', async (o) => {
    let px = prices()[o.symbol];
    if (!(px > 0)) {
      const c = await markets.chart(o.symbol, '1D');
      px = c.price;
      quotes[o.symbol] = { symbol: o.symbol, name: c.name, price: c.price, prevClose: c.prevClose, change: c.prevClose ? c.price / c.prevClose - 1 : 0, spark: c.candles.map((x) => x.close), ok: true };
    }
    const rec = ledger.order({ ...o, price: px }, prices());
    return { order: rec, state: ledger.snapshot(prices()) };
  });
  handle('ledger:closeIn', (symbol, id) => { ledger.closePosition(symbol, prices(), 'manual close', id); return ledger.snapshot(prices()); });
  handle('ledger:close', (symbol) => { ledger.closePosition(symbol, prices()); return ledger.snapshot(prices()); });
  handle('ledger:bracket', (symbol, stop, target) => { ledger.setBracket(symbol, stop, target); return ledger.snapshot(prices()); });
  handle('ledger:createAccount', (name, cash) => { const id = ledger.createAccount(name, cash); ledger.switchAccount(id); return ledger.snapshot(prices()); });
  handle('ledger:switchAccount', (id) => { ledger.switchAccount(id); return ledger.snapshot(prices()); });
  handle('ledger:resetAccount', () => { ledger.resetAccount(); return ledger.snapshot(prices()); });
  handle('ledger:deleteAccount', (id) => { ledger.deleteAccount(id); return ledger.snapshot(prices()); });
  handle('ledger:rules', (r) => { ledger.setRules(r); return ledger.snapshot(prices()); });
  handle('ledger:exportCsv', () => {
    const rows = [['time', 'symbol', 'side', 'qty', 'price', 'fee', 'realized', 'reason']];
    for (const o of ledger.acct.orders) rows.push([new Date(o.time).toISOString(), o.symbol, o.side, o.qty, o.price, o.fee.toFixed(2), o.realized.toFixed(2), o.reason]);
    const file = path.join(app.getPath('downloads'), `lodestar-${ledger.acct.name.replace(/\W+/g, '_')}-orders.csv`);
    fs.writeFileSync(file, rows.map((r) => r.join(',')).join('\n'));
    shell.showItemInFolder(file);
    return file;
  });
  handle('autopilot:state', () => autopilot.state());
  handle('autopilot:start', () => { const st = autopilot.start(); refreshTray(); return st; });
  handle('autopilot:stop', () => { const st = autopilot.stop(); refreshTray(); return st; });
  handle('autopilot:flatten', () => autopilot.flatten());
  handle('autopilot:reset', () => autopilot.reset());
  handle('autopilot:configure', (p) => autopilot.configure(p));
  handle('ledger:snapshotOf', (id) => ledger.snapshot(prices(), id));
  handle('updater:check', () => updater.check(true));
  handle('updater:install', () => updater.install());
}

// ------------------------------------------------------------------ lifecycle
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

app.whenReady().then(() => {
  nativeTheme.themeSource = 'dark';
  Menu.setApplicationMenu(null);
  ledger = new Ledger(DATA);
  autopilot = new Autopilot({
    dir: DATA, ledger, log,
    prices,
    events: () => [...events.values()],
    daily: async (sym) => {
      const hit = dailyCache.get(sym);
      if (hit && Date.now() - hit.t < 30 * 60e3) return hit.c;
      const c = await markets.chart(sym, '6M');
      dailyCache.set(sym, { t: Date.now(), c });
      return c;
    },
    notify: (title, body) => { if (settings.notifications && Notification.isSupported()) new Notification({ title, body }).show(); },
    emit: (st) => { send('autopilot:state', st); send('ledger:state', ledger.snapshot(prices())); },
  });
  stream = new QuoteStream({ onTick, log });
  registerIpc();
  if (autopilot.s.enabled) ensureTray();
  createWindow();
  appReadyAt = Date.now();
  startFeeds();
  refreshQuotes();
  updater.init({ send, log });
});

app.on('before-quit', () => { quitting = true; });

app.on('window-all-closed', () => {
  timers.forEach(clearInterval);
  clearTimeout(quoteTimer);
  app.quit();
});
