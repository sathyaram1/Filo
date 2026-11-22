// #591.6 — le risposte ricordate dei siti sono di tutte le finestre: tolte dalla pagina Sicurezza aperta in incognito
// restano tolte sul disco, e ogni cambio (Consenti, menu della scheda, Sicurezza, chat) arriva alle pagine di Filo aperte.
// Lo storage è quello vero, con Electron finto come in incognitoAccoglienza.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module, { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const userData = cartellaTemporanea('filo-permessi-ogni-finestra-');
process.env.FILO_USER_DATA = userData;
writeFileSync(join(userData, 'storage.json'), JSON.stringify({
  sitePermissions: { 'https://riunione.example|audio': true, 'https://posta.example|notifiche': true },
}));
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return { app: { getPath: () => userData }, safeStorage: { isEncryptionAvailable: () => false } };
  return origLoad.call(this, request, parent, isMain);
};
const Storage = require(join(ROOT, 'src', 'main', 'shim', 'storage.js'));
const Permessi = require(join(ROOT, 'src', 'main', 'services', 'permessiPagine.js'));
Permessi._usaDisco(Storage);
const annunci = [];
Permessi._usaAnnuncio(() => annunci.push(Date.now()));

const sulDisco = async () => {
  await Storage.flushNow();
  return JSON.parse(readFileSync(join(userData, 'storage.json'), 'utf8')).sitePermissions || {};
};
// Una ripartenza di Filo: storage e permessi rinascono e rileggono il file.
async function dopoLaRiapertura() {
  const percorsi = [join(ROOT, 'src', 'main', 'shim', 'storage.js'), join(ROOT, 'src', 'main', 'services', 'permessiPagine.js')];
  for (const p of percorsi) delete require.cache[require.resolve(p)];
  const S = require(percorsi[0]);
  const P = require(percorsi[1]);
  P._usaDisco(S);
  P._usaAnnuncio(() => {});
  await P.carica();
  return P.scelteRicordate().map((s) => `${s.origine}|${s.parte}`);
}

test('tolta dalla pagina Sicurezza di una finestra in incognito, la risposta non torna alla riapertura', async () => {
  await Permessi.carica();
  assert.equal(Permessi.scelteRicordate().length, 2);
  const ok = await Storage.runIncognito(async () => Permessi.togliScelta('https://riunione.example', 'audio'));
  assert.equal(ok, true);
  assert.deepEqual(Object.keys(await sulDisco()), ['https://posta.example|notifiche'], 'sul disco il microfono non c\'è più');
  assert.deepEqual(await dopoLaRiapertura(), ['https://posta.example|notifiche']);
});

test('dalla finestra normale la stessa mossa resta come prima', async () => {
  assert.equal(Permessi.togliScelta('https://posta.example', 'notifiche'), true);
  assert.deepEqual(await sulDisco(), {});
});

function sessioneFinta() {
  const ses = { avvisi: [], isPersistent: () => true };
  ses.setPermissionRequestHandler = (fn) => { ses.richiesta = fn; };
  ses.setPermissionCheckHandler = (fn) => { ses.controllo = fn; };
  Permessi.installa(ses, { schedaDi: () => ({ tabId: 't1', avvisa: (evento, dati) => ses.avvisi.push({ evento, dati }) }) });
  return ses;
}
function wcFinto(url, session) {
  return { id: Math.random(), session, getURL: () => url, isDestroyed: () => false, on() {}, once() {} };
}

test('ogni cambio delle risposte ricordate si annuncia alle pagine di Filo: Consenti, menu della scheda, Sicurezza, chat', async () => {
  const ses = sessioneFinta();
  const wc = wcFinto('https://riunione.example/stanza', ses);
  annunci.length = 0;
  ses.richiesta(wc, 'media', () => {}, { mediaTypes: ['audio'] });
  Permessi.rispondi(ses.avvisi.at(-1).dati.id, true);
  assert.equal(annunci.length, 1, 'il Consenti si annuncia');
  assert.ok(Permessi.scelteRicordate().some((s) => s.origine === 'https://riunione.example' && s.parte === 'audio'));

  Permessi.dimentica(wc);
  assert.equal(annunci.length, 2, 'il menu della scheda si annuncia');

  ses.richiesta(wc, 'media', () => {}, { mediaTypes: ['audio'] });
  Permessi.rispondi(ses.avvisi.filter((a) => a.evento === 'chiedi').at(-1).dati.id, false);
  assert.equal(annunci.length, 3);
  Permessi.togliScelta('https://riunione.example', 'audio');
  assert.equal(annunci.length, 4, 'il Togli della pagina Sicurezza si annuncia');

  ses.richiesta(wc, 'media', () => {}, { mediaTypes: ['audio'] });
  Permessi.rispondi(ses.avvisi.filter((a) => a.evento === 'chiedi').at(-1).dati.id, true);
  const r = Permessi.togliPerChat('riunione.example', 'microfono');
  assert.equal(r.tolte.length, 1);
  assert.equal(annunci.length, 6, 'il togli dalla chat si annuncia');
});
