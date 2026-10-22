// Una pagina già aperta non torna mai in una finestra nascosta: la sandbox prova solo un link prima che si apra, e in
// incognito non partono né lei né il giudizio del modello (#1081). Regole in src/main/services/safebrowse/index.js.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const SB = require('../../src/main/services/safebrowse/index.js');
const { installSafebrowse } = require('../../src/main/tabs/tabSafebrowse.js');
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

let conta;
beforeEach(() => {
  for (const c of Object.values(SB._caches)) c.m.clear();
  conta = { llm: [], sandbox: [] };
  SB.setProviders({
    gsb: null, rdap: null, ct: null,
    llm: async (m) => { conta.llm.push(m.host); return { suspicious: false, reason: null }; },
    sandbox: async (u) => { conta.sandbox.push(u); return { verdict: 'clean', finalUrl: u, redirects: [] }; },
  });
});

// Una finestra di Filo finta con una scheda: la pagina è quella che `wc.getURL()` dice aperta.
function finestra({ incognito = false } = {}) {
  class Schede {}
  installSafebrowse(Schede);
  const schede = new Schede();
  schede.incognito = incognito;
  schede.activeId = 1;
  schede.layout = () => {};
  schede.openTab = () => 2;
  schede._siteAllowedIn = () => false;
  const pagina = { url: '' };
  const campo = { executeJavaScript: async () => ({ hasPassword: true, shownPassword: true, hasPayment: false, shownPayment: false }) };
  campo.top = campo;
  const wc = { getURL: () => pagina.url, isDestroyed: () => false, send() {}, mainFrame: { framesInSubtree: [campo] } };
  const tab = { id: 1, view: { webContents: wc } };
  schede.tabs = [tab];
  return { schede, tab, pagina };
}

// Una finestrella aperta da una pagina (window.open): anche lei è già navigata quando la si giudica.
function finestrella(url) {
  const ascolti = {};
  const pwc = {
    on: (ev, fn) => { ascolti[ev] = fn; },
    getURL: () => url,
    isDestroyed: () => false,
    mainFrame: { origin: new URL(url).origin },
    executeJavaScript: async () => ({ hasPassword: true, shownPassword: true }),
  };
  const win = { webContents: pwc, once() {}, isDestroyed: () => false, close() {} };
  return { win, ascolti };
}

// Tutte le strade da cui una finestra verifica una pagina: arrivo, content script, riquadri, finestrella.
async function visita({ schede, tab, pagina }, url) {
  pagina.url = url;
  schede._sbOnNavigate(tab, url);
  schede.safebrowseGet(tab.id, url, { hasPassword: true });
  tab._sbScanGiro = 1;
  await schede._sbScanFrames(tab, 1);
  const f = finestrella(url);
  schede._sbGuardaFinestrella(f.win, tab);
  f.ascolti['did-navigate']();
  await f.ascolti['did-finish-load']();
  await SB._settled();
}

test('una pagina http aperta in una scheda non viene riaperta in una finestra nascosta, da nessuna strada', async () => {
  const f = finestra();
  await visita(f, 'http://conferma-iscrizione.esempio-qualunque.com/conferma?token=monouso123');
  // Una pagina ospitata, dove anche i riquadri si guardano e la password accende il controllo più profondo.
  await visita(f, 'https://s3.amazonaws.com/secchio-qualunque/accesso.html');
  assert.deepEqual(conta.sandbox, []);
  assert.ok(conta.llm.length > 0, 'fuori dall\'incognito il giudizio resta (D16/#894): la prova non è vuota');
});

test('lo stesso indirizzo come link non ancora aperto passa ancora dalla finestra nascosta', async () => {
  SB.analyze('http://conferma-iscrizione.esempio-qualunque.com/conferma?token=monouso123', { daAprire: true }, () => {});
  await SB._settled();
  assert.deepEqual(conta.sandbox, ['http://conferma-iscrizione.esempio-qualunque.com/conferma?token=monouso123']);
});

test('in incognito né giudizio del modello né finestra nascosta, e l\'avviso locale arriva lo stesso', async () => {
  const f = finestra({ incognito: true });
  await visita(f, 'http://accesso.esempio-qualunque.com/login');
  assert.deepEqual(conta.llm, []);
  assert.deepEqual(conta.sandbox, []);
  assert.equal(f.tab.sbAvviso && f.tab.sbAvviso.level, 'sospetto', 'una password su http in incognito ha il suo avviso');

  SB.analyze('http://link.esempio-qualunque.com/', { incognito: true, daAprire: true }, () => {});
  await SB._settled();
  assert.deepEqual([conta.llm, conta.sandbox], [[], []], 'nemmeno un link non ancora aperto');
});

test('una finestra normale dopo una in incognito ha il suo giudizio', async () => {
  const url = 'http://accesso.esempio-dopo.com/login';
  await visita(finestra({ incognito: true }), url);
  assert.deepEqual(conta.llm, []);
  await visita(finestra(), url);
  assert.equal(conta.llm.length, 1);
});

// Il main verifica le pagine solo da _sbAnalizza, e i link prima del clic solo da _sbPreverifica: tutte e due
// aggiungono l'incognito. Nessuna pagina aperta si dice «da aprire».
test('ogni verifica di una pagina o di un link passa dalla porta che conosce l\'incognito', () => {
  const file = (dir) => readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? file(p) : (/\.js$/.test(n) ? [p] : []);
  });
  const chiamate = { analyze: [], preverifica: [] };
  const daAprire = [];
  for (const p of file(join(ROOT, 'src'))) {
    const rel = relative(ROOT, p).replace(/\\/g, '/');
    if (rel.startsWith('src/main/services/safebrowse/')) continue;
    const s = readFileSync(p, 'utf8');
    for (const k of Object.keys(chiamate)) {
      for (const m of s.matchAll(new RegExp(`\\.${k}\\(`, 'g'))) chiamate[k].push(`${rel}:${s.slice(0, m.index).split('\n').length}`);
    }
    if (/daAprire\s*:/.test(s)) daAprire.push(rel);
  }
  for (const [k, dove] of Object.entries(chiamate)) {
    const porta = dove.filter((c) => c.startsWith('src/main/tabs/tabSafebrowse.js:'));
    assert.equal(porta.length, 1, `una sola chiamata a ${k}, nella sua porta: ${porta.join(', ')}`);
    assert.deepEqual(dove.filter((c) => !porta.includes(c)), [],
      `una verifica nuova passa dalla porta di ${k}, o l'incognito non la ferma`);
  }
  assert.deepEqual(daAprire, [], 'un link prima del clic passa da preverifica (#966), che sa quando aprire la finestra nascosta');
});

// La finestra nascosta apre i link accorciati su cui il puntatore si ferma (#966): l'interruttore comanda qualcosa, si
// vede in Sicurezza e, chiesto a Filo, dice cosa fa.
test('l\'interruttore della finestra isolata si vede e parla dei link accorciati', () => {
  const html = readFileSync(join(ROOT, 'src/pages/security/security.html'), 'utf8');
  const riga = html.match(/<div[^>]*id="sec-safebrowse-sandbox-row"[^>]*>/);
  assert.ok(riga && !/\shidden[\s>]/.test(riga[0]), 'la riga dell\'interruttore è in vista');
  const src = readFileSync(join(ROOT, 'src/shared/preferences.js'), 'utf8');
  const i = src.indexOf("percorso: 'security.safeBrowse.sandbox'");
  assert.ok(i > 0, 'la voce della chat c\'è ancora: il valore resta leggibile e modificabile');
  const voce = src.slice(i, src.indexOf('}),', i));
  assert.match(voce, /link accorciat/);
  assert.doesNotMatch(voce, /nessuna funzione|non cambia niente/);
});
