// #1160 — Due canali: il veloce prende ogni versione pubblicata, lo stabile solo la minor del lunedì (x.y.0). Le regole
// pure, poi l'electron-updater vero (GitHubProvider e BaseUpdater) con finti solo github.com, le sue API e l'installatore:
// un client sullo stabile non vede le patch delle sei ore, e cambiare canale non installa la versione dell'altro.

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
const { BaseUpdater } = require('electron-updater/out/BaseUpdater.js');
const { GitHubProvider } = require('electron-updater/out/providers/GitHubProvider.js');

const PUBBLICO = { provider: 'github', owner: 'sathyaram1', repo: 'Filo' };
const CONTENUTO = 'MZ installatore finto';
const SHA = createHash('sha512').update(CONTENUTO).digest('base64');
const TUTTI = ['latest.yml', 'latest-mac.yml', 'latest-linux.yml'];

const rilascio = (tag, extra = {}) => ({ tag_name: tag, draft: false, prerelease: false, assets: TUTTI.map((name) => ({ name })), ...extra });
// Dalla più nuova, come le dà GitHub: le patch delle sei ore sopra la minor del lunedì.
const PUBBLICATE = ['v0.4.3', 'v0.4.2', 'v0.4.1', 'v0.4.0', 'v0.3.9', 'v0.3.8', 'v0.3.0', 'v0.2.240'].map((t) => rilascio(t));

// github.com e api.github.com come li interroga GitHubProvider: «latest», il feed, l'elenco delle release, i latest*.yml.
function github(stato) {
  return {
    async request(opzioni) {
      const p = String(opzioni.path);
      const pubbliche = stato.release.filter((r) => !r.draft && !r.prerelease);
      if (opzioni.hostname === 'api.github.com') {
        const m = /^\/repos\/sathyaram1\/Filo\/releases\?per_page=(\d+)&page=(\d+)$/.exec(p);
        if (!m) throw new Error(`richiesta API inattesa: ${p}`);
        stato.api.push(Number(m[2]));
        const n = Number(m[1]);
        return JSON.stringify(stato.release.slice((Number(m[2]) - 1) * n, Number(m[2]) * n));
      }
      if (p.endsWith('/releases/latest')) return JSON.stringify({ tag_name: pubbliche[0].tag_name });
      if (p.endsWith('/releases.atom')) {
        return '<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom">'
          + pubbliche.slice(0, 10).map((r) => `<entry><link rel="alternate" type="text/html" href="https://github.com/sathyaram1/Filo/releases/tag/${r.tag_name}"/>`
            + `<title>${r.tag_name}</title><content type="html">note</content></entry>`).join('') + '</feed>';
      }
      const d = /^\/sathyaram1\/Filo\/releases\/download\/(v[^/]+)\/(latest[^/]*\.yml)$/.exec(p);
      const r = d && stato.release.find((x) => x.tag_name === d[1]);
      if (r && r.assets.some((a) => a.name === d[2])) {
        return `version: ${d[1].slice(1)}\nfiles:\n  - url: 'Filo-Setup.exe'\n    sha512: ${SHA}\n    size: ${CONTENUTO.length}\n`
          + `path: 'Filo-Setup.exe'\nsha512: ${SHA}\nreleaseDate: '2026-10-12T00:00:00.000Z'\n`;
      }
      throw new Error(`richiesta inattesa: ${p}`);
    },
  };
}

class Aggiornatore extends BaseUpdater {
  constructor(stato, piattaforma, inUso) {
    const allaChiusura = [];
    super(null, { version: inUso, isPackaged: true, whenReady: async () => {}, onQuit: (f) => allaChiusura.push(f), quit() {} });
    this._logger = { info() {}, warn() {}, error() {}, debug() {} };
    this.allaChiusura = allaChiusura;
    this.scaricate = [];
    this.installazioni = 0;
    this.github = new GitHubProvider(PUBBLICO, this, { executor: github(stato), isUseMultipleRangeRequest: false, platform: piattaforma });
  }

  async getUpdateInfoAndProvider() {
    return { info: await this.github.getLatestVersion(), provider: this.github };
  }

  async doDownloadUpdate({ updateInfoAndProvider }) {
    const { info, provider } = updateInfoAndProvider;
    this.scaricate.push(provider.resolveFiles(info).map((f) => f.url.pathname)[0]);
    const cache = cartellaTemporanea('filo-canale-cache-');
    const file = join(cache, 'Filo-Setup.exe');
    writeFileSync(file, CONTENUTO);
    writeFileSync(join(cache, 'update-info.json'), JSON.stringify({ fileName: 'Filo-Setup.exe', sha512: SHA, isAdminRightsRequired: false }));
    this.dispatchUpdateDownloaded({ ...info, downloadedFile: file });
    this.addQuitHandler();
    return [file];
  }

  install() { this.installazioni += 1; return true; }
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
const calma = async (giri = 6) => { for (let i = 0; i < giri; i++) await new Promise((r) => setImmediate(r)); };
const ricordo = () => (existsSync(join(dati, 'aggiornamento-pronto.json')) ? JSON.parse(readFileSync(join(dati, 'aggiornamento-pronto.json'), 'utf8')) : null);
const carteAperte = () => carte.filter((n) => !n.dismissed && n.action?.versione).map((n) => `${n.action.tipo}:${n.action.versione}`).sort();
const impostazioni = (canale, automatici = true) => ({ aggiornamenti: { automatici, installa: 'avvio', canale } });

async function avvia({ piattaforma = 'win32', inUso, canale, automatici = true, release = PUBBLICATE }) {
  dati = cartellaTemporanea('filo-canale-dati-');
  const { registro } = U.perProva({ piattaforma, versione: inUso, cartella: dati, avvisoVero: false });
  const stato = { release, api: [] };
  const u = new Aggiornatore(stato, piattaforma, inUso);
  await U.avviaAggiornatore(u, { automatici, chiesta: null, modo: 'avvio', canale });
  await calma();
  return { u, registro, stato };
}

beforeEach(() => memoriaFinta());

// ── Le regole ──

test('il canale scelto: veloce di serie, stabile solo se è proprio quello', () => {
  assert.equal(R.CANALE_PREDEFINITO, 'veloce');
  assert.equal(R.canaleScelto(impostazioni('stabile')), 'stabile');
  for (const s of [undefined, null, {}, { aggiornamenti: {} }, impostazioni('veloce'), impostazioni('beta'), impostazioni(' stabile'), impostazioni(1)]) {
    assert.equal(R.canaleScelto(s), 'veloce', JSON.stringify(s));
  }
});

test('versione per canale: sullo stabile solo le x.y.0, sul veloce tutte', () => {
  for (const v of ['0.4.0', 'v0.4.0', '1.0.0', '0.10.0']) assert.equal(R.nelCanale(v, 'stabile'), true, v);
  for (const v of ['0.4.3', '0.4.10', '0.4.0-beta.1', '0.4', '', null, 40, 'v0.4.0 ']) assert.equal(R.nelCanale(v, 'stabile'), false, String(v));
  for (const v of ['0.4.3', '0.4.0']) assert.equal(R.nelCanale(v, 'veloce'), true, v);
  assert.equal(R.nelCanale('niente', 'veloce'), false);
});

test('la scelta stabile: la minor più nuova di quella in uso, mai una patch', () => {
  const s = (inUso, pagina = PUBBLICATE, fileCanale = 'latest.yml') => R.sceltaStabile(pagina, { inUso, fileCanale });
  assert.deepEqual(s('0.3.9'), { tag: 'v0.4.0', finito: true });
  assert.deepEqual(s('0.3.0'), { tag: 'v0.4.0', finito: true }, 'chi è rimasto indietro di più settimane prende l\'ultima, non la prima');
  // Niente di più nuovo sullo stabile: la prima release non più nuova di quella in uso, e electron-updater dice «aggiornato».
  assert.deepEqual(s('0.4.0'), { tag: 'v0.3.9', finito: true });
  assert.deepEqual(s('0.4.1'), { tag: 'v0.4.1', finito: true }, 'chi era sul veloce non torna indietro alla minor');
  // Bozze, pre-release, etichette che non sono una versione e minor senza il file di questo sistema non contano.
  const sporche = [rilascio('v0.6.0', { draft: true }), rilascio('v0.5.0', { prerelease: true }), rilascio('prova-0.5.0'), rilascio('v0.5.0-rc.1'),
    rilascio('v0.4.5', { assets: [] }), rilascio('v0.4.0', { assets: [{ name: 'latest.yml' }] }), rilascio('v0.3.9')];
  assert.deepEqual(s('0.3.9', sporche, 'latest-mac.yml'), { tag: 'v0.3.9', finito: true });
  assert.deepEqual(s('0.3.9', sporche, 'latest.yml'), { tag: 'v0.4.0', finito: true });
  // Pagina senza la risposta: si legge la dopo.
  assert.deepEqual(s('0.3.9', [rilascio('v0.4.3'), rilascio('v0.4.2')]), { tag: null, finito: false });
  assert.deepEqual(s('0.3.9', []), { tag: null, finito: false });
  assert.deepEqual(s('0.3.9', null), { tag: null, finito: false });
});

test('all\'avvio una versione scaricata sul veloce non si installa sullo stabile, e si dimentica', () => {
  const pronto = { versione: '0.4.3', file: 'C:/x/Filo-Setup.exe', sha512: 'abc' };
  const base = { piattaforma: 'win32', versioneInUso: '0.4.0', modo: 'avvio', pronto };
  assert.equal(R.decidiAllAvvio(base).azione, 'installa');
  assert.deepEqual(R.decidiAllAvvio({ ...base, canale: 'stabile' }), { azione: 'apri', pronto: null, avvisa: false });
  assert.equal(R.decidiAllAvvio({ ...base, canale: 'stabile', pronto: { ...pronto, versione: '0.5.0' } }).azione, 'installa');
});

// ── L'electron-updater vero ──

for (const piattaforma of ['win32', 'linux']) {
  test(`veloce: arriva l'ultima patch (${piattaforma})`, async () => {
    const { u, stato } = await avvia({ piattaforma, inUso: '0.3.9', canale: 'veloce' });
    assert.deepEqual(u.scaricate, ['/sathyaram1/Filo/releases/download/v0.4.3/Filo-Setup.exe']);
    assert.deepEqual(stato.api, [], 'il veloce non legge l\'elenco delle release');
  });

  test(`stabile: arriva la minor del lunedì, non le patch delle sei ore (${piattaforma})`, async () => {
    const { u, stato } = await avvia({ piattaforma, inUso: '0.3.9', canale: 'stabile' });
    assert.deepEqual(u.scaricate, ['/sathyaram1/Filo/releases/download/v0.4.0/Filo-Setup.exe']);
    assert.equal(ricordo()?.versione, piattaforma === 'win32' ? '0.4.0' : ricordo()?.versione);
    assert.deepEqual(stato.api, [1], 'controllo e cancello chiedono l\'elenco una volta sola');
  });

  test(`stabile e già sulla minor: le patch uscite dopo non si vedono, né carta né scaricamento (${piattaforma})`, async () => {
    const acceso = await avvia({ piattaforma, inUso: '0.4.0', canale: 'stabile' });
    assert.deepEqual(acceso.u.scaricate, []);
    assert.equal((await U.statoAggiornamento()).fase, 'aggiornato');
    const c = await U.aggiornaDaChat({ riavvio: true });
    assert.equal(c.esito, 'aggiornato');
    assert.match(c.frase, /0\.4\.0 è l'ultima versione del canale stabile/);

    memoriaFinta();
    const spento = await avvia({ piattaforma, inUso: '0.4.0', canale: 'stabile', automatici: false });
    assert.deepEqual(carteAperte(), [], 'una carta «Installa» per una patch del veloce');
    assert.equal((await U.installaAggiornamento()).stato, 'aggiornato');
    assert.deepEqual(spento.u.scaricate, []);
  });
}

test('stabile, spento: la carta «Installa» è della minor, e «Installa» scarica quella', async () => {
  const { u } = await avvia({ inUso: '0.3.9', canale: 'stabile', automatici: false });
  assert.deepEqual(carteAperte(), ['aggiornamento-disponibile:0.4.0']);
  const r = await U.installaAggiornamento();
  await calma();
  assert.ok(['scarica', 'pronta'].includes(r.stato), JSON.stringify(r));
  assert.deepEqual(u.scaricate, ['/sathyaram1/Filo/releases/download/v0.4.0/Filo-Setup.exe']);
});

test('stabile: una minor senza i file di questo sistema non si propone, si prende quella prima', async () => {
  const release = [rilascio('v0.5.1'), rilascio('v0.5.0', { assets: [{ name: 'latest.yml' }] }), ...PUBBLICATE];
  const linux = await avvia({ piattaforma: 'linux', inUso: '0.3.9', canale: 'stabile', release });
  assert.deepEqual(linux.u.scaricate, ['/sathyaram1/Filo/releases/download/v0.4.0/Filo-Setup.exe']);
  memoriaFinta();
  const win = await avvia({ piattaforma: 'win32', inUso: '0.3.9', canale: 'stabile', release });
  assert.deepEqual(win.u.scaricate, ['/sathyaram1/Filo/releases/download/v0.5.0/Filo-Setup.exe']);
});

test('stabile: la minor sta oltre le prime cento release, e si trova lo stesso', async () => {
  const patch = Array.from({ length: 130 }, (_, i) => rilascio(`v0.5.${130 - i}`));
  const { u, stato } = await avvia({ inUso: '0.4.0', canale: 'stabile', release: [...patch, rilascio('v0.5.0'), ...PUBBLICATE] });
  assert.deepEqual(stato.api, [1, 2]);
  assert.deepEqual(u.scaricate, ['/sathyaram1/Filo/releases/download/v0.5.0/Filo-Setup.exe']);
});

test('dal veloce allo stabile con una patch già scaricata: non si installa, né alla chiusura né all\'avvio, e la carta se ne va', async () => {
  const { u, registro } = await avvia({ inUso: '0.4.0', canale: 'veloce' });
  assert.deepEqual(u.scaricate, ['/sathyaram1/Filo/releases/download/v0.4.3/Filo-Setup.exe']);
  assert.equal(ricordo()?.versione, '0.4.3');
  assert.deepEqual(carteAperte(), ['aggiornamento-pronto:0.4.3']);

  U.seguiImpostazioni(impostazioni('stabile'));
  await calma();
  assert.equal(ricordo(), null, 'Windows la installerebbe al prossimo avvio');
  assert.deepEqual(carteAperte(), [], 'la carta «Riavvia e aggiorna» promette una versione del veloce');
  assert.equal(u.autoInstallOnAppQuit, false);
  assert.deepEqual(u.scaricate, ['/sathyaram1/Filo/releases/download/v0.4.3/Filo-Setup.exe'], 'sullo stabile non c\'era niente da scaricare');
  assert.equal((await U.riavviaEAggiorna()).ok, false);
  u.chiudi();
  assert.equal(u.installazioni, 0, 'installata alla chiusura la patch del veloce');
  assert.equal(await U.installaAllAvvioSeServe(impostazioni('stabile'), { forza: true }), false);
  assert.equal(registro.lanciati.length, 0);
});

test('dallo stabile al veloce: si ricontrolla subito e arriva l\'ultima patch', async () => {
  const { u } = await avvia({ inUso: '0.4.0', canale: 'stabile' });
  assert.deepEqual(u.scaricate, []);
  U.seguiImpostazioni(impostazioni('veloce'));
  await calma(12);
  assert.deepEqual(u.scaricate, ['/sathyaram1/Filo/releases/download/v0.4.3/Filo-Setup.exe']);
  assert.equal(ricordo()?.versione, '0.4.3');
});

test('andata e ritorno: la patch torna a installarsi sul veloce, e una minor nuova sullo stabile', async () => {
  const { u } = await avvia({ inUso: '0.3.9', canale: 'veloce' });
  U.seguiImpostazioni(impostazioni('stabile'));
  await calma(12);
  assert.deepEqual(u.scaricate.map((p) => p.split('/')[5]), ['v0.4.3', 'v0.4.0']);
  assert.equal(ricordo()?.versione, '0.4.0');
  assert.deepEqual(carteAperte(), ['aggiornamento-pronto:0.4.0']);
  assert.equal(u.autoInstallOnAppQuit, false, 'Windows installa all\'apertura, non alla chiusura');
  U.seguiImpostazioni(impostazioni('veloce'));
  await calma(12);
  assert.deepEqual(u.scaricate.map((p) => p.split('/')[5]), ['v0.4.3', 'v0.4.0', 'v0.4.3']);
  assert.equal(ricordo()?.versione, '0.4.3');
});

test('la scelta della release passa da electron-updater: se il punto sparisce, lo stabile si ferma invece di prendere le patch', () => {
  assert.equal(typeof GitHubProvider.prototype.getLatestTagName, 'function');
  assert.equal(GitHubProvider.prototype.getLatestTagName.filoCanale, true, 'il canale stabile non è agganciato al provider');
  const src = readFileSync(join(ROOT, 'src', 'main', 'updater.js'), 'utf8');
  assert.match(src, /this\.filoCanale === 'stabile' && !canaleAgganciato/);
});
