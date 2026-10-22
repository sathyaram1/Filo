// L'aggiornamento automatico installa solo una release sotto il tag v<versione> (#1073): la regola sui tag di GitHub
// protegge solo i v*, e una release «più recente» sotto un altro tag, creata da un ramo, non deve arrivare a nessuno.
// Il controllo gira sul cammino vero di electron-updater, col suo prototipo, senza rete né Electron.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const R = require(join(ROOT, 'src', 'main', 'aggiornamentoRegole.js'));
const U = require(join(ROOT, 'src', 'main', 'updater.js'));
// Niente Firestore nelle prove: dove non si dice altro, nessuna àncora in tutta la raccolta.
U.ancoraPerProva();
const { AppUpdater } = require('electron-updater/out/AppUpdater');
// Il semver di electron-updater: una SemVer di un'altra copia non la riconosce.
const semver = createRequire(require.resolve('electron-updater'))('semver');

function aggiornatore(info) {
  const au = Object.create(AppUpdater.prototype);
  Object.assign(au, {
    currentVersion: semver.parse('0.2.233'),
    allowDowngrade: false,
    autoDownload: false,
    _logger: { info() {}, warn() {}, error() {} },
    isUpdateSupported: () => true,
    isUserWithinRollout: () => true,
    getUpdateInfoAndProvider: async () => ({ info, provider: {} }),
    checkForUpdates: async () => null,
  });
  const visti = [];
  for (const ev of ['update-available', 'update-not-available']) au.on(ev, () => visti.push(ev));
  return { au, visti };
}

test('la regola: tag uguale a v più la versione dichiarata, e niente tag solo fuori da GitHub', () => {
  assert.equal(R.tagAccettato({ version: '0.2.234', tag: 'v0.2.234' }), true);
  assert.equal(R.tagAccettato({ version: '99.0.0', tag: '99.0.0' }), false, 'senza la v la regola sui tag non lo protegge');
  assert.equal(R.tagAccettato({ version: '99.0.0', tag: 'x1' }), false);
  assert.equal(R.tagAccettato({ version: '99.0.0', tag: 'v0.2.234' }), false, 'una versione dichiarata diversa dal tag');
  assert.equal(R.tagAccettato({ version: '0.2.234' }), true);
});

test('una release sotto un tag senza v non si annuncia né si scarica, quella giusta sì', async () => {
  for (const tag of ['99.0.0', 'x1']) {
    const { au, visti } = aggiornatore({ version: '99.0.0', tag, files: [] });
    await U.avviaAggiornatore(au, { automatici: false });
    await assert.rejects(au.doCheckForUpdates(), /rifiutata/, `la release sotto il tag ${tag} passa il controllo`);
    assert.deepEqual(visti, [], `la release sotto il tag ${tag} è stata annunciata`);
  }

  const { au, visti } = aggiornatore({ version: '0.2.234', tag: 'v0.2.234', files: [] });
  await U.avviaAggiornatore(au, { automatici: false });
  const r = await au.doCheckForUpdates();
  assert.equal(r.isUpdateAvailable, true);
  assert.deepEqual(visti, ['update-available']);
});

test('collegato due volte, il cancello non si impila', async () => {
  const { au } = aggiornatore({ version: '0.2.234', tag: 'v0.2.234', files: [] });
  await U.avviaAggiornatore(au, { automatici: false });
  const primo = au.getUpdateInfoAndProvider;
  await U.avviaAggiornatore(au, { automatici: false });
  assert.equal(au.getUpdateInfoAndProvider, primo);
});

// Il cammino vero col provider GitHub di electron-updater: feed, «/latest» e latest.yml finti, il resto suo.
const { GitHubProvider } = require('electron-updater/out/providers/GitHubProvider');

function conGitHub({ tagVero, yml, piattaforma = 'win32' }) {
  const feed = `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><id>1</id>` +
    `<link rel="alternate" type="text/html" href="https://github.com/sathyaram1/Filo/releases/tag/${tagVero}"/>` +
    `<title>${tagVero}</title><content>n</content><updated>2026-10-12T00:00:00Z</updated></entry></feed>`;
  const { au, visti } = aggiornatore(null);
  au.allowPrerelease = false;
  const gh = new GitHubProvider({ provider: 'github', owner: 'sathyaram1', repo: 'Filo' }, au, {
    isUseMultipleRangeRequest: true, platform: piattaforma, executor: { request: async () => yml },
  });
  gh.httpRequest = async (url) => (String(url).endsWith('.atom') ? feed : JSON.stringify({ tag_name: tagVero }));
  // Il getUpdateInfoAndProvider vero del prototipo, non uno finto: il cancello deve agganciarsi a quello che gira.
  delete au.getUpdateInfoAndProvider;
  Object.assign(au, {
    app: { whenReady: async () => {} },
    clientPromise: Promise.resolve(gh),
    stagingUserIdPromise: { value: Promise.resolve(null) },
    requestHeaders: null,
  });
  return { au, visti };
}

test('il punto a cui si aggancia il cancello è quello che electron-updater chiama davvero', () => {
  assert.equal(typeof AppUpdater.prototype.getUpdateInfoAndProvider, 'function',
    'electron-updater non ha più getUpdateInfoAndProvider: il cancello dei tag ferma tutti gli aggiornamenti');
  assert.match(AppUpdater.prototype.doCheckForUpdates.toString(), /this\.getUpdateInfoAndProvider\(\)/,
    'doCheckForUpdates non passa più da getUpdateInfoAndProvider: il cancello dei tag non lo vede');
});

test('senza quel punto gli aggiornamenti si fermano, non partono senza cancello', async () => {
  const au = Object.create(AppUpdater.prototype);
  au.getUpdateInfoAndProvider = undefined;
  au.leggi = async () => ({ info: { version: '99.0.0', tag: 'x1', files: [] }, provider: {} });
  Object.assign(au, {
    currentVersion: semver.parse('0.2.233'), allowDowngrade: false, autoDownload: false,
    _logger: { info() {}, warn() {}, error() {} },
    isUpdateSupported: () => true, isUserWithinRollout: () => true,
  });
  // Il corpo di doCheckForUpdates con la chiamata rinominata, come dopo un aggiornamento della dipendenza.
  au.doCheckForUpdates = async function () {
    const r = await this.leggi();
    if (await this.isUpdateAvailable(r.info)) this.emit('update-available', r.info);
    return r;
  };
  au.checkForUpdates = function () { return this.doCheckForUpdates(); };
  const visti = [];
  au.on('update-available', () => visti.push('update-available'));
  await U.avviaAggiornatore(au, { automatici: false });
  await assert.rejects(au.doCheckForUpdates(), /aggiornamenti fermi/);
  await assert.rejects(au.checkForUpdates(), /aggiornamenti fermi/);
  await assert.rejects(au.downloadUpdate(), /aggiornamenti fermi/);
  assert.deepEqual(visti, []);
});

test('gli aggiornatori veri di ogni sistema passano dal cancello, un finto delle prove no', async () => {
  const EU = require('electron-updater');
  for (const nome of ['NsisUpdater', 'MacUpdater', 'AppImageUpdater']) {
    const au = Object.create(EU[nome].prototype);
    au.getUpdateInfoAndProvider = undefined;
    au._logger = { info() {}, warn() {}, error() {} };
    au.isUpdaterActive = () => true;
    await U.avviaAggiornatore(au, { automatici: false });
    await assert.rejects(au.checkForUpdates(), /aggiornamenti fermi/, `${nome} senza punto d'aggancio non si ferma`);
  }
  const ascolta = new (require('node:events').EventEmitter)();
  let controlli = 0;
  ascolta.checkForUpdates = async () => { controlli++; return null; };
  await U.avviaAggiornatore(ascolta, { automatici: false });
  const prima = controlli;
  await ascolta.checkForUpdates();
  assert.equal(controlli, prima + 1, 'un aggiornatore finto, fuori da electron-updater, viene fermato come una libreria rinominata');
});

const yml = (righe, file) => `version: 99.0.0\n${righe}files:\n  - url: ${file}\n    sha512: AAAA\n    size: 1\npath: ${file}\nsha512: AAAA\n`;

test('il tag e i percorsi scritti nel latest.yml di una release non nostra non la fanno passare', async () => {
  const casi = [
    ['x1', yml('tag: v99.0.0\n', '../x1/Filo-Setup.exe'), 'tag dichiarato nel file e file preso da x1'],
    ['x1', yml('tag: ~\n', '../x1/Filo-Setup.exe'), 'tag tolto dal file'],
    ['x1', yml('tag: v99.0.0\n', '../../../../altro/repo/releases/download/v99.0.0/Filo-Setup.exe'), 'file preso da un altro repo'],
    ['x1', yml('tag: v99.0.0\n', '..%2Fx1%2FFilo-Setup.exe'), 'barre codificate'],
    ['x1', yml('tag: v99.0.0\n', 'https://esempio.test/Filo-Setup.exe'), 'indirizzo intero'],
  ];
  for (const [tagVero, testo, cosa] of casi) {
    const { au, visti } = conGitHub({ tagVero, yml: testo });
    await U.avviaAggiornatore(au, { automatici: false });
    await assert.rejects(au.doCheckForUpdates(), /rifiutata/, `passa: ${cosa}`);
    assert.deepEqual(visti, [], `annunciata: ${cosa}`);
  }

  const { au, visti } = conGitHub({ tagVero: 'v99.0.0', yml: yml('', 'Filo Setup 99.0.0.exe') });
  await U.avviaAggiornatore(au, { automatici: false });
  const r = await au.doCheckForUpdates();
  assert.equal(r.isUpdateAvailable, true, 'la release vera sotto v<versione> deve passare');
  assert.deepEqual(visti, ['update-available']);
});

test('fileDiRilascio: solo https, il nostro repo, la cartella v<versione>, un nome semplice', () => {
  const base = { versione: '1.2.3', owner: 'o', repo: 'r' };
  const ok = (u) => R.fileDiRilascio({ ...base, urls: [u] });
  assert.equal(ok('https://github.com/o/r/releases/download/v1.2.3/Filo-Setup.exe'), true);
  assert.equal(ok('http://github.com/o/r/releases/download/v1.2.3/Filo-Setup.exe'), false);
  assert.equal(ok('https://github.com/o/r/releases/download/v1.2.4/Filo-Setup.exe'), false);
  assert.equal(ok('https://github.com/o/r/releases/download/x1/Filo-Setup.exe'), false);
  assert.equal(ok('https://github.com/o/r/releases/download/v1.2.3/a%2Fb.exe'), false);
  assert.equal(ok('https://github.com/o/r/releases/download/v1.2.3/'), false);
  assert.equal(ok('https://evil.test/o/r/releases/download/v1.2.3/Filo-Setup.exe'), false);
  assert.equal(R.fileDiRilascio({ ...base, urls: [] }), false);
  assert.equal(R.fileDiRilascio({ ...base, owner: '', urls: ['https://github.com//r/releases/download/v1.2.3/a'] }), false);
});

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

// Annunciata, una versione che non esiste fallisce lo scaricamento, e su Mac e Linux l'avviso manda a filo.red, che dà
// la release più recente qualunque tag abbia: quella che si è dichiarata v<versione> nel suo latest.yml.
test('il tag che conta è quello che dice GitHub: un «tag:» nel latest.yml non fa annunciare né consigliare la release', async () => {
  const dichiarata = yml('tag: v99.0.0\n', 'Filo-Mac.zip');
  try {
    for (const piattaforma of ['darwin', 'linux', 'win32']) {
      for (const [tagVero, cosa] of [
        ['x1', 'release sotto x1'],
        ['v0.2.100', 'release vecchia riscritta e rimarcata come più recente'],
      ]) {
        U.perProva({ piattaforma, versione: '0.2.233', avvisoVero: false });
        const carte = memoriaFinta();
        const { au, visti } = conGitHub({ tagVero, yml: dichiarata, piattaforma });
        await U.avviaAggiornatore(au, { automatici: true });
        await assert.rejects(au.doCheckForUpdates(), /rifiutata/, `${piattaforma}, passa: ${cosa}`);
        au.emit('error', new Error('HttpError: 404'));
        await new Promise((r) => setTimeout(r, 20));
        assert.deepEqual(visti, [], `${piattaforma}, annunciata: ${cosa}`);
        assert.deepEqual(carte.map((n) => n.text), [], `${piattaforma}, avviso per una versione non nostra: ${cosa}`);
      }
    }
  } finally {
    U.perProva({ piattaforma: 'win32' });
    delete globalThis.SN_FILO_MEMORY;
  }
});

test('senza la domanda a GitHub sul tag vero gli aggiornamenti si fermano, e un tag che non arriva non passa', async () => {
  const { au } = conGitHub({ tagVero: 'v99.0.0', yml: yml('', 'Filo-Setup.exe') });
  const gh = await au.clientPromise;
  // Il provider la usa per sé: sparisce solo dopo, come in una libreria che l'ha rinominata.
  gh.getLatestVersion = async function () {
    const r = await GitHubProvider.prototype.getLatestVersion.call(this);
    this.getLatestTagName = undefined;
    return r;
  };
  await U.avviaAggiornatore(au, { automatici: false });
  await assert.rejects(au.doCheckForUpdates(), /aggiornamenti fermi/);

  const altro = conGitHub({ tagVero: 'v99.0.0', yml: yml('', 'Filo-Setup.exe') });
  const ghAltro = await altro.au.clientPromise;
  ghAltro.getLatestVersion = async function () {
    const r = await GitHubProvider.prototype.getLatestVersion.call(this);
    this.getLatestTagName = async () => null;
    return r;
  };
  await U.avviaAggiornatore(altro.au, { automatici: false });
  await assert.rejects(altro.au.doCheckForUpdates(), /rifiutata/);
  assert.deepEqual(altro.visti, []);

  assert.equal(typeof GitHubProvider.prototype.getLatestTagName, 'function',
    'electron-updater non ha più getLatestTagName: il cancello dei tag ferma tutti gli aggiornamenti');
});

test('tagDiGitHubAccettato: solo v più la versione, e niente tag non passa', () => {
  assert.equal(R.tagDiGitHubAccettato('v1.2.3', '1.2.3'), true);
  assert.equal(R.tagDiGitHubAccettato('1.2.3', '1.2.3'), false);
  assert.equal(R.tagDiGitHubAccettato('V1.2.3', '1.2.3'), false);
  assert.equal(R.tagDiGitHubAccettato(null, '1.2.3'), false);
  assert.equal(R.tagDiGitHubAccettato(undefined, undefined), false);
  assert.equal(R.tagDiGitHubAccettato('vundefined', undefined), false);
});
