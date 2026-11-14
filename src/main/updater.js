// Auto-updates via electron-updater. Checks on launch and every 4 hours when packaged.
// Releases are read from the "publish" target in package.json (GitHub Releases).
const { app } = require('electron');

let autoUpdater;
let send = () => {};
let log = console;
let state = { status: 'idle' };

function emit(patch) {
  state = { ...state, ...patch, at: Date.now() };
  send('updater:status', state);
}

function init(opts) {
  send = opts.send;
  log = opts.log;
  if (!app.isPackaged) {
    emit({ status: 'dev', message: 'Updates are checked in the installed app' });
    return;
  }
  ({ autoUpdater } = require('electron-updater'));
  autoUpdater.logger = log;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => emit({ status: 'checking', message: 'Checking for updates…' }));
  autoUpdater.on('update-available', (i) => emit({ status: 'downloading', version: i.version, percent: 0, message: `Downloading ${i.version}…` }));
  autoUpdater.on('update-not-available', () => emit({ status: 'current', message: `Up to date (v${app.getVersion()})` }));
  autoUpdater.on('download-progress', (p) => emit({ status: 'downloading', percent: Math.round(p.percent), message: `Downloading update ${Math.round(p.percent)}%` }));
  autoUpdater.on('update-downloaded', (i) => emit({ status: 'ready', version: i.version, message: `v${i.version} ready — restart to install` }));
  autoUpdater.on('error', (e) => {
    const msg = /404|No published versions|latest\.yml/i.test(e.message) ? 'No releases published yet' : `Update check failed`;
    log.warn('updater', e.message);
    emit({ status: 'error', message: msg });
  });
  setTimeout(() => check(false), 8000);
  setInterval(() => check(false), 4 * 3600e3);
}

async function check(manual) {
  if (!autoUpdater) {
    emit({ status: 'dev', message: 'Updates are checked in the installed app' });
    return state;
  }
  try { await autoUpdater.checkForUpdates(); } catch (e) { if (manual) emit({ status: 'error', message: 'Update check failed' }); }
  return state;
}

function install() {
  if (autoUpdater && state.status === 'ready') setImmediate(() => autoUpdater.quitAndInstall(false, true));
  return state;
}

module.exports = { init, check, install, get state() { return state; } };
