// Local paper-trading ledger. Lives in the user's AppData folder as JSON.
// No broker, no real money. Market orders fill at the latest delayed quote plus a fee.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class Ledger {
  constructor(dir) {
    this.file = path.join(dir, 'ledger.json');
    this.state = this.load();
  }

  load() {
    try {
      const s = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (s && s.accounts && s.active) return s;
    } catch { /* first run */ }
    const s = { active: null, accounts: {} };
    this.state = s;
    const id = this.createAccount('Main', 100000, s);
    s.active = id;
    this.save();
    return s;
  }

  save() {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.state, null, 1));
    fs.renameSync(tmp, this.file);
  }

  createAccount(name, startCash, s = this.state) {
    const id = crypto.randomUUID().slice(0, 8);
    s.accounts[id] = {
      id, name: String(name || 'Account').slice(0, 40), created: Date.now(), startCash: Number(startCash) || 100000,
      cash: Number(startCash) || 100000, positions: {}, orders: [], equity: [], realized: 0, fees: 0,
      dayStart: { date: today(), equity: Number(startCash) || 100000 },
      rules: { feeBps: 5, maxPositionPct: 25, dailyLossPct: 5 },
    };
    if (s === this.state && this.file) this.save();
    return id;
  }

  get acct() { return this.state.accounts[this.state.active]; }

  switchAccount(id) {
    if (!this.state.accounts[id]) throw new Error('No such account');
    this.state.active = id;
    this.save();
  }

  resetAccount(id = this.state.active) {
    const a = this.state.accounts[id];
    Object.assign(a, { cash: a.startCash, positions: {}, orders: [], equity: [], realized: 0, fees: 0, dayStart: { date: today(), equity: a.startCash } });
    this.save();
  }

  deleteAccount(id) {
    if (Object.keys(this.state.accounts).length <= 1) throw new Error('Keep at least one account');
    delete this.state.accounts[id];
    if (this.state.active === id) this.state.active = Object.keys(this.state.accounts)[0];
    this.save();
  }

  setRules(rules) {
    const r = this.acct.rules;
    for (const k of ['feeBps', 'maxPositionPct', 'dailyLossPct']) if (rules[k] != null && Number.isFinite(+rules[k])) r[k] = Math.max(0, +rules[k]);
    this.save();
  }

  equityOf(a, prices) {
    let eq = a.cash;
    for (const [s, p] of Object.entries(a.positions)) eq += p.qty * (prices[s] ?? p.last ?? p.avg);
    return eq;
  }

  // side: 'buy' | 'sell'. Selling with no position opens a short.
  // side: 'buy' opens/adds a long or covers a short; 'sell' opens/adds a short or reduces a long.
  order({ symbol, side, qty, price, stop, target, reason = 'manual', owner }, prices, accountId) {
    const a = accountId ? this.state.accounts[accountId] : this.acct;
    if (!a) throw new Error('No such account');
    qty = Number(qty);
    if (!symbol || !(qty > 0)) throw new Error('Enter a quantity above zero');
    if (!(price > 0)) throw new Error(`No live price for ${symbol}`);
    this.rollDay(a, prices);

    const signed = side === 'buy' ? qty : -qty;
    const pos = a.positions[symbol] || { qty: 0, avg: 0, stop: null, target: null, opened: Date.now() };
    const closing = pos.qty !== 0 && Math.sign(pos.qty) !== Math.sign(signed);

    if (!closing) {
      const eq = this.equityOf(a, prices);
      const dayPnlPct = (eq / a.dayStart.equity - 1) * 100;
      if (a.rules.dailyLossPct > 0 && dayPnlPct <= -a.rules.dailyLossPct) {
        throw new Error(`Daily loss limit hit (${dayPnlPct.toFixed(1)}%). Only closing orders allowed today.`);
      }
      const newNotional = Math.abs((pos.qty + signed) * price);
      if (a.rules.maxPositionPct > 0 && newNotional > eq * a.rules.maxPositionPct / 100) {
        throw new Error(`Position would be ${(newNotional / eq * 100).toFixed(0)}% of equity; limit is ${a.rules.maxPositionPct}%.`);
      }
    }

    const fee = Math.abs(signed * price) * a.rules.feeBps / 1e4;
    let realized = 0;
    const newQty = pos.qty + signed;
    if (closing) {
      const closedQty = Math.min(Math.abs(signed), Math.abs(pos.qty));
      realized = closedQty * (price - pos.avg) * Math.sign(pos.qty);
      if (Math.sign(newQty) === Math.sign(signed) && newQty !== 0) pos.avg = price; // flipped through zero
    } else {
      pos.avg = (pos.qty * pos.avg + signed * price) / newQty;
    }
    pos.qty = newQty;
    a.cash -= signed * price + fee;
    a.realized += realized;
    a.fees += fee;
    if (stop !== undefined) pos.stop = stop > 0 ? Number(stop) : null;
    if (target !== undefined) pos.target = target > 0 ? Number(target) : null;
    if (owner && !closing) pos.owner = owner;
    if (!closing && pos.qty === signed) pos.opened = Date.now();
    pos.last = price;

    if (Math.abs(pos.qty) < 1e-9) delete a.positions[symbol];
    else a.positions[symbol] = pos;

    const rec = { id: crypto.randomUUID().slice(0, 8), time: Date.now(), symbol, side, qty, price, fee, realized, reason, account: a.id };
    a.orders.unshift(rec);
    a.orders = a.orders.slice(0, 2000);
    this.save();
    return rec;
  }

  closePosition(symbol, prices, reason = 'manual close', accountId) {
    const a = accountId ? this.state.accounts[accountId] : this.acct;
    const p = a?.positions[symbol];
    if (!p) throw new Error('No position');
    return this.order({ symbol, side: p.qty > 0 ? 'sell' : 'buy', qty: Math.abs(p.qty), price: prices[symbol] ?? p.last, reason }, prices, a.id);
  }

  setBracket(symbol, stop, target) {
    const p = this.acct.positions[symbol];
    if (!p) throw new Error('No position');
    p.stop = stop > 0 ? +stop : null;
    p.target = target > 0 ? +target : null;
    this.save();
  }

  // Called on every quote refresh: mark to market, fire stops/targets, record equity.
  mark(prices) {
    const fired = [];
    for (const a of Object.values(this.state.accounts)) {
      this.rollDay(a, prices);
      for (const [s, p] of Object.entries(a.positions)) {
        const px = prices[s];
        if (!(px > 0)) continue;
        p.last = px;
        const long = p.qty > 0;
        const hitStop = p.stop && (long ? px <= p.stop : px >= p.stop);
        const hitTarget = p.target && (long ? px >= p.target : px <= p.target);
        if (hitStop || hitTarget) {
          try { fired.push(this.closePosition(s, prices, hitStop ? 'stop' : 'target', a.id)); } catch { /* ignore */ }
        }
      }
      const eq = this.equityOf(a, prices);
      const lastPt = a.equity.at(-1);
      if (!lastPt || Date.now() - lastPt.t > 60e3) {
        a.equity.push({ t: Date.now(), v: eq });
        if (a.equity.length > 20000) a.equity.splice(0, a.equity.length - 20000);
      }
    }
    this.save();
    return fired;
  }

  rollDay(a, prices) {
    if (a.dayStart.date !== today()) a.dayStart = { date: today(), equity: this.equityOf(a, prices) };
  }

  snapshot(prices, accountId) {
    const a = (accountId && this.state.accounts[accountId]) || this.acct;
    const eq = this.equityOf(a, prices);
    return {
      active: this.state.active,
      accounts: Object.values(this.state.accounts).map((x) => ({ id: x.id, name: x.name })),
      account: {
        ...a, equity: undefined, equityNow: eq, dayPnl: eq - a.dayStart.equity, totalPnl: eq - a.startCash,
        positions: Object.entries(a.positions).map(([symbol, p]) => {
          const px = prices[symbol] ?? p.last ?? p.avg;
          return { symbol, ...p, price: px, value: p.qty * px, pnl: (px - p.avg) * p.qty, pnlPct: (px / p.avg - 1) * Math.sign(p.qty) };
        }),
        orders: a.orders.slice(0, 200),
      },
      equityCurve: a.equity.slice(-5000),
    };
  }
}

function today() { return new Date().toISOString().slice(0, 10); }

module.exports = { Ledger };
