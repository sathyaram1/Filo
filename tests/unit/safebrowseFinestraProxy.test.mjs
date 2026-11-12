// #753.1 — la finestra nascosta che segue un link accorciato esce come la scheda da cui parte: da una scheda col proxy,
// dallo stesso proxy (regole e credenziali) e senza UDP fuori dal proxy; il proxy si applica prima di caricare, e se
// non si applica la pagina non si apre. Regole in src/main/services/safebrowse/sandbox.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createDetonator } = require('../../src/main/services/safebrowse/sandbox.js');
const ProxyTab = require('../../src/main/services/proxyTab.js');

// Electron finto: registra in ordine cosa succede alla sessione del posto e alla finestra.
function electronFinto({ proxyRotto = false } = {}) {
  const fatti = [];
  const sessioni = new Map();
  const session = {
    fromPartition: (nome) => {
      if (!sessioni.has(nome)) {
        sessioni.set(nome, {
          nome,
          on() {},
          clearStorageData: async () => {},
          setProxy: async (c) => { fatti.push(['setProxy', c]); if (proxyRotto) throw new Error('proxy rotto'); },
          closeAllConnections: async () => { fatti.push(['chiudi']); },
          clearAuthCache: async () => { fatti.push(['dimentica']); },
        });
      }
      return sessioni.get(nome);
    },
  };
  class BrowserWindow {
    constructor(opz) {
      const ses = opz.webPreferences.session;
      const ascolti = {};
      this.webContents = {
        on: (ev, fn) => { (ascolti[ev] = ascolti[ev] || []).push(fn); },
        setWindowOpenHandler() {},
        setWebRTCIPHandlingPolicy: (p) => fatti.push(['webrtc', p]),
        loadURL: (url) => {
          fatti.push(['carica', url, ProxyTab.credenzialiDellaSessione(ses)]);
          setTimeout(() => (ascolti['did-stop-loading'] || []).forEach((f) => f({})), 1);
          return Promise.resolve();
        },
      };
    }
    isDestroyed() { return false; }
    destroy() {}
  }
  return { electron: { BrowserWindow, session }, fatti };
}

const RETE = { proxyRules: 'http://proxy.fornitore.example:8080', proxyBypassRules: '<-loopback>', auth: { username: 'u', password: 'p' } };
const opzioni = { maxConcurrent: 1, vitaDestinazioneMs: 200, attesaRimandoMs: 5 };

test('da una scheda col proxy la finestra nascosta carica solo dopo aver preso lo stesso proxy, credenziali comprese', async () => {
  const f = electronFinto();
  const D = createDetonator({ electron: f.electron, ...opzioni });
  await D.destinazione('https://bit.ly/a', () => false, { rete: RETE });
  const carica = f.fatti.findIndex((x) => x[0] === 'carica');
  const proxy = f.fatti.findIndex((x) => x[0] === 'setProxy');
  assert.ok(proxy >= 0 && proxy < carica, 'il proxy va applicato prima di caricare');
  assert.deepEqual(f.fatti[proxy][1], { proxyRules: RETE.proxyRules, proxyBypassRules: RETE.proxyBypassRules });
  assert.ok(f.fatti.slice(proxy, carica).some((x) => x[0] === 'chiudi'), 'le connessioni di prima si chiudono');
  assert.deepEqual(f.fatti.find((x) => x[0] === 'webrtc'), ['webrtc', 'disable_non_proxied_udp']);
  assert.deepEqual(f.fatti[carica][2], RETE.auth, 'il proxy che chiede la password la riceve');

  // Il link dopo, da una scheda senza proxy, riporta il posto alla rete del sistema prima di caricare.
  f.fatti.length = 0;
  await D.destinazione('https://bit.ly/b', () => false);
  assert.deepEqual(f.fatti.map((x) => x[0]).filter((x) => x !== 'chiudi'), ['setProxy', 'carica']);
  assert.deepEqual(f.fatti[0][1], { mode: 'system' });
  assert.equal(f.fatti.find((x) => x[0] === 'carica')[2], null);
  assert.equal(f.fatti.some((x) => x[0] === 'webrtc'), false);

  // Stessa rete di prima: niente da cambiare.
  f.fatti.length = 0;
  await D.destinazione('https://bit.ly/c', () => false);
  assert.deepEqual(f.fatti.map((x) => x[0]), ['carica']);
});

test('se il proxy della scheda non si applica la finestra non apre il link', async () => {
  const f = electronFinto({ proxyRotto: true });
  const D = createDetonator({ electron: f.electron, ...opzioni });
  const r = await D.destinazione('https://bit.ly/a', () => false, { rete: RETE });
  assert.equal(r && r.destinazione, null);
  assert.equal(f.fatti.some((x) => x[0] === 'carica'), false);
  const s = await D.detonate('http://sospetto.example/', null, { rete: RETE });
  assert.equal(s, null);
  assert.equal(f.fatti.some((x) => x[0] === 'carica'), false);
});

// #1272 — un fornitore col paese nel nome utente ha lo stesso indirizzo per ogni paese: Chromium ricorderebbe la password
// del paese di prima, quindi passando a un altro paese le credenziali vecchie si dimenticano prima di caricare.
test('passando da una scheda americana a una tedesca sullo stesso proxy la finestra dimentica le credenziali americane prima di caricare', async () => {
  const f = electronFinto();
  const D = createDetonator({ electron: f.electron, ...opzioni });
  const reteDi = (paese) => ({ ...RETE, auth: { username: `utente-${paese}`, password: 'p' } });
  await D.destinazione('https://bit.ly/a', () => false, { rete: reteDi('us') });
  assert.equal(f.fatti.some((x) => x[0] === 'dimentica'), false, 'la prima volta non c\'è niente da dimenticare');

  f.fatti.length = 0;
  await D.destinazione('https://bit.ly/b', () => false, { rete: reteDi('de') });
  const dimentica = f.fatti.findIndex((x) => x[0] === 'dimentica');
  const carica = f.fatti.findIndex((x) => x[0] === 'carica');
  assert.ok(dimentica >= 0 && dimentica < carica, 'le credenziali americane si dimenticano prima di caricare');
  assert.deepEqual(f.fatti[carica][2], reteDi('de').auth);

  // Di nuovo la Germania: niente da dimenticare.
  f.fatti.length = 0;
  await D.destinazione('https://bit.ly/c', () => false, { rete: reteDi('de') });
  assert.equal(f.fatti.some((x) => x[0] === 'dimentica'), false);
});

test('una scheda che cambia paese sullo stesso proxy dimentica le credenziali di prima, anche dopo essere tornata senza proxy', async () => {
  const fatti = [];
  const ses = { clearAuthCache: async () => { fatti.push('dimentica'); }, closeAllConnections: async () => { fatti.push('chiudi'); } };
  const regole = { proxyRules: 'http://gate.fornitore.example:7000', bypassRules: '' };
  assert.equal(ProxyTab.registraRete('proxy:t1', ses, { ...regole, auth: { username: 'utente-us', password: 'p' } }), null);
  assert.equal(ProxyTab.registraRete('proxy:t1', ses, { ...regole, auth: { username: 'utente-us', password: 'p' } }), null);
  await ProxyTab.registraRete('proxy:t1', ses, { ...regole, auth: { username: 'utente-de', password: 'p' } });
  assert.deepEqual(fatti, ['dimentica', 'chiudi']);
  assert.deepEqual(ProxyTab.credenzialiDellaSessione(ses), { username: 'utente-de', password: 'p' });

  fatti.length = 0;
  ProxyTab.clearPartitionAuth('proxy:t1');
  await ProxyTab.registraRete('proxy:t1', ses, { ...regole, auth: { username: 'utente-fr', password: 'p' } });
  assert.deepEqual(fatti, ['dimentica', 'chiudi']);
  ProxyTab.clearPartitionAuth('proxy:t1');
});
