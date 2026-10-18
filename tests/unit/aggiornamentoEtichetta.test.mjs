// #1119 — Una release segnata «latest» il cui latest.yml dichiara un numero diverso dalla sua etichetta (una release
// vecchia spostata o riscritta) non si scarica e non si installa, in nessun cammino. Gira sull'electron-updater vero
// (GitHubProvider e AppUpdater): finti solo github.com, il disco dello scaricamento e l'installatore.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const U = require(join(ROOT, 'src', 'main', 'updater.js'));
const R = require(join(ROOT, 'src', 'main', 'aggiornamentoRegole.js'));
// Per nome, non per percorso: nella prova sulla fusione node_modules sta nella cartella sopra la radice.
const { BaseUpdater } = require('electron-updater/out/BaseUpdater.js');
const { GitHubProvider } = require('electron-updater/out/providers/GitHubProvider.js');

const IN_USO = '0.2.233';
const PUBBLICO = { provider: 'github', owner: 'sathyaram1', repo: 'Filo' };
const CONTENUTO = 'MZ installatore finto';
const SHA = createHash('sha512').update(CONTENUTO).digest('base64');

// Le tre risposte che GitHubProvider chiede a github.com: l'etichetta della release «latest», il feed, il suo latest.yml.
function github(feed) {
  return {
    async request(opzioni) {
      const { etichetta, numero } = feed;
      const p = String(opzioni.path);
      if (p.endsWith('/releases/latest')) return JSON.stringify({ tag_name: etichetta });
      if (p.endsWith('/releases.atom')) {
        return '<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom"><entry>'
          + `<link rel="alternate" type="text/html" href="https://github.com/sathyaram1/Filo/releases/tag/${etichetta}"/>`
          + `<title>${etichetta}</title><content type="html">note</content></entry></feed>`;
      }
      if (p.startsWith(`/sathyaram1/Filo/releases/download/${etichetta}/`) && /latest[^/]*\.yml$/.test(p)) {
        const file = feed.file || 'Filo-Setup.exe';
        return `version: ${numero}\n${feed.tagNelFile ? `tag: ${feed.tagNelFile}\n` : ''}`
          + `files:\n  - url: '${file}'\n    sha512: ${SHA}\n    size: ${CONTENUTO.length}\n`
          + `path: '${file}'\nsha512: ${SHA}\nreleaseDate: '2026-10-07T11:00:00.000Z'\n`;
      }
      throw new Error(`richiesta inattesa: ${p}`);
    },
  };
}

// L'AppUpdater vero, con autoDownload, aggancio alla chiusura e downloadUpdate suoi. Lo scaricamento scrive
// l'installatore e update-info.json come la cache di electron-updater; l'installazione si conta e basta.
class Aggiornatore extends BaseUpdater {
  constructor(feed, piattaforma) {
    const allaChiusura = [];
    super(null, { version: IN_USO, isPackaged: true, whenReady: async () => {}, onQuit: (f) => allaChiusura.push(f), quit() {} });
    this._logger = { info() {}, warn() {}, error() {}, debug() {} };
    this.allaChiusura = allaChiusura;
    this.scaricamenti = 0;
    this.installazioni = 0;
    this.github = new GitHubProvider(PUBBLICO, this, { executor: github(feed), isUseMultipleRangeRequest: false, platform: piattaforma });
  }

  async getUpdateInfoAndProvider() {
    return { info: await this.github.getLatestVersion(), provider: this.github };
  }

  async doDownloadUpdate({ updateInfoAndProvider }) {
    this.scaricamenti += 1;
    this.indirizzi = updateInfoAndProvider.provider.resolveFiles(updateInfoAndProvider.info).map((f) => f.url.pathname);
    const cache = cartellaTemporanea('filo-etichetta-cache-');
    const file = join(cache, 'Filo-Setup.exe');
    writeFileSync(file, CONTENUTO);
    writeFileSync(join(cache, 'update-info.json'), JSON.stringify({ fileName: 'Filo-Setup.exe', sha512: SHA, isAdminRightsRequired: false }));
    this.dispatchUpdateDownloaded({ ...updateInfoAndProvider.info, downloadedFile: file });
    this.addQuitHandler();
    return [file];
  }

  install() { this.installazioni += 1; return true; }
  quitAndInstall() { this.installazioni += 1; }
  chiudi() { for (const f of this.allaChiusura) f(0); }
}

let carte;
let dati;
function memoriaFinta() {
  carte = [];
  let id = 0;
  globalThis.SN_FILO_MEMORY = {
    listNotifications: async ({ includeDismissed = false } = {}) => carte.filter((n) => includeDismissed || !n.dismissed),
    addNotification: async (n) => { const e = { ...n, id: `n${++id}`, dismissed: false }; carte.unshift(e); return e; },
    dismissNotification: async (nid) => { const n = carte.find((x) => x.id === nid); if (n) n.dismissed = true; return carte; },
  };
}
const calma = () => new Promise((r) => setImmediate(r));
const ricordo = () => (existsSync(join(dati, 'aggiornamento-pronto.json')) ? JSON.parse(readFileSync(join(dati, 'aggiornamento-pronto.json'), 'utf8')) : null);
const cartaDi = (versione) => carte.find((n) => !n.dismissed && n.action?.versione === versione);

// Filo collegato all'aggiornatore vero, con lancio dell'installatore e uscita registrati invece che eseguiti.
async function avvia({ piattaforma, etichetta, numero, tagNelFile, file, automatici, modo }) {
  dati = cartellaTemporanea('filo-etichetta-dati-');
  const { registro } = U.perProva({ piattaforma, versione: IN_USO, cartella: dati, avvisoVero: false });
  const feed = { etichetta, numero, tagNelFile, file };
  const u = new Aggiornatore(feed, piattaforma);
  await U.avviaAggiornatore(u, { automatici, chiesta: null, modo });
  await calma();
  return { u, registro, feed };
}

// Le release che il workflow di un ramo può spostare: una vecchia segnata «latest», col numero gonfiato in latest.yml.
const MANOMESSA = { etichetta: 'v0.2.100', numero: '9.9.9' };
const VERA = { etichetta: 'v0.2.240', numero: '0.2.240' };
const SISTEMI = [
  { nome: 'Windows', piattaforma: 'win32' },
  { nome: 'Windows, installa alla chiusura', piattaforma: 'win32', modo: 'chiusura' },
  { nome: 'Linux', piattaforma: 'linux' },
];
const perOgniSistema = (titolo, fn) => { for (const s of SISTEMI) test(`${titolo} (${s.nome})`, () => fn(s)); };

beforeEach(() => memoriaFinta());

test('numero ed etichetta: coincidono solo se sono lo stesso numero, «v» iniziale a parte', () => {
  assert.equal(R.etichettaCoincide({ version: '0.2.240', tag: 'v0.2.240' }), true);
  assert.equal(R.etichettaCoincide({ version: '0.2.240', tag: '0.2.240' }), true);
  for (const info of [
    { version: '9.9.9', tag: 'v0.2.100' },
    { version: '0.2.240', tag: 'v0.2.24' },
    { version: '0.2.240', tag: 'vv0.2.240' },
    { version: '0.2.240', tag: 'V0.2.240' },
    { version: '0.2.240', tag: 'v0.2.240 ' },
    { version: '0.2.240' },
    { version: '0.2.240', tag: null },
    { version: '', tag: 'v' },
    { version: 240, tag: 'v240' },
    { tag: 'v0.2.240' },
    null,
    undefined,
  ]) assert.equal(R.etichettaCoincide(info), false, JSON.stringify(info));
});

test('i file si prendono solo dalla cartella della release: niente «/», «\\», «%» né «..» nei nomi', () => {
  const vera = { version: '0.2.240', tag: 'v0.2.240' };
  assert.equal(R.releaseCoerente({ ...vera, files: [{ url: 'Filo-Setup-0.2.240.exe' }], path: 'Filo-Setup-0.2.240.exe' }), true);
  assert.equal(R.releaseCoerente({ ...vera, files: [{ url: 'Filo-0.2.240.AppImage' }, { url: 'Filo-0.2.240.exe.blockmap' }] }), true);
  for (const nome of ['../v0.2.100/Filo-Setup.exe', '%2e%2e/v0.2.100/Filo-Setup.exe', '..\\v0.2.100\\Filo-Setup.exe',
    'https://evil.example/Filo-Setup.exe', '..', '', null, 42]) {
    assert.equal(R.releaseCoerente({ ...vera, files: [{ url: nome }] }), false, `files: ${nome}`);
    if (nome !== null) assert.equal(R.releaseCoerente({ ...vera, path: nome }), false, `path: ${nome}`);
    assert.equal(R.releaseCoerente({ ...vera, packages: { x64: { path: nome } } }), false, `packages: ${nome}`);
  }
  assert.equal(R.releaseCoerente({ ...vera, files: 'Filo-Setup.exe' }), false);
  assert.equal(R.releaseCoerente({ ...vera, files: [{ url: 'Filo-Setup.exe' }, { url: '../x/Filo-Setup.exe' }] }), false);
});

test('GitHubProvider mette ancora l\'etichetta accanto al numero: senza, nessun aggiornamento passerebbe più', async () => {
  for (const piattaforma of ['win32', 'linux']) {
    const info = await new Aggiornatore(VERA, piattaforma).github.getLatestVersion();
    assert.equal(info.tag, 'v0.2.240', piattaforma);
    assert.equal(info.version, '0.2.240', piattaforma);
    assert.equal(R.etichettaCoincide(info), true, piattaforma);
  }
});

test('ogni canale di pubblicazione è GitHub: l\'etichetta da confrontare la dà solo GitHubProvider', () => {
  const { build } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const canali = [build.publish, ...Object.values(build).map((v) => v && v.publish)].filter(Boolean).flat();
  assert.ok(canali.length > 0);
  for (const c of canali) assert.equal(c.provider, 'github', `${JSON.stringify(c)}: il controllo dell'etichetta lì rifiuterebbe ogni versione`);
});

perOgniSistema('acceso, all\'avvio: la release manomessa non si scarica, non si installa alla chiusura né all\'apertura dopo', async (s) => {
  const { u, registro } = await avvia({ ...s, ...MANOMESSA, automatici: true });
  assert.equal(u.autoDownload, false);
  assert.equal(u.scaricamenti, 0, 'scaricata la 9.9.9 dentro una release etichettata v0.2.100');
  assert.equal(ricordo(), null);
  u.chiudi();
  assert.equal(u.installazioni, 0, 'installata alla chiusura');
  assert.equal(await U.installaAllAvvioSeServe({ aggiornamenti: { automatici: true, ...(s.modo ? { installa: s.modo } : {}) } }, { forza: true }), false);
  assert.equal(registro.lanciati.length, 0, 'all\'apertura dopo è partito l\'installatore');
  assert.equal(registro.avvisi.length, 0, 'un avviso promette una versione che non si installerà');
  assert.equal(cartaDi('9.9.9'), undefined);
});

perOgniSistema('spento, «Installa» e «aggiornati»: la release manomessa non ha carta, non si scarica e lo si dice', async (s) => {
  const { u, registro } = await avvia({ ...s, ...MANOMESSA, automatici: false });
  assert.equal(cartaDi('9.9.9'), undefined, 'una carta «Installa» per una versione che non si può installare');
  const r = await U.installaAggiornamento();
  await calma();
  assert.equal(r.stato, 'rifiutata');
  const c = await U.aggiornaDaChat({ riavvio: true });
  await calma();
  assert.equal(c.esito, 'rifiutata');
  assert.match(c.frase, /non la scarico/);
  assert.match(c.frase, new RegExp(IN_USO.replace(/\./g, '\\.')));
  // Riaccesa a sessione aperta, Filo riprova a scaricare quello che ha trovato: niente.
  U.seguiImpostazioni({ aggiornamenti: { automatici: true, ...(s.modo ? { installa: s.modo } : {}) } });
  await calma();
  assert.equal(u.scaricamenti, 0);
  u.chiudi();
  assert.equal(u.installazioni, 0);
  assert.equal(await U.installaAllAvvioSeServe({}, { forza: true }), false);
  assert.equal(registro.lanciati.length, 0);
});

perOgniSistema('acceso, «aggiornati» a Filo: la release manomessa non si scarica e lo si dice', async (s) => {
  const { u } = await avvia({ ...s, ...MANOMESSA, automatici: true });
  const c = await U.aggiornaDaChat({ riavvio: true });
  await calma();
  assert.equal(c.esito, 'rifiutata', c.frase);
  assert.equal(u.scaricamenti, 0);
});

perOgniSistema('trovata una versione vera e poi spostata la «latest» su una manomessa, «Installa» non scarica la manomessa', async (s) => {
  const { u, feed } = await avvia({ ...s, ...VERA, automatici: false });
  assert.ok(cartaDi('0.2.240'));
  Object.assign(feed, MANOMESSA);
  // Il cancello dei tag (#1073) rifiuta il controllo stesso.
  await assert.rejects(u.checkForUpdates(), /rifiutata/);
  await U.installaAggiornamento();
  await calma();
  assert.equal(u.scaricamenti, 0, 'electron-updater scarica l\'ultima che ha trovato: la manomessa');
  u.chiudi();
  assert.equal(u.installazioni, 0);
});

perOgniSistema('con numero ed etichetta uguali tutto come prima: acceso scarica da solo, spento con «Installa»', async (s) => {
  const acceso = await avvia({ ...s, ...VERA, automatici: true });
  assert.equal(acceso.u.scaricamenti, 1, 'acceso, la versione vera non si scarica più da sola');
  assert.equal(ricordo()?.versione, '0.2.240');
  acceso.u.chiudi();
  assert.equal(acceso.u.installazioni, R.piano(s.piattaforma, R.modoScelto({ aggiornamenti: { installa: s.modo } })).allaChiusura ? 1 : 0);

  memoriaFinta();
  const spento = await avvia({ ...s, ...VERA, automatici: false });
  assert.equal(spento.u.scaricamenti, 0);
  assert.ok(cartaDi('0.2.240'), 'spento, nessuna carta «Installa» per la versione vera');
  const r = await U.installaAggiornamento();
  await calma();
  assert.equal(r.stato === 'scarica' || r.stato === 'pronta', true, JSON.stringify(r));
  assert.equal(spento.u.scaricamenti, 1);
});

// Lo stesso attacco con latest.yml che porta anche un suo «tag» uguale al numero gonfiato, e il file preso dalla release
// vecchia con un «../»: electron-updater userebbe quel tag al posto dell'etichetta vera.
const COL_TAG_NEL_FILE = { ...MANOMESSA, tagNelFile: 'v9.9.9', file: '../v0.2.100/Filo-Setup.exe' };
const SOLO_PERCORSO = { ...VERA, file: '../v0.2.100/Filo-Setup.exe' };

perOgniSistema('latest.yml col suo «tag» e un «../»: niente scaricamento né installazione, accesi o con «Installa»', async (s) => {
  for (const feed of [COL_TAG_NEL_FILE, { ...COL_TAG_NEL_FILE, file: '%2e%2e/v0.2.100/Filo-Setup.exe' }, { ...MANOMESSA, tagNelFile: 'v9.9.9' }]) {
    memoriaFinta();
    const acceso = await avvia({ ...s, ...feed, automatici: true });
    assert.equal(acceso.u.scaricamenti, 0, `${JSON.stringify(feed)}: scaricato ${acceso.u.indirizzi}`);
    acceso.u.chiudi();
    assert.equal(acceso.u.installazioni, 0);
    assert.equal(await U.installaAllAvvioSeServe({ aggiornamenti: { automatici: true, ...(s.modo ? { installa: s.modo } : {}) } }, { forza: true }), false);
    assert.equal(acceso.registro.lanciati.length, 0);

    memoriaFinta();
    const spento = await avvia({ ...s, ...feed, automatici: false });
    assert.equal(cartaDi('9.9.9'), undefined);
    const r = await U.installaAggiornamento();
    assert.equal(r.stato, 'rifiutata', JSON.stringify(r));
    assert.equal((await U.aggiornaDaChat({ riavvio: true })).esito, 'rifiutata');
    await calma();
    assert.equal(spento.u.scaricamenti, 0);
  }
});

perOgniSistema('numero ed etichetta veri ma il file da un\'altra release: non si scarica', async (s) => {
  const { u } = await avvia({ ...s, ...SOLO_PERCORSO, automatici: true });
  assert.equal(u.scaricamenti, 0, `scaricato ${u.indirizzi}`);
});

test('la release vera si scarica dalla sua cartella, con l\'etichetta chiesta a GitHub', async () => {
  const { u } = await avvia({ piattaforma: 'win32', ...VERA, tagNelFile: 'v0.2.240', automatici: true });
  assert.equal(u.scaricamenti, 1);
  assert.deepEqual(u.indirizzi, ['/sathyaram1/Filo/releases/download/v0.2.240/Filo-Setup.exe']);
});

test('downloadUpdate si chiama in un posto solo, quello che confronta numero ed etichetta', () => {
  const src = readFileSync(join(ROOT, 'src', 'main', 'updater.js'), 'utf8');
  const chiamate = src.match(/\.downloadUpdate\s*\(/g) || [];
  assert.equal(chiamate.length, 1, 'un\'altra strada verso downloadUpdate salta il confronto');
  const porta = /function scaricaVerificata\([^)]*\)\s*\{([\s\S]*?)\n\}/.exec(src);
  assert.ok(porta && /releaseCoerente/.test(porta[1]) && /\.downloadUpdate\s*\(/.test(porta[1]));
  assert.doesNotMatch(src, /autoDownload\s*=(?!\s*false\b)/,'electron-updater scaricherebbe prima che Filo veda la versione');
  assert.doesNotMatch(src, /\.(checkForUpdatesAndNotify|quitAndInstall)\s*\(/);
});
