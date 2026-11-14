const { contextBridge, ipcRenderer } = require('electron');

const call = async (ch, ...args) => {
  const r = await ipcRenderer.invoke(ch, ...args);
  if (!r.ok) throw new Error(r.error);
  return r.data;
};
const on = (ch) => (fn) => {
  const h = (_e, v) => fn(v);
  ipcRenderer.on(ch, h);
  return () => ipcRenderer.removeListener(ch, h);
};

contextBridge.exposeInMainWorld('lodestar', {
  info: () => call('app:info'),
  openExternal: (u) => call('app:openExternal', u),
  settings: { get: () => call('settings:get'), set: (p) => call('settings:set', p) },
  feeds: {
    snapshot: () => call('feeds:snapshot'), refresh: () => call('feeds:refresh'), satellite: () => call('feeds:satellite'),
    onEvents: on('feeds:events'), onStatus: on('feeds:status'), onFocus: on('events:focus'),
  },
  markets: {
    quotes: () => call('markets:quotes'), chart: (s, r) => call('markets:chart', s, r), lookup: (s) => call('markets:lookup', s),
    onQuotes: on('markets:quotes'),
  },
  ledger: {
    state: () => call('ledger:state'), order: (o) => call('ledger:order', o), close: (s) => call('ledger:close', s),
    bracket: (s, stop, target) => call('ledger:bracket', s, stop, target),
    createAccount: (n, c) => call('ledger:createAccount', n, c), switchAccount: (id) => call('ledger:switchAccount', id),
    resetAccount: () => call('ledger:resetAccount'), deleteAccount: (id) => call('ledger:deleteAccount', id),
    rules: (r) => call('ledger:rules', r), exportCsv: () => call('ledger:exportCsv'),
    onState: on('ledger:state'),
  },
  updater: { check: () => call('updater:check'), install: () => call('updater:install'), onStatus: on('updater:status') },
});
