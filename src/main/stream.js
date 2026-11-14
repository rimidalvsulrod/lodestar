// Push quotes from Yahoo Finance's public streamer (the same feed finance.yahoo.com uses).
// Messages are base64 protobuf "PricingData"; this decodes just the fields we use.
// No key needed. Prices follow exchange delay rules (crypto is real time).

const URL = 'wss://streamer.finance.yahoo.com/?version=2';

// field number -> [name, wire type, signed]
const FIELDS = {
  1: ['id', 'str'], 2: ['price', 'f32'], 3: ['time', 'zz'], 4: ['currency', 'str'], 5: ['exchange', 'str'],
  8: ['changePercent', 'f32'], 9: ['dayVolume', 'zz'], 10: ['dayHigh', 'f32'], 11: ['dayLow', 'f32'],
  12: ['change', 'f32'], 13: ['shortName', 'str'], 15: ['open', 'f32'], 16: ['previousClose', 'f32'],
};

function decode(buf) {
  const out = {};
  let i = 0;
  const varint = () => {
    let x = 0, mul = 1, b;
    do { b = buf[i++]; x += (b & 0x7f) * mul; mul *= 128; } while (b & 0x80 && i < buf.length);
    return x;
  };
  while (i < buf.length) {
    const tag = varint();
    const field = Math.floor(tag / 8), wire = tag & 7;
    const f = FIELDS[field];
    if (wire === 0) {
      const v = varint();
      if (f) out[f[0]] = f[1] === 'zz' ? (v % 2 ? -(v + 1) / 2 : v / 2) : v;
    } else if (wire === 5) {
      if (f) out[f[0]] = buf.readFloatLE(i);
      i += 4;
    } else if (wire === 1) {
      i += 8;
    } else if (wire === 2) {
      const len = varint();
      if (f) out[f[0]] = buf.toString('utf8', i, i + len);
      i += len;
    } else break;
  }
  return out;
}

class QuoteStream {
  constructor({ onTick, log }) {
    this.onTick = onTick;
    this.log = log;
    this.symbols = new Set();
    this.retry = 1000;
    this.status = 'connecting';
    this.lastMsg = 0;
    this.connect();
    setInterval(() => {
      // reconnect if silent for 3 minutes while subscribed to something that trades 24/7
      if (this.ws?.readyState === 1 && this.symbols.has('BTC-USD') && Date.now() - this.lastMsg > 180e3) this.ws.close();
    }, 60e3);
  }

  connect() {
    try {
      this.ws = new WebSocket(URL);
    } catch (e) {
      this.log?.warn('stream connect failed', e.message);
      return this.schedule();
    }
    this.ws.onopen = () => {
      this.status = 'live';
      this.retry = 1000;
      if (this.symbols.size) this.ws.send(JSON.stringify({ subscribe: [...this.symbols] }));
    };
    this.ws.onmessage = (m) => {
      this.lastMsg = Date.now();
      try {
        const d = JSON.parse(String(m.data));
        if (d.type !== 'pricing' || !d.message) return;
        const q = decode(Buffer.from(d.message, 'base64'));
        if (q.id && Number.isFinite(q.price)) this.onTick(q);
      } catch { /* ignore malformed frames */ }
    };
    this.ws.onclose = () => { this.status = 'reconnecting'; this.schedule(); };
    this.ws.onerror = () => { /* onclose follows */ };
  }

  schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.connect(), this.retry);
    this.retry = Math.min(this.retry * 2, 30000);
  }

  subscribe(list) {
    const next = new Set(list);
    const add = [...next].filter((s) => !this.symbols.has(s));
    const drop = [...this.symbols].filter((s) => !next.has(s));
    this.symbols = next;
    if (this.ws?.readyState === 1) {
      if (add.length) this.ws.send(JSON.stringify({ subscribe: add }));
      if (drop.length) this.ws.send(JSON.stringify({ unsubscribe: drop }));
    }
  }
}

module.exports = { QuoteStream, decode };
