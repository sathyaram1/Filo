// Verifica #1073 giro 5: una release sotto un tag non v*, col tag v<versione> scritto nel suo latest.yml, non deve
// arrivare a nessuno: né annunciata, né raccomandata con l'avviso «scaricala da filo.red» su Mac e Linux.
// Logica pura sul cammino vero del provider GitHub di electron-updater: niente Electron.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const U = require(join(ROOT, 'src', 'main', 'updater.js'));
const { AppUpdater } = require('electron-updater/out/AppUpdater');
const { GitHubProvider } = require('electron-updater/out/providers/GitHubProvider');
const semver = createRequire(require.resolve('electron-updater'))('semver');

function memoriaFinta() {
  const carte = [];
  let id = 0;
  globalThis.SN_FILO_MEMORY = {
    listNotifications: async ({ includeDismissed = false } = {}) => carte.filter((n) => includeDismissed || !n.dismissed),
    addNotification: async (n) => { const e = { ...n, id: `n${++id}`, dismissed: false }; carte.unshift(e); return e; },
    dismissNotification: async (nid) => { const n = carte.find((x) => x.id === nid); if (n) n.dismissed = true; return carte; },
  };
  return carte;
}

function releaseOstile(piattaforma) {
  const tagVero = 'x1';
  const yml = 'version: 99.0.0\ntag: v99.0.0\nfiles:\n  - url: Filo-Mac.zip\n    sha512: AAAA\n    size: 1\npath: Filo-Mac.zip\nsha512: AAAA\n';
  const feed = `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><id>1</id>`
    + `<link rel="alternate" type="text/html" href="https://github.com/sathyaram1/Filo/releases/tag/${tagVero}"/>`
    + `<title>${tagVero}</title><content>n</content><updated>2026-10-12T00:00:00Z</updated></entry></feed>`;
  const au = Object.create(AppUpdater.prototype);
  Object.assign(au, {
    currentVersion: semver.parse('0.2.237'), allowDowngrade: false, autoDownload: false, allowPrerelease: false,
    _logger: { info() {}, warn() {}, error() {} }, isUpdateSupported: () => true, isUserWithinRollout: () => true,
  });
  const gh = new GitHubProvider({ provider: 'github', owner: 'sathyaram1', repo: 'Filo' }, au, {
    isUseMultipleRangeRequest: true, platform: piattaforma, executor: { request: async () => yml },
  });
  gh.httpRequest = async (url) => (String(url).endsWith('.atom') ? feed : JSON.stringify({ tag_name: tagVero }));
  Object.assign(au, {
    app: { whenReady: async () => {} }, clientPromise: Promise.resolve(gh),
    stagingUserIdPromise: { value: Promise.resolve(null) }, requestHeaders: null,
  });
  const visti = [];
  au.on('update-available', (i) => visti.push(i.version));
  return { au, visti };
}

for (const piattaforma of ['darwin', 'linux', 'win32']) {
  test(`r1 ${piattaforma}: la release x1 che si dichiara v99.0.0 non si annuncia e non manda a scaricarla`, async () => {
    U.perProva({ piattaforma, versione: '0.2.237', avvisoVero: false });
    const carte = memoriaFinta();
    const { au, visti } = releaseOstile(piattaforma);
    U.avviaAggiornatore(au, { automatici: true });
    au.autoDownload = false;
    try { await au.doCheckForUpdates(); } catch (_) { /* il cancello che rifiuta */ }
    // Annunciata, lo scaricamento da .../download/v99.0.0/ risponde 404: electron-updater emette l'errore.
    if (visti.length) au.emit('error', new Error('HttpError: 404'));
    await new Promise((r) => setTimeout(r, 50));
    expect(visti, 'la versione 99.0.0 della release x1 viene annunciata').toEqual([]);
    const testi = carte.filter((n) => !n.dismissed).map((n) => n.text).join('\n');
    expect(testi, 'Filo invita a scaricare da filo.red una versione che esiste solo nella release x1').not.toContain('99.0.0');
  });
}
