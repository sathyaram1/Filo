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
const A = require(join(ROOT, 'src', 'main', 'ancoraRilascio.js'));
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

// ── L'àncora del server (#1501) ──
// Chi ha un token che scrive i contenuti del repo sostituisce installer e latest.yml di una release senza toccare il
// tag: tag e percorsi restano giusti, cambia solo l'impronta. Passa solo l'impronta che il server ha ancorato.

const CONTENUTO = 'MZ installatore vero';
const SHA_VERO = createHash('sha512').update(CONTENUTO).digest('base64');
const SHA_SOSTITUITO = createHash('sha512').update('MZ installatore sostituito').digest('base64');
const TAG = 'v0.2.240';

// L'AppUpdater vero col GitHubProvider vero: finti github.com, la cache dello scaricamento e l'installatore.
const { BaseUpdater } = require('electron-updater/out/BaseUpdater.js');
class ReleaseRiscritta extends BaseUpdater {
  constructor({ sha, piattaforma }) {
    const allaChiusura = [];
    super(null, { version: '0.2.233', isPackaged: true, whenReady: async () => {}, onQuit: (f) => allaChiusura.push(f), quit() {} });
    this._logger = { info() {}, warn() {}, error() {}, debug() {} };
    Object.assign(this, { allaChiusura, chiamateDownload: 0, scaricamenti: 0, installazioni: 0 });
    const executor = {
      async request(o) {
        const p = String(o.path);
        if (p.endsWith('/releases/latest')) return JSON.stringify({ tag_name: TAG });
        if (p.endsWith('/releases.atom')) {
          return '<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom"><entry>'
            + `<link rel="alternate" type="text/html" href="https://github.com/sathyaram1/Filo/releases/tag/${TAG}"/>`
            + `<title>${TAG}</title><content type="html">note</content></entry></feed>`;
        }
        if (p.startsWith(`/sathyaram1/Filo/releases/download/${TAG}/`) && /latest[^/]*\.yml$/.test(p)) {
          return `version: 0.2.240\nfiles:\n  - url: Filo-Setup.exe\n    sha512: ${sha}\n    size: 20\n`
            + `path: Filo-Setup.exe\nsha512: ${sha}\nreleaseDate: '2026-10-21T11:00:00.000Z'\n`;
        }
        throw new Error(`richiesta inattesa: ${p}`);
      },
    };
    this.github = new GitHubProvider({ provider: 'github', owner: 'sathyaram1', repo: 'Filo' }, this,
      { executor, isUseMultipleRangeRequest: false, platform: piattaforma });
    const vero = this.downloadUpdate.bind(this);
    this.downloadUpdate = (...a) => { this.chiamateDownload += 1; return vero(...a); };
  }

  async getUpdateInfoAndProvider() {
    return { info: await this.github.getLatestVersion(), provider: this.github };
  }

  async doDownloadUpdate({ updateInfoAndProvider }) {
    this.scaricamenti += 1;
    const cache = cartellaTemporanea('filo-ancora-cache-');
    const file = join(cache, 'Filo-Setup.exe');
    writeFileSync(file, CONTENUTO);
    writeFileSync(join(cache, 'update-info.json'),
      JSON.stringify({ fileName: 'Filo-Setup.exe', sha512: updateInfoAndProvider.info.files[0].sha512, isAdminRightsRequired: false }));
    this.dispatchUpdateDownloaded({ ...updateInfoAndProvider.info, downloadedFile: file });
    this.addQuitHandler();
    return [file];
  }

  install() { this.installazioni += 1; return true; }
  quitAndInstall() { this.installazioni += 1; }
  chiudi() { for (const f of this.allaChiusura) f(0); }
}

const calma = () => new Promise((r) => setImmediate(r));
const ANCORATA = async (tag) => ({ letta: true, impronte: tag === TAG ? { 'Filo-Setup.exe': SHA_VERO } : null, altre: true });
const SENZA_ANCORA = async () => ({ letta: true, impronte: null, altre: true });
const ILLEGGIBILE = async () => ({ letta: false });

async function avviaRelease({ sha, ancora, piattaforma = 'win32', modo, automatici = true }) {
  const dati = cartellaTemporanea('filo-ancora-dati-');
  const { registro } = U.perProva({ piattaforma, versione: '0.2.233', cartella: dati, avvisoVero: false, ancora });
  const carte = memoriaFinta();
  const u = new ReleaseRiscritta({ sha, piattaforma });
  await U.avviaAggiornatore(u, { automatici, chiesta: null, modo });
  await calma();
  const file = join(dati, 'aggiornamento-pronto.json');
  const ricordo = () => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null);
  return { u, registro, carte, ricordo };
}

const SISTEMI = [
  { nome: 'Windows', piattaforma: 'win32' },
  { nome: 'Windows, installa alla chiusura', piattaforma: 'win32', modo: 'chiusura' },
  { nome: 'Linux', piattaforma: 'linux' },
];
const CASI_RIFIUTATI = [
  { cosa: 'impronta diversa da quella ancorata', sha: SHA_SOSTITUITO, ancora: ANCORATA },
  { cosa: 'release senza àncora', sha: SHA_SOSTITUITO, ancora: SENZA_ANCORA },
  { cosa: 'release senza àncora, anche con l\'impronta del file vero', sha: SHA_VERO, ancora: SENZA_ANCORA },
];

for (const s of SISTEMI) {
  test(`tag e percorsi giusti ma impronta non ancorata: mai a downloadUpdate né all'installazione (${s.nome})`, async () => {
    try {
      for (const caso of CASI_RIFIUTATI) {
        const { u, registro, carte, ricordo } = await avviaRelease({ ...s, ...caso, automatici: true });
        assert.equal(u.chiamateDownload, 0, `${caso.cosa}: chiesto lo scaricamento`);
        assert.equal(u.scaricamenti, 0, `${caso.cosa}: scaricata`);
        assert.equal(ricordo(), null);
        u.chiudi();
        assert.equal(u.installazioni, 0, `${caso.cosa}: installata alla chiusura`);
        const impostazioni = { aggiornamenti: { automatici: true, ...(s.modo ? { installa: s.modo } : {}) } };
        assert.equal(await U.installaAllAvvioSeServe(impostazioni, { forza: true }), false);
        assert.equal(registro.lanciati.length, 0, `${caso.cosa}: all'apertura dopo è partito l'installatore`);
        assert.deepEqual(carte.filter((n) => !n.dismissed).map((n) => n.text), [], `${caso.cosa}: una carta promette la versione`);

        const r = await U.installaAggiornamento();
        await calma();
        assert.equal(r.stato, 'rifiutata', `${caso.cosa}: ${JSON.stringify(r)}`);
        const c = await U.aggiornaDaChat({ riavvio: true });
        await calma();
        assert.equal(c.esito, 'rifiutata', c.frase);
        assert.equal(u.chiamateDownload, 0, `${caso.cosa}: «Installa» o la chat hanno chiesto lo scaricamento`);
        u.chiudi();
        assert.equal(u.installazioni, 0);
      }
    } finally {
      U.perProva({ piattaforma: 'win32' });
      delete globalThis.SN_FILO_MEMORY;
    }
  });
}

test('con l\'impronta uguale all\'àncora scarica come prima, e il ricordo tiene quella ancorata', async () => {
  try {
    for (const s of SISTEMI) {
      const { u, registro, ricordo } = await avviaRelease({ ...s, sha: SHA_VERO, ancora: ANCORATA, automatici: true });
      assert.equal(u.scaricamenti, 1, `${s.nome}: la versione ancorata non si scarica`);
      assert.equal(ricordo()?.versione, '0.2.240', s.nome);
      assert.equal(ricordo()?.sha512, SHA_VERO, s.nome);
      if (s.piattaforma === 'win32' && !s.modo) {
        assert.equal(await U.installaAllAvvioSeServe({ aggiornamenti: { automatici: true } }, { forza: true }), true);
        assert.equal(registro.lanciati.length, 1, 'all\'apertura dopo l\'installatore ancorato non parte');
      } else {
        u.chiudi();
        assert.equal(u.installazioni, 1, `${s.nome}: alla chiusura non si installa`);
      }
    }
  } finally {
    U.perProva({ piattaforma: 'win32' });
    delete globalThis.SN_FILO_MEMORY;
  }
});

test('àncora che non si legge: niente scaricamento, lo si dice come un controllo non riuscito e si riprova dopo', async () => {
  try {
    const { u } = await avviaRelease({ sha: SHA_VERO, ancora: ILLEGGIBILE, automatici: true });
    assert.equal(u.chiamateDownload, 0);
    const c = await U.aggiornaDaChat({ riavvio: true });
    await calma();
    assert.equal(c.esito, 'errore', c.frase);
    assert.doesNotMatch(c.frase, /controllo di sicurezza/, 'Firestore che non risponde non rende falsa la release');
    assert.equal(u.chiamateDownload, 0);
    U.ancoraPerProva(ANCORATA);
    await u.checkForUpdates();
    await calma();
    assert.equal(u.scaricamenti, 1, 'al controllo dopo, con l\'àncora che si legge, non scarica');
  } finally {
    U.perProva({ piattaforma: 'win32' });
    delete globalThis.SN_FILO_MEMORY;
  }
});

test('nessuna àncora in tutta la raccolta: il server non ne scrive ancora e vale il solo latest.yml, come prima', async () => {
  try {
    const { u } = await avviaRelease({ sha: SHA_VERO, ancora: null, automatici: true });
    assert.equal(u.scaricamenti, 1);
  } finally {
    U.perProva({ piattaforma: 'win32' });
    delete globalThis.SN_FILO_MEMORY;
  }
});

test('esitoAncora: ogni file del feed con la sua impronta ancorata, o niente', () => {
  const impronte = { 'Filo-Mac.zip': 'Z', 'Filo-Mac.dmg': 'D' };
  const letta = { letta: true, impronte, altre: true };
  const esito = (file, ancora = letta) => R.esitoAncora({ file, ancora });
  assert.equal(esito([{ nome: 'Filo-Mac.zip', sha512: 'Z' }, { nome: 'Filo-Mac.dmg', sha512: 'D' }]).esito, 'coincide');
  assert.equal(esito([{ nome: 'Filo-Mac.zip', sha512: 'Z' }]).esito, 'coincide');
  assert.equal(esito([{ nome: 'Filo-Mac.zip', sha512: 'Z' }, { nome: 'altro.zip', sha512: 'Z' }]).esito, 'diversa', 'un file in più non ancorato');
  assert.equal(esito([{ nome: 'Filo-Mac.zip', sha512: 'X' }]).esito, 'diversa');
  assert.equal(esito([{ nome: 'Filo-Mac.zip' }]).esito, 'diversa', 'senza sha512 (solo sha2) non si confronta');
  assert.equal(esito([{ nome: 'Filo-Mac.zip', sha512: '' }]).esito, 'diversa');
  assert.equal(esito([]).esito, 'diversa');
  assert.equal(esito(null).esito, 'diversa');
  assert.equal(esito([{ nome: 'constructor', sha512: String(Object) }], { letta: true, impronte: {}, altre: true }).esito, 'diversa');
  assert.equal(esito([{ nome: '__proto__', sha512: 'x' }], { letta: true, impronte: {}, altre: true }).esito, 'diversa');
  assert.equal(esito([{ nome: 'Filo-Mac.zip', sha512: 'Z' }], { letta: true, impronte: null, altre: true }).esito, 'manca');
  assert.equal(esito([{ nome: 'Filo-Mac.zip', sha512: 'Z' }], { letta: true, impronte: null }).esito, 'manca', 'nel dubbio il controllo è acceso');
  assert.equal(esito([{ nome: 'Filo-Mac.zip', sha512: 'Z' }], { letta: true, impronte: null, altre: false }).esito, 'spenta');
  assert.equal(esito([{ nome: 'Filo-Mac.zip', sha512: 'Z' }], { letta: false }).esito, 'illeggibile');
  assert.equal(esito([{ nome: 'Filo-Mac.zip', sha512: 'Z' }], null).esito, 'illeggibile');
});

test('fileDaAncorare: i file che electron-updater può scaricare, coi nomi e le impronte del yml', () => {
  assert.deepEqual(R.fileDaAncorare({ files: [{ url: 'a.exe', sha512: 'A' }], path: 'vecchio.exe', sha512: 'V' }), [{ nome: 'a.exe', sha512: 'A' }]);
  assert.deepEqual(R.fileDaAncorare({ path: 'a.exe', sha512: 'A' }), [{ nome: 'a.exe', sha512: 'A' }]);
  assert.deepEqual(R.fileDaAncorare({ files: [], path: 'a.exe', sha512: 'A' }), [{ nome: 'a.exe', sha512: 'A' }]);
  assert.deepEqual(R.fileDaAncorare({ files: [{ url: 'a.exe', sha512: 'A' }], packages: { x64: { path: 'p.7z', sha512: 'P' } } }),
    [{ nome: 'a.exe', sha512: 'A' }, { nome: 'p.7z', sha512: 'P' }]);
  assert.deepEqual(R.fileDaAncorare({ files: [{ url: 'a.exe', sha2: 'H' }] }), [{ nome: 'a.exe', sha512: undefined }]);
  assert.deepEqual(R.fileDaAncorare(null), []);
});

test('impronteDellAncora: legge il documento come lo dà Firestore, e scarta le voci fuori forma', () => {
  const doc = { fields: { versione: { stringValue: '0.2.240' }, file: { mapValue: { fields: {
    'Filo-Setup.exe': { mapValue: { fields: { sha512: { stringValue: 'S' }, ancoratoIl: { timestampValue: '2026-10-21T11:00:00Z' } } } },
    'Filo Mac.dmg': { mapValue: { fields: { sha512: { stringValue: 'D' } } } },
    'vuoto.zip': { mapValue: { fields: { sha512: { stringValue: '' } } } },
    'numero.zip': { mapValue: { fields: { sha512: { integerValue: '3' } } } },
    'piatto.zip': { stringValue: 'S' },
  } } } } };
  assert.deepEqual({ ...R.impronteDellAncora(doc) }, { 'Filo-Setup.exe': 'S', 'Filo Mac.dmg': 'D' });
  assert.deepEqual({ ...R.impronteDellAncora({ fields: {} }) }, {});
  assert.deepEqual({ ...R.impronteDellAncora(null) }, {});
  assert.equal(Object.getPrototypeOf(R.impronteDellAncora(doc)), null);
});

test('improntaDaRicordare: con l\'àncora accesa il ricordo tiene solo un\'impronta ancorata di quella versione', () => {
  const ancora = { versione: '0.2.240', impronte: { 'Filo-Setup.exe': 'S' } };
  assert.equal(R.improntaDaRicordare({ versione: '0.2.240', sha512: 'S', ancora }), 'S');
  assert.equal(R.improntaDaRicordare({ versione: '0.2.240', sha512: 'X', ancora }), null);
  assert.equal(R.improntaDaRicordare({ versione: '0.2.241', sha512: 'S', ancora }), null);
  assert.equal(R.improntaDaRicordare({ versione: '0.2.240', sha512: null, ancora }), null);
  assert.equal(R.improntaDaRicordare({ versione: '0.2.240', sha512: 'X', ancora: null }), 'X', 'controllo spento: come prima');
});

function risposta(status, corpo) {
  return { status, ok: status >= 200 && status < 300, json: async () => corpo };
}

test('leggiAncora: il documento del tag, e se manca se la raccolta ha almeno un\'àncora', async () => {
  const chieste = [];
  const con = (...risposte) => async (url) => {
    chieste.push(url);
    const r = risposte.shift();
    if (r instanceof Error) throw r;
    return r;
  };
  const doc = { fields: { file: { mapValue: { fields: { 'Filo-Setup.exe': { mapValue: { fields: { sha512: { stringValue: 'S' } } } } } } } } };
  assert.deepEqual(await A.leggiAncora(TAG, con(risposta(200, doc))), { letta: true, impronte: Object.assign(Object.create(null), { 'Filo-Setup.exe': 'S' }), altre: true });
  assert.match(chieste[0], /\/documents\/ancoreRilascio\/v0\.2\.240\?key=/);
  assert.equal(R.COLLEZIONE_ANCORE, 'ancoreRilascio');

  assert.deepEqual(await A.leggiAncora(TAG, con(risposta(404), risposta(200, {}))), { letta: true, impronte: null, altre: false });
  assert.match(chieste.at(-1), /\/documents\/ancoreRilascio\?pageSize=1&/);
  assert.deepEqual(await A.leggiAncora(TAG, con(risposta(404), risposta(200, { documents: [{ name: 'x' }] }))), { letta: true, impronte: null, altre: true });

  for (const [cosa, f] of [
    ['regola non pubblicata', con(risposta(403))],
    ['server giù', con(risposta(503))],
    ['rete assente', con(new Error('ENOTFOUND'))],
    ['elenco rifiutato', con(risposta(404), risposta(403))],
    ['elenco senza rete', con(risposta(404), new Error('ECONNRESET'))],
    ['risposta non JSON', async () => ({ status: 200, ok: true, json: async () => { throw new Error('non JSON'); } })],
  ]) assert.deepEqual(await A.leggiAncora(TAG, f), { letta: false }, cosa);
});

test('l\'àncora si legge con la sessione di rete di electron-updater: proxy e filtri sono quelli con cui legge GitHub', () => {
  const { NET_SESSION_NAME } = require('electron-updater/out/electronHttpExecutor');
  const src = readFileSync(join(ROOT, 'src', 'main', 'ancoraRilascio.js'), 'utf8');
  assert.ok(src.includes(`fromPartition('${NET_SESSION_NAME}'`),
    `electron-updater usa la sessione «${NET_SESSION_NAME}»: un'àncora letta da un'altra strada può non passare dove passa GitHub`);
});
