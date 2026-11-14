// Market data from Yahoo Finance's public chart endpoint (delayed, no key).
const { get } = require('./feeds');

const DEFAULT_WATCHLIST = [
  { group: 'Energy', symbols: [['CL=F', 'WTI Crude'], ['BZ=F', 'Brent Crude'], ['NG=F', 'Natural Gas'], ['RB=F', 'Gasoline'], ['XLE', 'Energy Sector']] },
  { group: 'Metals', symbols: [['GC=F', 'Gold'], ['SI=F', 'Silver'], ['HG=F', 'Copper']] },
  { group: 'Agriculture', symbols: [['ZW=F', 'Wheat'], ['ZC=F', 'Corn'], ['ZS=F', 'Soybeans']] },
  { group: 'Defense', symbols: [['ITA', 'Aerospace & Defense'], ['LMT', 'Lockheed Martin'], ['RTX', 'RTX'], ['NOC', 'Northrop Grumman']] },
  { group: 'Risk', symbols: [['SPY', 'S&P 500'], ['^VIX', 'Volatility'], ['DX-Y.NYB', 'US Dollar'], ['TSM', 'TSMC'], ['TRV', 'Travelers (insurer)'], ['BTC-USD', 'Bitcoin']] },
];

const RANGES = {
  '1D': ['1d', '5m'], '5D': ['5d', '15m'], '1M': ['1mo', '1h'], '6M': ['6mo', '1d'], '1Y': ['1y', '1d'], '5Y': ['5y', '1wk'],
};

const hosts = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];
let hostIdx = 0;

async function chart(symbol, range = '1D') {
  const [r, i] = RANGES[range] || RANGES['1D'];
  const path = `/v8/finance/chart/${encodeURIComponent(symbol)}?range=${r}&interval=${i}&includePrePost=false`;
  let lastErr;
  for (let k = 0; k < hosts.length; k++) {
    const host = hosts[(hostIdx + k) % hosts.length];
    try {
      const d = await get(`https://${host}${path}`, { timeout: 15000 });
      const res = d?.chart?.result?.[0];
      if (!res) throw new Error(d?.chart?.error?.description || 'no data');
      const q = res.indicators?.quote?.[0] || {};
      const candles = [];
      (res.timestamp || []).forEach((t, n) => {
        if (q.close?.[n] == null || q.open?.[n] == null) return;
        candles.push({ time: t, open: q.open[n], high: q.high[n], low: q.low[n], close: q.close[n], volume: q.volume?.[n] || 0 });
      });
      const m = res.meta;
      return {
        symbol, range, currency: m.currency, exchange: m.fullExchangeName || m.exchangeName,
        price: m.regularMarketPrice ?? candles.at(-1)?.close, prevClose: m.chartPreviousClose ?? m.previousClose,
        marketTime: (m.regularMarketTime || 0) * 1000, name: m.shortName || m.longName || symbol, candles,
      };
    } catch (e) {
      lastErr = e;
      hostIdx = (hostIdx + 1) % hosts.length;
    }
  }
  throw lastErr;
}

// Fetch quotes for many symbols with limited concurrency.
async function quotes(symbols, concurrency = 4) {
  const out = {};
  let n = 0;
  async function worker() {
    while (n < symbols.length) {
      const s = symbols[n++];
      try {
        const c = await chart(s, '1D');
        out[s] = {
          symbol: s, name: c.name, price: c.price, prevClose: c.prevClose, currency: c.currency,
          change: c.prevClose ? c.price / c.prevClose - 1 : 0, marketTime: c.marketTime,
          spark: c.candles.map((x) => x.close), ok: true,
        };
      } catch (e) {
        out[s] = { symbol: s, ok: false, error: e.message };
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return out;
}

module.exports = { DEFAULT_WATCHLIST, RANGES, chart, quotes };
