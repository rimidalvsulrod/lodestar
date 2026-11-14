// Autopilot: trades a dedicated paper account by itself, long and short.
// Two simple, readable strategies. Neither has a proven edge; they exist so you
// can watch a rules-based system run on paper before trusting any idea with money.
//
//  Event reaction  When a new high-severity event arrives, take the textbook move in
//                  its linked markets (e.g. Gulf conflict -> long Brent, long gold;
//                  Gulf hurricane -> long natural gas, short insurer). Fixed stop,
//                  target and a maximum holding time.
//  Trend           Once an hour, compare each market's price to its 20- and 50-day
//                  averages: above both and rising -> long, below both and falling ->
//                  short, otherwise flat.
const fs = require('fs');
const path = require('path');
const { exposures } = require('../shared/exposures');

const DEFAULTS = {
  enabled: false,
  accountId: null,
  startedAt: null,
  strategies: { events: true, trend: true },
  riskPct: 0.5, // equity risked per trade if the stop is hit
  stopPct: 2.5,
  targetPct: 5,
  maxHoldHrs: 72,
  maxPositions: 10,
  maxPositionPct: 12,
  minSeverity: 0.65,
  universe: ['CL=F', 'BZ=F', 'NG=F', 'GC=F', 'SI=F', 'HG=F', 'ZW=F', 'ZC=F', 'ITA', 'SPY', 'TSM', 'BTC-USD'],
  seen: [],
  log: [],
};

const TRADEABLE = (s) => !s.startsWith('^') && !s.includes('.NYB');

class Autopilot {
  constructor({ dir, ledger, prices, events, daily, notify, emit, log }) {
    this.file = path.join(dir, 'autopilot.json');
    Object.assign(this, { ledger, prices, events, daily, notify, emit, logger: log });
    this.s = { ...DEFAULTS, ...this.load() };
    this.s.strategies = { ...DEFAULTS.strategies, ...this.s.strategies };
    this.seen = new Set(this.s.seen);
    this.busy = false;
    this.trendTimer = setInterval(() => this.trendTick(), 60 * 60e3);
    if (this.s.enabled) setTimeout(() => this.trendTick(), 15e3);
  }

  load() { try { return JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { return {}; } }
  save() {
    this.s.seen = [...this.seen].slice(-4000);
    this.s.log = this.s.log.slice(0, 400);
    fs.writeFileSync(this.file, JSON.stringify(this.s, null, 1));
    this.emit?.(this.state());
  }

  state() {
    const { seen, ...rest } = this.s;
    return { ...rest, account: this.accountExists() ? this.ledger.snapshot(this.prices(), this.s.accountId) : null };
  }

  accountExists() { return this.s.accountId && this.ledger.state.accounts[this.s.accountId]; }

  record(type, text, extra = {}) {
    this.s.log.unshift({ t: Date.now(), type, text, ...extra });
    this.logger?.info(`[autopilot] ${type}: ${text}`);
  }

  configure(patch) {
    const num = ['riskPct', 'stopPct', 'targetPct', 'maxHoldHrs', 'maxPositions', 'maxPositionPct', 'minSeverity'];
    for (const k of num) if (patch[k] != null && Number.isFinite(+patch[k]) && +patch[k] >= 0) this.s[k] = +patch[k];
    if (patch.strategies) this.s.strategies = { ...this.s.strategies, ...patch.strategies };
    this.save();
    return this.state();
  }

  start() {
    if (!this.accountExists()) {
      const active = this.ledger.state.active;
      this.s.accountId = this.ledger.createAccount('Autopilot', 100000);
      this.ledger.state.active = active; // keep the user's own account selected
      this.ledger.save();
      this.record('info', 'Created the Autopilot paper account with $100,000.');
    }
    this.s.enabled = true;
    this.s.startedAt = Date.now();
    for (const e of this.events()) this.seen.add(e.id); // only react to what happens from now on
    this.record('info', 'Autopilot on. Watching for new events and checking trends hourly.');
    this.save();
    this.trendTick();
    return this.state();
  }

  stop() {
    this.s.enabled = false;
    this.record('info', 'Autopilot off. Open positions keep their stops and targets.');
    this.save();
    return this.state();
  }

  flatten() {
    if (!this.accountExists()) return this.state();
    const acct = this.ledger.state.accounts[this.s.accountId];
    let n = 0;
    for (const sym of Object.keys(acct.positions)) {
      try { this.ledger.closePosition(sym, this.prices(), 'auto · flatten', acct.id); n++; } catch (e) { this.record('skip', `Could not close ${sym}: ${e.message}`); }
    }
    this.record('close', `Closed all ${n} position${n === 1 ? '' : 's'}.`);
    this.save();
    return this.state();
  }

  reset() {
    if (this.accountExists()) this.ledger.resetAccount(this.s.accountId);
    this.s.log = [];
    this.record('info', 'Autopilot account reset to $100,000.');
    this.save();
    return this.state();
  }

  acct() { return this.ledger.state.accounts[this.s.accountId]; }

  // ---------------------------------------------------------------- sizing + orders
  open(symbol, dir, why, owner) {
    const prices = this.prices();
    const price = prices[symbol];
    const a = this.acct();
    if (!(price > 0)) { this.record('skip', `${symbol}: no live price yet.`); return false; }
    const existing = a.positions[symbol];
    if (existing && Math.sign(existing.qty) === dir) return false; // already positioned this way
    if (!existing && Object.keys(a.positions).length >= this.s.maxPositions) {
      this.record('skip', `${symbol}: already holding the maximum ${this.s.maxPositions} positions.`);
      return false;
    }
    if (existing) this.ledger.closePosition(symbol, prices, `auto · reverse (${owner})`, a.id);

    const equity = this.ledger.equityOf(a, prices);
    const stopDist = price * this.s.stopPct / 100;
    let qty = (equity * this.s.riskPct / 100) / stopDist;
    qty = Math.min(qty, (equity * this.s.maxPositionPct / 100) / price);
    qty = price > 1000 ? Math.floor(qty * 1000) / 1000 : Math.floor(qty);
    if (!(qty > 0)) { this.record('skip', `${symbol}: position would be smaller than one unit.`); return false; }

    const stop = dir > 0 ? price - stopDist : price + stopDist;
    const target = dir > 0 ? price * (1 + this.s.targetPct / 100) : price * (1 - this.s.targetPct / 100);
    try {
      const rec = this.ledger.order({ symbol, side: dir > 0 ? 'buy' : 'sell', qty, price, stop, target, owner, reason: `auto · ${owner}` }, prices, a.id);
      const text = `${dir > 0 ? 'Long' : 'Short'} ${qty} ${symbol} at ${price.toFixed(2)}. ${why}`;
      this.record('open', text, { symbol, dir, owner });
      this.notify?.(`Autopilot ${dir > 0 ? 'long' : 'short'} ${symbol}`, why);
      return rec;
    } catch (e) {
      this.record('skip', `${symbol}: ${e.message}`);
      return false;
    }
  }

  // ---------------------------------------------------------------- event strategy
  onEvents(list) {
    if (!this.s.enabled || !this.accountExists()) { for (const e of list) this.seen.add(e.id); return; }
    let changed = false;
    for (const e of list) {
      if (this.seen.has(e.id)) continue;
      this.seen.add(e.id);
      changed = true;
      if (!this.s.strategies.events) continue;
      if (e.severity < this.s.minSeverity || e.time < this.s.startedAt - 6 * 3600e3) continue;
      const ideas = exposures(e).filter((x) => x.dir && TRADEABLE(x.symbol)).slice(0, 2);
      for (const x of ideas) this.open(x.symbol, x.dir, `Event: ${e.title.slice(0, 90)} (${x.why}).`, 'event');
    }
    if (changed) this.save();
  }

  // ---------------------------------------------------------------- time exits
  onQuotes() {
    if (!this.accountExists()) return;
    const a = this.acct();
    const limit = this.s.maxHoldHrs * 3600e3;
    let changed = false;
    for (const [sym, p] of Object.entries(a.positions)) {
      if (p.owner === 'event' && Date.now() - (p.opened || 0) > limit) {
        try {
          this.ledger.closePosition(sym, this.prices(), 'auto · time exit', a.id);
          this.record('close', `${sym}: held ${this.s.maxHoldHrs} h without hitting stop or target, closed.`);
          changed = true;
        } catch { /* no price */ }
      }
    }
    // log stop/target exits the ledger fired since last look
    const seenOrders = this.lastOrderSeen || 0;
    for (const o of a.orders) {
      if (o.time <= seenOrders) break;
      if (o.reason === 'stop' || o.reason === 'target') {
        this.record('close', `${o.symbol}: ${o.reason} hit at ${o.price.toFixed(2)}, ${o.realized >= 0 ? 'gain' : 'loss'} $${Math.abs(o.realized).toFixed(2)}.`);
        changed = true;
      }
    }
    this.lastOrderSeen = a.orders[0]?.time || seenOrders;
    if (changed) this.save();
    else this.emit?.(this.state());
  }

  // ---------------------------------------------------------------- trend strategy
  async trendTick() {
    if (!this.s.enabled || !this.s.strategies.trend || this.busy || !this.accountExists()) return;
    this.busy = true;
    try {
      for (const sym of this.s.universe) {
        let c;
        try { c = await this.daily(sym); } catch { continue; }
        const closes = c.candles.map((x) => x.close).filter(Number.isFinite);
        if (closes.length < 55) continue;
        const sma = (n, off = 0) => closes.slice(closes.length - n - off, closes.length - off).reduce((x, y) => x + y, 0) / n;
        const price = this.prices()[sym] ?? closes.at(-1);
        const s20 = sma(20), s50 = sma(50), s20prev = sma(20, 5);
        const want = price > s20 && s20 > s50 && s20 > s20prev ? 1 : price < s20 && s20 < s50 && s20 < s20prev ? -1 : 0;
        const pos = this.acct().positions[sym];
        const have = pos && pos.owner === 'trend' ? Math.sign(pos.qty) : 0;
        if (want === have) continue;
        if (have && !want) {
          this.ledger.closePosition(sym, this.prices(), 'auto · trend exit', this.s.accountId);
          this.record('close', `${sym}: trend faded (price ${price.toFixed(2)}, 20-day ${s20.toFixed(2)}), closed.`);
        } else if (want && (!pos || pos.owner === 'trend')) {
          this.open(sym, want, `Trend: price ${want > 0 ? 'above' : 'below'} its 20-day (${s20.toFixed(2)}) and 50-day (${s50.toFixed(2)}) averages.`, 'trend');
        }
      }
      this.s.lastTrendCheck = Date.now();
      this.save();
    } finally {
      this.busy = false;
    }
  }
}

module.exports = { Autopilot };
