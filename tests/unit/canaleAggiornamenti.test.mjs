// Il canale di aggiornamento (SPEC-DOMANDE.md §4.2): sul veloce si installa ogni versione, sullo stabile solo la minor
// del lunedì (X.Y.0). Gira sull'electron-updater vero (GitHubProvider e AppUpdater): finti solo github.com, il disco
// dello scaricamento e l'installatore. Un client sul canale stabile non vede le patch delle sei ore.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const U = require(join(ROOT, 'src', 'main', 'updater.js'));
const R = require(join(ROOT, 'src', 'main', 'aggiornamentoRegole.js'));
const { BaseUpdater } = require('electron-updater/out/BaseUpdater.js');
const { GitHubProvider } = require('electron-updater/out/providers/GitHubProvider.js');

const PUBBLICO = { provider: 'github', owner: 'sathyaram1', repo: 'Filo' };
const CONTENUTO = 'MZ installatore finto';
const SHA = createHash('sha512').update(CONTENUTO).digest('base64');

// github.com con più release: `ultima` è quella segnata «latest», `release` le cartelle che hanno un latest.yml.
function github(feed) {
  return {
    letti: [],
    async request(opzioni) {
      const p = String(opzioni.path);
      if (p.endsWith('/releases/latest')) return JSON.stringify({ tag_name: feed.ultima });
      if (p.endsWith('/releases.atom')) {
        return '<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom"><entry>'
          + `<link rel="alternate" type="text/html" href="https://github.com/sathyaram1/Filo/releases/tag/${feed.ultima}"/>`
          + `<title>${feed.ultima}</title><content type="html">note</content></entry></feed>`;
      }
      const m = p.match(/^\/sathyaram1\/Filo\/releases\/download\/(v[^/]+)\/(latest[^/]*\.yml)$/);
      if (m) {
        this.letti.push(m[1]);
        if (!feed.release.includes(m[1])) {
          // Quello di electron-updater: GitHubProvider riconosce il 404 solo dalla sua classe.
          const { HttpError } = createRequire(require.resolve('electron-updater'))('builder-util-runtime');
          throw new HttpError(404, 'Not Found');
        }
        const v = m[1].slice(1);
        return `version: ${v}\nfiles:\n  - url: 'Filo-Setup.exe'\n    sha512: ${SHA}\n    size: ${CONTENUTO.length}\n`
          + `path: 'Filo-Setup.exe'\nsha512: ${SHA}\nreleaseDate: '2026-10-26T00:10:00.000Z'\n`;
      }
      throw new Error(`richiesta inattesa: ${p}`);
    },
  };
}

class Aggiornatore extends BaseUpdater {
  constructor(feed, inUso) {
    const allaChiusura = [];
    super(null, { version: inUso, isPackaged: true, whenReady: async () => {}, onQuit: (f) => allaChiusura.push(f), quit() {} });
    this._logger = { info() {}, warn() {}, error() {}, debug() {} };
    this.allaChiusura = allaChiusura;
    this.scaricamenti = 0;
    this.installazioni = 0;
    this.rete = github(feed);
    this.github = new GitHubProvider(PUBBLICO, this, { executor: this.rete, isUseMultipleRangeRequest: false, platform: 'win32' });
  }

  async getUpdateInfoAndProvider() {
    return { info: await this.github.getLatestVersion(), provider: this.github };
  }

  async doDownloadUpdate({ updateInfoAndProvider }) {
    this.scaricamenti += 1;
    this.indirizzi = updateInfoAndProvider.provider.resolveFiles(updateInfoAndProvider.info).map((f) => f.url.pathname);
    const cache = cartellaTemporanea('filo-canale-cache-');
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
beforeEach(() => {
  carte = [];
  let id = 0;
  globalThis.SN_FILO_MEMORY = {
    listNotifications: async ({ includeDismissed = false } = {}) => carte.filter((n) => includeDismissed || !n.dismissed),
    addNotification: async (n) => { const e = { ...n, id: `n${++id}`, dismissed: false }; carte.unshift(e); return e; },
    dismissNotification: async (nid) => { const n = carte.find((x) => x.id === nid); if (n) n.dismissed = true; return carte; },
  };
});
const calma = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };
const ricordo = () => (existsSync(join(dati, 'aggiornamento-pronto.json')) ? JSON.parse(readFileSync(join(dati, 'aggiornamento-pronto.json'), 'utf8')) : null);
const carteVive = () => carte.filter((n) => !n.dismissed).map((n) => `${n.action?.tipo}:${n.action?.versione}`);

async function avvia({ inUso, ultima, release, canale, automatici = true }) {
  dati = cartellaTemporanea('filo-canale-dati-');
  U.perProva({ piattaforma: 'win32', versione: inUso, cartella: dati, avvisoVero: false });
  U.seguiImpostazioni({ aggiornamenti: { canale, automatici } });
  const u = new Aggiornatore({ ultima, release }, inUso);
  await U.avviaAggiornatore(u, { automatici, chiesta: null, canale });
  await calma();
  return u;
}

// ── le regole ──────────────────────────────────────────────────────────────────────────────────────────────────────

test('il canale scelto: veloce di serie, solo i due nomi', () => {
  assert.equal(R.canaleScelto({}), 'veloce');
  assert.equal(R.canaleScelto({ aggiornamenti: { canale: 'stabile' } }), 'stabile');
  assert.equal(R.canaleScelto({ aggiornamenti: { canale: 'beta' } }), 'veloce');
  assert.equal(R.canaleScelto(null), 'veloce');
});

test('sullo stabile solo le X.Y.0; la stabile della serie si legge dal tag più recente', () => {
  assert.equal(R.versioneDelCanale('0.3.0', 'stabile'), true);
  assert.equal(R.versioneDelCanale('0.3.7', 'stabile'), false);
  assert.equal(R.versioneDelCanale('0.3.7', 'veloce'), true);
  assert.equal(R.versioneDelCanale('boh', 'veloce'), false);
  assert.equal(R.tagStabile('v0.3.7'), 'v0.3.0');
  assert.equal(R.tagStabile('v1.10.0'), 'v1.10.0');
  for (const t of ['0.3.7', 'v0.3', 'v0.3.7-beta', '', null]) assert.equal(R.tagStabile(t), null);
});

test('all’avvio, sullo stabile, una patch scaricata prima si dimentica e non si installa', () => {
  const pronto = { versione: '0.3.5', file: 'x.exe', sha512: 'aa', tentativi: 0, falliti: 0 };
  const base = { piattaforma: 'win32', versioneInUso: '0.3.0', modo: 'avvio', pronto };
  assert.equal(R.decidiAllAvvio(base).azione, 'installa');
  assert.deepEqual(R.decidiAllAvvio({ ...base, canale: 'stabile' }), { azione: 'apri', pronto: null, avvisa: false });
  assert.equal(R.decidiAllAvvio({ ...base, canale: 'stabile', pronto: { ...pronto, versione: '0.4.0' } }).azione, 'installa');
});

// ── l'aggiornatore vero ────────────────────────────────────────────────────────────────────────────────────────────

test('sul veloce si scarica la patch più nuova', async () => {
  const u = await avvia({ inUso: '0.2.250', ultima: 'v0.3.7', release: ['v0.3.0', 'v0.3.7'], canale: 'veloce' });
  assert.equal(u.scaricamenti, 1);
  assert.deepEqual(u.indirizzi, ['/sathyaram1/Filo/releases/download/v0.3.7/Filo-Setup.exe']);
  assert.equal(ricordo().versione, '0.3.7');
});

test('sullo stabile non si vedono le patch delle sei ore: si scarica la minor del lunedì', async () => {
  const u = await avvia({ inUso: '0.2.250', ultima: 'v0.3.7', release: ['v0.3.0', 'v0.3.7'], canale: 'stabile' });
  assert.equal(u.scaricamenti, 1);
  assert.deepEqual(u.indirizzi, ['/sathyaram1/Filo/releases/download/v0.3.0/Filo-Setup.exe']);
  assert.equal(ricordo().versione, '0.3.0');
  assert.ok(u.rete.letti.includes('v0.3.0'));
  assert.ok(carteVive().every((c) => !c.endsWith(':0.3.7')), 'nessuna carta della patch');
});

test('sullo stabile, chi ha già una patch più nuova della minor resta dov’è (niente passi indietro)', async () => {
  const u = await avvia({ inUso: '0.3.5', ultima: 'v0.3.7', release: ['v0.3.0', 'v0.3.7'], canale: 'stabile' });
  assert.equal(u.scaricamenti, 0);
  assert.equal(ricordo(), null);
});

test('sullo stabile, il lunedì la minor è anche la più recente: si prende quella', async () => {
  const u = await avvia({ inUso: '0.3.0', ultima: 'v0.4.0', release: ['v0.3.0', 'v0.4.0'], canale: 'stabile' });
  assert.deepEqual(u.indirizzi, ['/sathyaram1/Filo/releases/download/v0.4.0/Filo-Setup.exe']);
});

test('una minor la cui pubblicazione si è fermata: sullo stabile non c’è niente di nuovo, e niente errore', async () => {
  const u = await avvia({ inUso: '0.2.250', ultima: 'v0.3.2', release: ['v0.3.2'], canale: 'stabile' });
  assert.equal(u.scaricamenti, 0);
  const esito = await U.aggiornaDaChat();
  assert.equal(esito.esito, 'aggiornato');
  assert.match(esito.frase, /canale stabile/);
});

test('passare allo stabile toglie la patch già pronta: niente ricordo, niente installazione alla chiusura, niente carta', async () => {
  const u = await avvia({ inUso: '0.3.0', ultima: 'v0.3.7', release: ['v0.3.0', 'v0.3.7'], canale: 'veloce' });
  assert.equal(ricordo().versione, '0.3.7');
  assert.equal(u.autoInstallOnAppQuit, false, 'installa all’avvio, di serie');
  U.seguiImpostazioni({ aggiornamenti: { canale: 'stabile', automatici: true, installa: 'chiusura' } });
  await calma();
  assert.equal(ricordo(), null, 'all’avvio non si installerebbe la patch');
  assert.equal(u.autoInstallOnAppQuit, false, 'alla chiusura nemmeno');
  assert.ok(carteVive().every((c) => !c.endsWith(':0.3.7')), carteVive().join(', '));
  const r = await U.riavviaEAggiorna();
  assert.equal(r.ok, false, '«Riavvia e aggiorna» non installa la patch');
  u.chiudi();
  assert.equal(u.installazioni, 0);
  // Tornato sul veloce, la patch che electron-updater ha già si può di nuovo installare alla chiusura.
  U.seguiImpostazioni({ aggiornamenti: { canale: 'veloce', automatici: true, installa: 'chiusura' } });
  await calma();
  assert.equal(u.autoInstallOnAppQuit, true);
});

test('passare al veloce richiede subito: la versione nuova arriva senza riavviare Filo', async () => {
  const u = await avvia({ inUso: '0.3.0', ultima: 'v0.3.7', release: ['v0.3.0', 'v0.3.7'], canale: 'stabile' });
  assert.equal(u.scaricamenti, 0);
  U.seguiImpostazioni({ aggiornamenti: { canale: 'veloce', automatici: true } });
  await calma();
  await calma();
  assert.equal(u.scaricamenti, 1);
  assert.equal(ricordo().versione, '0.3.7');
});

test('le novità: chi arriva alla minor dallo stabile legge insieme le righe di tutte le patch che ha saltato', () => {
  require(join(ROOT, 'src', 'shared', 'patchNotes.js'));
  const PN = globalThis.SN_PATCH_NOTES;
  const da = '0.2.230';
  const attese = PN.NOTES.filter((n) => PN.cmpVersion(n.version, da) > 0)
    .flatMap((n) => [...(n.features || []), ...(n.fixes || [])]);
  assert.ok(attese.length > 10, 'la prova guarda davvero più versioni');
  const righe = PN.recap(da, '0.3.0', PN.fotografia(da)).flatMap((n) => [...n.features, ...n.fixes]);
  assert.deepEqual(new Set(righe), new Set(attese));
  // La minor successiva, dalla fotografia della prima: solo il nuovo della settimana.
  assert.deepEqual(PN.recap('0.3.0', '0.4.0', PN.fotografia('0.3.0')), []);
});
